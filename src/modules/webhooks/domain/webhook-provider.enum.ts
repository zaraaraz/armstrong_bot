/**
 * Supported inbound webhook providers. Values are the stable lowercase wire
 * strings; they match the Prisma `WebhookProviderType` enum 1:1 so the
 * repository boundary casts directly with no lookup table.
 */
export enum WebhookProvider {
  GitHub = 'github',
  Stripe = 'stripe',
  FiveM = 'fivem',
  Custom = 'custom',
}

/** All provider values, for validation and iteration. */
export const WEBHOOK_PROVIDERS: readonly WebhookProvider[] =
  Object.values(WebhookProvider);

/** Narrowing type guard for untrusted input (query params, DTO bodies). */
export function isWebhookProvider(value: unknown): value is WebhookProvider {
  return (
    typeof value === 'string' &&
    (WEBHOOK_PROVIDERS as readonly string[]).includes(value)
  );
}
