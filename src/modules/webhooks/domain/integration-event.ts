import type { WebhookProvider } from './webhook-provider.enum';

/**
 * The canonical, provider-agnostic envelope published on the Event Bus after a
 * {@link PayloadNormalizer} processes a verified inbound webhook. Downstream
 * modules depend on THIS contract, never on a provider's wire format.
 *
 * The specific normalized kind (e.g. `github.push`, `stripe.payment.succeeded`)
 * travels in {@link IntegrationEvent.type}; the bus event NAME is always
 * `integration.event`.
 */
export interface IntegrationEvent<TData = Readonly<Record<string, unknown>>> {
  /** Stable internal type, e.g. "github.push", "stripe.payment.succeeded". */
  readonly type: string;
  readonly provider: WebhookProvider;
  /** Owning guild, or null for global/system endpoints. */
  readonly guildId: string | null;
  /** Provider's delivery id (idempotency key), if any. */
  readonly deliveryId: string | null;
  /** Our WebhookIngressDelivery row id, for traceability. */
  readonly internalDeliveryId: string;
  readonly occurredAt: Date;
  /** Normalized, provider-agnostic data. Never the raw provider body. */
  readonly data: TData;
}

/** A page of results shared by the delivery/subscription query surfaces. */
export interface PageResult<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}
