import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { EncryptionService } from '../../../shared/security/services/encryption.service';
import { DeliveryStatus } from '../domain/delivery-status.enum';
import { EndpointDisabledError } from '../domain/errors/endpoint-disabled.error';
import { SignatureInvalidError } from '../domain/errors/signature-invalid.error';
import { IdempotencyGuard } from '../domain/idempotency.guard';
import { WebhookProvider } from '../domain/webhook-provider.enum';
import { WebhookEventEmitter } from '../events/webhook-event.emitter';
import { NormalizerRegistry } from '../normalization/normalizer.registry';
import type { NormalizationContext } from '../normalization/payload-normalizer.interface';
import { VerifierRegistry } from '../verification/verifier.registry';
import type { VerificationContext } from '../verification/signature-verifier.interface';
import { WebhooksConfigService } from '../config/webhooks-config.service';
import { WebhookEndpointRepository } from '../repositories/webhook-endpoint.repository';
import {
  WebhookDeliveryRepository,
  type IngressDeliveryRecord,
} from '../repositories/webhook-delivery.repository';
import type { WebhookEndpointRecord } from '../repositories/webhook-endpoint.repository';
import { WebhooksQueues } from '../jobs/webhooks.queue';

/**
 * Thrown when an inbound body exceeds `config.maxInboundBodyBytes`. The ingress
 * controller maps this to `413 Payload Too Large`. Kept a plain error so the
 * service stays free of HTTP concerns.
 */
export class PayloadTooLargeError extends Error {
  constructor(sizeBytes: number, limitBytes: number) {
    super(`inbound body ${sizeBytes} bytes exceeds limit ${limitBytes} bytes`);
    this.name = 'PayloadTooLargeError';
  }
}

/** Result of the accept-fast path handed back to the ingress controller. */
export interface AcceptResult {
  readonly accepted: true;
  readonly internalDeliveryId: string;
  /** True when the delivery was recognised as a duplicate (no re-enqueue). */
  readonly deduped: boolean;
}

type InboundHeaders = Readonly<Record<string, string | undefined>>;

/**
 * The accept-fast path for inbound webhooks (spec §3). Called by the public
 * ingress controller: resolve endpoint by token, enforce the body-size cap
 * BEFORE any verification, verify the signature (constant-time, in the
 * verifier), dedupe, persist a `verified` ingress delivery, and enqueue the
 * normalization job — then return `202` quickly. Normalization + bus fan-out run
 * later in the inbound worker via {@link process}. Raw bytes are never
 * re-serialised; the verifier receives the exact `rawBody` buffer.
 */
@Injectable()
export class InboundWebhookService {
  private readonly logger = new Logger('webhooks.inbound');

  constructor(
    private readonly endpoints: WebhookEndpointRepository,
    private readonly deliveries: WebhookDeliveryRepository,
    private readonly verifiers: VerifierRegistry,
    private readonly normalizers: NormalizerRegistry,
    private readonly idempotency: IdempotencyGuard,
    private readonly emitter: WebhookEventEmitter,
    private readonly encryption: EncryptionService,
    private readonly config: WebhooksConfigService,
    private readonly queues: WebhooksQueues,
  ) {}

  /**
   * Accepts one inbound delivery. Throws {@link EndpointDisabledError} (404-ish),
   * {@link PayloadTooLargeError} (413), or {@link SignatureInvalidError} (401)
   * for the controller to map. On a signature failure a `rejected` delivery is
   * persisted best-effort and `webhooks.delivery.failed` is emitted before the
   * error rethrows.
   */
  async accept(
    token: string,
    rawBody: Buffer,
    headers: InboundHeaders,
  ): Promise<AcceptResult> {
    const global = this.config.global();

    if (rawBody.length > global.maxInboundBodyBytes) {
      throw new PayloadTooLargeError(
        rawBody.length,
        global.maxInboundBodyBytes,
      );
    }

    const endpoint = await this.resolveEndpoint(token);
    const externalId = this.extractDeliveryId(endpoint.provider, headers);

    // DB-level dedupe: a prior row for the same (endpoint, delivery id) short-
    // circuits without re-verifying or re-enqueuing.
    if (externalId) {
      const existing = await this.deliveries.findIngressByExternalId(
        endpoint.id,
        externalId,
      );
      if (existing) {
        return {
          accepted: true,
          internalDeliveryId: existing.id,
          deduped: true,
        };
      }
    }

    await this.verifySignature(endpoint, rawBody, headers, externalId);

    // Cache-level dedupe: a fast short-circuit for a duplicate seen within the
    // window (a provider re-send before the DB row is queryable). It is only an
    // optimisation — the delivery-id-derived BullMQ jobId and the
    // @@unique([endpointId, externalId]) constraint are the real dedupe
    // guarantees — so we claim it but NEVER gate the enqueue on it.
    const dedupeKey = externalId ?? this.bodyHash(rawBody);
    const firstSighting = await this.idempotency.claim(
      endpoint.guildId,
      dedupeKey,
      global.dedupeTtlSeconds,
    );
    if (!firstSighting) {
      const existing = externalId
        ? await this.deliveries.findIngressByExternalId(endpoint.id, externalId)
        : null;
      if (existing) {
        return {
          accepted: true,
          internalDeliveryId: existing.id,
          deduped: true,
        };
      }
      // Claimed but no committed row yet (a prior attempt failed after claim):
      // fall through and process this delivery so it is never lost.
    }

    // Persist + enqueue atomically from the caller's view: if either step fails,
    // release the cache claim so the provider's retry is not silently dropped.
    try {
      const delivery = await this.deliveries.createIngress({
        endpointId: endpoint.id,
        guildId: endpoint.guildId,
        provider: endpoint.provider,
        externalId,
        headers: this.sanitizeHeaders(headers),
        rawBody,
      });
      await this.deliveries.updateIngressStatus(delivery.id, {
        status: DeliveryStatus.Verified,
      });
      await this.queues.enqueueInboundProcess({
        internalDeliveryId: delivery.id,
      });
      return {
        accepted: true,
        internalDeliveryId: delivery.id,
        deduped: false,
      };
    } catch (err) {
      await this.idempotency
        .release(endpoint.guildId, dedupeKey)
        .catch(() => undefined);
      throw err;
    }
  }

  /**
   * Processes a verified ingress delivery. Called by the inbound BullMQ worker.
   * Resolves the provider normalizer, publishes the `integration.event`, and
   * advances the delivery to `processed`. A normalizer returning `null` (a
   * recognised-but-ignored event) marks the delivery `processed` without a bus
   * emission. Any error marks it `failed` and emits `webhooks.delivery.failed`.
   */
  async process(internalDeliveryId: string): Promise<void> {
    const delivery = await this.deliveries.findIngressById(internalDeliveryId);
    if (!delivery) {
      this.logger.warn(`ingress delivery ${internalDeliveryId} vanished; skip`);
      return;
    }

    await this.deliveries.updateIngressStatus(delivery.id, {
      status: DeliveryStatus.Processing,
    });

    try {
      const event = await this.normalize(delivery);
      if (!event) {
        await this.deliveries.updateIngressStatus(delivery.id, {
          status: DeliveryStatus.Processed,
          processedAt: new Date(),
        });
        return;
      }

      await this.emitter.emitIntegrationEvent(event);
      await this.deliveries.updateIngressStatus(delivery.id, {
        status: DeliveryStatus.Processed,
        eventType: event.type,
        processedAt: new Date(),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await this.markFailed(delivery, reason);
      throw err;
    }
  }

  /** Resolves an active endpoint or throws {@link EndpointDisabledError}. */
  private async resolveEndpoint(token: string): Promise<WebhookEndpointRecord> {
    const endpoint = await this.endpoints.findByToken(token);
    if (!endpoint || !endpoint.enabled || endpoint.deletedAt) {
      throw new EndpointDisabledError();
    }
    return endpoint;
  }

  /**
   * Runs the provider verifier against the raw bytes. On failure persists a
   * best-effort `rejected` delivery, emits `webhooks.delivery.failed`, and
   * rethrows the {@link SignatureInvalidError} for the controller (401).
   */
  private async verifySignature(
    endpoint: WebhookEndpointRecord,
    rawBody: Buffer,
    headers: InboundHeaders,
    externalId: string | null,
  ): Promise<void> {
    const global = this.config.global();
    const verifier = this.verifiers.resolve(endpoint.provider);
    const ctx: VerificationContext = {
      rawBody,
      headers,
      signingSecret: this.encryption.decrypt(endpoint.signingSecret),
      toleranceSeconds: global.signatureToleranceSeconds,
    };

    try {
      await verifier.verify(ctx);
    } catch (err) {
      await this.persistRejected(endpoint, rawBody, headers, externalId, err);
      throw err;
    }
  }

  /** Persists a rejected delivery + emits the failure event (best-effort). */
  private async persistRejected(
    endpoint: WebhookEndpointRecord,
    rawBody: Buffer,
    headers: InboundHeaders,
    externalId: string | null,
    err: unknown,
  ): Promise<void> {
    const reason =
      err instanceof SignatureInvalidError
        ? err.message
        : 'signature verification error';
    try {
      const delivery = await this.deliveries.createIngress({
        endpointId: endpoint.id,
        guildId: endpoint.guildId,
        provider: endpoint.provider,
        externalId,
        headers: this.sanitizeHeaders(headers),
        rawBody,
      });
      await this.deliveries.updateIngressStatus(delivery.id, {
        status: DeliveryStatus.Rejected,
        rejectReason: reason,
      });
      await this.emitDeliveryFailed(
        delivery.id,
        endpoint.guildId,
        endpoint.provider,
        reason,
      );
    } catch (persistErr) {
      this.logger.warn(
        `failed to persist rejected delivery: ${
          persistErr instanceof Error ? persistErr.message : String(persistErr)
        }`,
      );
    }
  }

  /** Marks an ingress delivery failed + emits the failure event. */
  private async markFailed(
    delivery: IngressDeliveryRecord,
    reason: string,
  ): Promise<void> {
    await this.deliveries.updateIngressStatus(delivery.id, {
      status: DeliveryStatus.Failed,
      rejectReason: reason,
      processedAt: new Date(),
    });
    await this.emitDeliveryFailed(
      delivery.id,
      delivery.guildId,
      delivery.provider,
      reason,
    );
  }

  private async emitDeliveryFailed(
    internalDeliveryId: string,
    guildId: string | null,
    provider: WebhookProvider,
    reason: string,
  ): Promise<void> {
    await this.emitter
      .emitDeliveryFailed({ internalDeliveryId, guildId, provider, reason })
      .catch(() => undefined);
  }

  /** Resolves the normalizer and builds the canonical envelope. */
  private async normalize(delivery: IngressDeliveryRecord) {
    const normalizer = this.normalizers.resolve(delivery.provider);
    const ctx: NormalizationContext = {
      rawBody: delivery.rawBody,
      headers: this.toHeaderStrings(delivery.headers),
      guildId: delivery.guildId,
      internalDeliveryId: delivery.id,
    };
    return normalizer.normalize(ctx);
  }

  /**
   * Extracts the provider's delivery id for dedupe. GitHub sends
   * `x-github-delivery`; other providers carry it inside the (verified) body and
   * are deduped by a body hash instead, so this returns null for them here.
   */
  private extractDeliveryId(
    provider: WebhookProvider,
    headers: InboundHeaders,
  ): string | null {
    const value = this.header(headers, this.deliveryIdHeader(provider));
    return value && value.length > 0 ? value : null;
  }

  private deliveryIdHeader(provider: WebhookProvider): string {
    switch (provider) {
      case WebhookProvider.GitHub:
        return 'x-github-delivery';
      case WebhookProvider.Stripe:
        return 'stripe-signature';
      default:
        return 'x-webhook-delivery';
    }
  }

  /** Stable hash of the raw body, used as a dedupe key when no id is present. */
  private bodyHash(rawBody: Buffer): string {
    return createHash('sha256').update(rawBody).digest('hex');
  }

  private header(headers: InboundHeaders, name: string): string | undefined {
    return headers[name] ?? headers[name.toLowerCase()];
  }

  /**
   * Keeps only string header values for JSON persistence (drops array-valued or
   * undefined headers). The raw signing/secret headers are retained for replay;
   * they are never logged and the secret itself is never a header.
   */
  private sanitizeHeaders(
    headers: InboundHeaders,
  ): Readonly<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  }

  /** Narrows persisted JSON headers back to the verifier/normalizer shape. */
  private toHeaderStrings(
    headers: Readonly<Record<string, unknown>>,
  ): Readonly<Record<string, string | undefined>> {
    const out: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(headers)) {
      out[key] = typeof value === 'string' ? value : undefined;
    }
    return out;
  }
}
