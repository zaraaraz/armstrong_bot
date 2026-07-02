import { Injectable, Logger } from '@nestjs/common';
import type { IntegrationEvent } from '../domain/integration-event';
import { WebhookProvider } from '../domain/webhook-provider.enum';
import {
  PayloadNormalizer,
  type NormalizationContext,
} from './payload-normalizer.interface';

/** Reads a string field defensively from untrusted parsed JSON. */
function str(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Coerces an arbitrary type token into a safe event suffix: lowercased and
 * restricted to `[a-z0-9._-]`. Falls back to `event` when nothing survives so
 * the emitted type is always a well-formed `custom.<suffix>`.
 */
function sanitizeType(raw: string | undefined): string {
  const cleaned = (raw ?? 'event').toLowerCase().replace(/[^a-z0-9._-]/g, '');
  return cleaned.length > 0 ? cleaned : 'event';
}

/**
 * Passthrough normalizer for arbitrary custom sources. The event type is
 * `custom.<sanitized body.type>`; `data` is `body.data` when present, otherwise
 * the whole body. The delivery id is `body.id`, else the `x-delivery-id` header,
 * else null; `occurredAt` is `body.timestamp` when parseable, else now.
 */
@Injectable()
export class CustomNormalizer extends PayloadNormalizer {
  readonly provider = WebhookProvider.Custom;
  private readonly logger = new Logger('webhooks.normalizer.custom');

  normalize(ctx: NormalizationContext): Promise<IntegrationEvent | null> {
    return Promise.resolve(this.normalizeSync(ctx));
  }

  private normalizeSync(ctx: NormalizationContext): IntegrationEvent | null {
    const body = this.parse(ctx.rawBody);
    if (!body) return null;

    const type = `custom.${sanitizeType(str(body, 'type'))}`;
    const deliveryId = str(body, 'id') ?? ctx.headers['x-delivery-id'] ?? null;

    return {
      type,
      provider: this.provider,
      guildId: ctx.guildId,
      deliveryId,
      internalDeliveryId: ctx.internalDeliveryId,
      occurredAt: this.resolveOccurredAt(body),
      data: this.resolveData(body),
    };
  }

  private resolveData(
    body: Record<string, unknown>,
  ): Readonly<Record<string, unknown>> {
    const data = body['data'];
    if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
      return data as Record<string, unknown>;
    }
    return body;
  }

  private resolveOccurredAt(body: Record<string, unknown>): Date {
    const timestamp = body['timestamp'];
    if (typeof timestamp === 'string' || typeof timestamp === 'number') {
      const parsed = new Date(timestamp);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return new Date();
  }

  private parse(rawBody: Buffer): Record<string, unknown> | null {
    try {
      const parsed: unknown = JSON.parse(rawBody.toString('utf8'));
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      this.logger.debug('custom payload was not valid JSON; ignoring');
      return null;
    }
  }
}
