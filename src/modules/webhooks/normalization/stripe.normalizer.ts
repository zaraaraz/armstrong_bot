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

/** Reads a finite number field defensively. */
function num(obj: Record<string, unknown>, key: string): number | undefined {
  const value = obj[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

/** Reads a nested object defensively (returns an empty record on mismatch). */
function obj(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = source[key];
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Normalizes Stripe events. Stripe wraps the resource in `{ id, type, created,
 * data: { object } }`; `id` is the delivery id (idempotency key) and `created`
 * is a UNIX epoch (seconds). Only `payment_intent.succeeded` and
 * `customer.subscription.updated` are mapped; other types are recognized but
 * intentionally ignored (returns `null`).
 */
@Injectable()
export class StripeNormalizer extends PayloadNormalizer {
  readonly provider = WebhookProvider.Stripe;
  private readonly logger = new Logger('webhooks.normalizer.stripe');

  normalize(ctx: NormalizationContext): Promise<IntegrationEvent | null> {
    return Promise.resolve(this.normalizeSync(ctx));
  }

  private normalizeSync(ctx: NormalizationContext): IntegrationEvent | null {
    const body = this.parse(ctx.rawBody);
    if (!body) return null;

    const type = str(body, 'type');
    if (!type) return null;

    const deliveryId = str(body, 'id') ?? null;
    const created = num(body, 'created');
    const occurredAt =
      created !== undefined ? new Date(created * 1000) : new Date();
    const object = obj(obj(body, 'data'), 'object');

    switch (type) {
      case 'payment_intent.succeeded':
        return this.build(
          ctx,
          deliveryId,
          occurredAt,
          'stripe.payment.succeeded',
          {
            objectId: str(object, 'id') ?? null,
            amount: num(object, 'amount') ?? null,
            currency: str(object, 'currency') ?? null,
          },
        );
      case 'customer.subscription.updated':
        return this.build(
          ctx,
          deliveryId,
          occurredAt,
          'stripe.subscription.updated',
          {
            subscriptionId: str(object, 'id') ?? null,
            status: str(object, 'status') ?? null,
          },
        );
      default:
        return null;
    }
  }

  private build(
    ctx: NormalizationContext,
    deliveryId: string | null,
    occurredAt: Date,
    type: string,
    data: Readonly<Record<string, unknown>>,
  ): IntegrationEvent {
    return {
      type,
      provider: this.provider,
      guildId: ctx.guildId,
      deliveryId,
      internalDeliveryId: ctx.internalDeliveryId,
      occurredAt,
      data,
    };
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
      this.logger.debug('stripe payload was not valid JSON; ignoring');
      return null;
    }
  }
}
