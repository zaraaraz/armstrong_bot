/**
 * Lifecycle state of an inbound or outbound webhook delivery. Values match the
 * Prisma `WebhookDeliveryStatus` enum 1:1. Distinct from the notifications
 * `DeliveryStatus` (a different lifecycle for a different subsystem).
 */
export enum DeliveryStatus {
  Received = 'received',
  Verified = 'verified',
  Rejected = 'rejected',
  Processing = 'processing',
  Processed = 'processed',
  Failed = 'failed',
  DeadLettered = 'dead_lettered',
}

export const DELIVERY_STATUSES: readonly DeliveryStatus[] =
  Object.values(DeliveryStatus);

export function isDeliveryStatus(value: unknown): value is DeliveryStatus {
  return (
    typeof value === 'string' &&
    (DELIVERY_STATUSES as readonly string[]).includes(value)
  );
}
