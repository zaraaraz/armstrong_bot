/**
 * Event payloads for the Webhooks module (Phase 4, item 18).
 *
 * The module EMITS `integration.event` (the canonical, provider-agnostic
 * envelope produced after a verified inbound webhook is normalized) plus two
 * lifecycle events (`webhooks.delivery.failed`, `webhooks.outbound.dead_lettered`)
 * consumed by the dashboard for live status and by metrics/alerting.
 *
 * The specific normalized kind (e.g. `github.push`, `stripe.payment.succeeded`)
 * travels inside the `integration.event` payload's `type` field, NOT as its own
 * bus event name. Payloads are the wire shape: `occurredAt` is an ISO string,
 * not a `Date`, so the envelope serialises cleanly. Event names follow
 * `module.entity.action`.
 */

/**
 * Wire shape of {@link IntegrationEvent}: mirrors the domain value object but
 * with `occurredAt` as an ISO-8601 string and `provider` as its lowercase
 * string value, so the payload survives serialisation onto the bus.
 */
export interface IntegrationEventPayload {
  /** Stable internal type, e.g. "github.push", "stripe.payment.succeeded". */
  readonly type: string;
  readonly provider: string;
  /** Owning guild, or null for global/system endpoints. */
  readonly guildId: string | null;
  /** Provider's delivery id (idempotency key), if any. */
  readonly deliveryId: string | null;
  /** Our WebhookIngressDelivery row id, for traceability. */
  readonly internalDeliveryId: string;
  /** When the source event occurred, ISO-8601. */
  readonly occurredAt: string;
  /** Normalized, provider-agnostic data. Never the raw provider body. */
  readonly data: Record<string, unknown>;
}

export interface WebhookDeliveryFailedPayload {
  readonly internalDeliveryId: string;
  readonly guildId: string | null;
  readonly provider: string;
  readonly reason: string;
}

export interface WebhookOutboundDeadLetteredPayload {
  readonly subscriptionId: string;
  readonly guildId: string;
  readonly eventType: string;
  readonly attempts: number;
}

export interface WebhooksEventPayloads {
  'integration.event': IntegrationEventPayload;
  'webhooks.delivery.failed': WebhookDeliveryFailedPayload;
  'webhooks.outbound.dead_lettered': WebhookOutboundDeadLetteredPayload;
}
