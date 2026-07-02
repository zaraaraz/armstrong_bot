import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'crypto';
import { EncryptionService } from '../../../shared/security/services/encryption.service';
import type { EventEnvelope } from '../../../core/events/envelope/event-envelope';
import { DeliveryStatus } from '../domain/delivery-status.enum';
import { WebhookEventEmitter } from '../events/webhook-event.emitter';
import { WebhooksConfigService } from '../config/webhooks-config.service';
import {
  WebhookSubscriptionRepository,
  type WebhookSubscriptionRecord,
} from '../repositories/webhook-subscription.repository';
import { WebhookDeliveryRepository } from '../repositories/webhook-delivery.repository';
import { WebhooksQueues } from '../jobs/webhooks.queue';

/** HTTP signature header names for signed outbound deliveries. */
const SIGNATURE_HEADER = 'x-webhook-signature-256';
const EVENT_HEADER = 'x-webhook-event';
const TIMESTAMP_HEADER = 'x-webhook-timestamp';
const DELIVERY_ID_HEADER = 'x-webhook-delivery-id';

/**
 * Recursively sorts object keys so two deeply-equal JSON values serialise
 * identically regardless of key order. Arrays keep their order (order is
 * semantically significant); primitives pass through unchanged.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return Object.keys(source)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = canonicalize(source[key]);
        return acc;
      }, {});
  }
  return value;
}

/**
 * Outbound egress (spec §3). Consumes allowlisted platform domain events (via
 * the {@link OutboundTriggerConsumer}) and fans them out to matching guild
 * subscriptions: {@link dispatchForEvent} creates one outbound delivery row per
 * match and enqueues a deliver job; {@link deliver} (the outbound worker) signs
 * the body with HMAC-SHA256 and POSTs it, applying retry/backoff and, on
 * exhaustion, the dead-letter path. This service never blocks the publish path —
 * dispatch failures are swallowed and logged.
 */
@Injectable()
export class OutboundDispatchService {
  private readonly logger = new Logger('webhooks.outbound');

  constructor(
    private readonly subscriptions: WebhookSubscriptionRepository,
    private readonly deliveries: WebhookDeliveryRepository,
    private readonly emitter: WebhookEventEmitter,
    private readonly encryption: EncryptionService,
    private readonly config: WebhooksConfigService,
    private readonly queues: WebhooksQueues,
  ) {}

  /**
   * Fans one consumed domain event out to its matching subscriptions. Errors are
   * caught so a dispatch failure never propagates back onto the bus publish path.
   */
  async dispatchForEvent(envelope: EventEnvelope): Promise<void> {
    try {
      await this.doDispatch(envelope);
    } catch (err) {
      this.logger.warn(
        `outbound dispatch failed for ${envelope.name}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async doDispatch(envelope: EventEnvelope): Promise<void> {
    const global = this.config.global();
    const eventType = envelope.name;

    if (!global.outbound.enabled) return;
    if (!global.outbound.allowedOutboundEvents.includes(eventType)) return;

    const payload = this.toPayload(envelope.payload);
    const matches = await this.subscriptions.findEnabledForEvent(eventType);

    for (const sub of matches) {
      if (!this.matchesFilter(sub.filter, payload)) continue;

      const delivery = await this.deliveries.createOutbound({
        subscriptionId: sub.id,
        guildId: sub.guildId,
        eventType,
        payload,
      });
      await this.queues.enqueueOutboundDeliver(
        { outboundDeliveryId: delivery.id, subscriptionId: sub.id },
        {
          attempts: global.outbound.maxAttempts,
          backoffMs: global.outbound.backoff.baseDelayMs,
        },
      );
    }
  }

  /**
   * Delivers one outbound attempt. Called by the outbound BullMQ worker.
   *  - 2xx           -> mark `processed` (delivered), record status code.
   *  - 4xx (not 429) -> permanent: mark `failed` and RETURN (no throw, no retry).
   *  - 429/5xx/net   -> mark `failed`, bump attempts, THROW so BullMQ retries.
   */
  async deliver(outboundDeliveryId: string): Promise<void> {
    const delivery = await this.deliveries.findOutboundById(outboundDeliveryId);
    if (!delivery) {
      this.logger.warn(
        `outbound delivery ${outboundDeliveryId} vanished; skip`,
      );
      return;
    }
    if (delivery.status === DeliveryStatus.Processed) {
      return; // a redundant duplicate job
    }

    const sub = await this.subscriptions.findById(delivery.subscriptionId);
    if (!sub) {
      await this.deliveries.updateOutbound(delivery.id, {
        status: DeliveryStatus.Failed,
        attempts: delivery.attempts + 1,
        lastError: 'subscription missing',
      });
      return; // permanent — the target no longer exists, do not retry
    }

    const attemptNo = delivery.attempts + 1;
    const body = JSON.stringify(delivery.payload);
    const headers = this.buildHeaders(
      sub,
      delivery.id,
      delivery.eventType,
      body,
    );

    let statusCode: number;
    try {
      statusCode = await this.post(sub.targetUrl, body, headers);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await this.deliveries.updateOutbound(delivery.id, {
        status: DeliveryStatus.Failed,
        attempts: attemptNo,
        lastError: reason,
      });
      throw new Error(`outbound POST failed: ${reason}`); // network -> retry
    }

    if (statusCode >= 200 && statusCode < 300) {
      await this.deliveries.updateOutbound(delivery.id, {
        status: DeliveryStatus.Processed,
        attempts: attemptNo,
        lastStatusCode: statusCode,
        deliveredAt: new Date(),
      });
      return;
    }

    const retryable = statusCode === 429 || statusCode >= 500;
    await this.deliveries.updateOutbound(delivery.id, {
      status: DeliveryStatus.Failed,
      attempts: attemptNo,
      lastStatusCode: statusCode,
      lastError: `HTTP ${statusCode}`,
    });

    if (!retryable) return; // 4xx (not 429) -> permanent, no retry
    throw new Error(`outbound POST returned HTTP ${statusCode}`); // retry
  }

  /**
   * Invoked by the outbound worker's `failed` handler once retries are
   * exhausted: moves the delivery to the DLQ (`dead_lettered`) and emits
   * `webhooks.outbound.dead_lettered`.
   */
  async onExhausted(outboundDeliveryId: string): Promise<void> {
    const delivery = await this.deliveries.findOutboundById(outboundDeliveryId);
    if (!delivery || delivery.status === DeliveryStatus.Processed) return;

    await this.deliveries.updateOutbound(delivery.id, {
      status: DeliveryStatus.DeadLettered,
      attempts: delivery.attempts,
      lastError: delivery.lastError ?? 'retries exhausted',
    });
    await this.emitter
      .emitOutboundDeadLettered({
        subscriptionId: delivery.subscriptionId,
        guildId: delivery.guildId,
        eventType: delivery.eventType,
        attempts: delivery.attempts,
      })
      .catch(() => undefined);
  }

  /** Builds the signed request headers for one outbound POST. */
  private buildHeaders(
    sub: WebhookSubscriptionRecord,
    deliveryId: string,
    eventType: string,
    body: string,
  ): Record<string, string> {
    const secret = this.encryption.decrypt(sub.signingSecret);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = this.signBody(secret, `${timestamp}.${body}`);
    return {
      'content-type': 'application/json',
      [SIGNATURE_HEADER]: `sha256=${signature}`,
      [EVENT_HEADER]: eventType,
      [TIMESTAMP_HEADER]: timestamp,
      [DELIVERY_ID_HEADER]: deliveryId,
    };
  }

  /** Computes the lowercase-hex HMAC-SHA256 of the body under the secret. */
  private signBody(secret: string, body: string): string {
    return createHmac('sha256', secret).update(body).digest('hex');
  }

  /** POSTs the signed body with a request timeout; returns the status code. */
  private async post(
    targetUrl: string,
    body: string,
    headers: Record<string, string>,
  ): Promise<number> {
    const timeoutMs = this.config.global().outbound.requestTimeoutMs;
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.status;
  }

  /**
   * Shallow subset match: every top-level key in the filter must be present in
   * the payload with a deeply-equal value. Absent/empty filter matches all.
   */
  private matchesFilter(
    filter: Readonly<Record<string, unknown>> | null,
    payload: Readonly<Record<string, unknown>>,
  ): boolean {
    if (!filter) return true;
    for (const [key, expected] of Object.entries(filter)) {
      if (!this.valueEquals(payload[key], expected)) return false;
    }
    return true;
  }

  /**
   * Deep structural equality for plain-JSON values, insensitive to object key
   * order (payloads come from normalizers, filters from user config, so the same
   * data may be keyed in a different order). Canonicalises both sides by sorting
   * object keys at every depth before serialising.
   */
  private valueEquals(actual: unknown, expected: unknown): boolean {
    if (actual === expected) return true;
    return (
      JSON.stringify(canonicalize(actual)) ===
      JSON.stringify(canonicalize(expected))
    );
  }

  /** Narrows an event payload to the JSON record shape stored on the row. */
  private toPayload(payload: unknown): Readonly<Record<string, unknown>> {
    return payload && typeof payload === 'object'
      ? (payload as Readonly<Record<string, unknown>>)
      : {};
  }
}
