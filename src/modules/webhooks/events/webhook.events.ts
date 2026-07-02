/**
 * Event names the Webhooks module publishes on the core Event Bus. Payload
 * shapes are registered centrally in
 * `core/events/registry/payloads/webhooks.payloads.ts` and keyed into
 * `GhostEventMap`. The specific normalized inbound kind (`github.push`, …)
 * travels inside the `integration.event` payload's `type` field, NOT as its own
 * bus event name.
 */
export const WebhookEvents = {
  /** A normalizer produced a canonical envelope. Payload: IntegrationEvent. */
  IntegrationEvent: 'integration.event',
  /** Inbound verification or processing rejected a delivery. */
  DeliveryFailed: 'webhooks.delivery.failed',
  /** Outbound retries exhausted; delivery moved to the DLQ. */
  OutboundDeadLettered: 'webhooks.outbound.dead_lettered',
} as const;

export type WebhookEventName =
  (typeof WebhookEvents)[keyof typeof WebhookEvents];
