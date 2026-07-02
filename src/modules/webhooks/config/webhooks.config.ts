import { z } from 'zod';

/**
 * Global (process-wide) webhooks configuration, resolved ENV -> defaults and
 * validated with Zod (spec §8). Per-endpoint / per-subscription settings live in
 * the database and are row-scoped; they override nothing here.
 */
export const webhooksConfigSchema = z.object({
  /** Max accepted inbound body size in bytes (rejected before parsing). */
  maxInboundBodyBytes: z.number().int().positive().default(1_048_576), // 1 MiB
  /** Stripe/timestamped providers: allowed clock skew. */
  signatureToleranceSeconds: z.number().int().positive().default(300),
  /** Idempotency dedupe window. */
  dedupeTtlSeconds: z.number().int().positive().default(86_400),
  /** Endpoint-by-token / subs-by-guild cache TTL. */
  cacheTtlSeconds: z.number().int().min(0).default(300),
  inbound: z
    .object({
      enabled: z.boolean().default(true),
      maxConcurrency: z.number().int().positive().default(10),
    })
    .default({ enabled: true, maxConcurrency: 10 }),
  outbound: z
    .object({
      enabled: z.boolean().default(true),
      maxAttempts: z.number().int().min(1).max(20).default(8),
      backoff: z
        .object({
          type: z.enum(['fixed', 'exponential']).default('exponential'),
          baseDelayMs: z.number().int().positive().default(2_000),
          maxDelayMs: z.number().int().positive().default(900_000), // 15 min cap
        })
        .default({
          type: 'exponential',
          baseDelayMs: 2_000,
          maxDelayMs: 900_000,
        }),
      requestTimeoutMs: z.number().int().positive().default(10_000),
      /** Platform domain events guilds are allowed to subscribe outward. */
      allowedOutboundEvents: z
        .array(z.string())
        .default([
          'integration.event',
          'tickets.created',
          'moderation.ban.issued',
        ]),
    })
    .default({
      enabled: true,
      maxAttempts: 8,
      backoff: { type: 'exponential', baseDelayMs: 2_000, maxDelayMs: 900_000 },
      requestTimeoutMs: 10_000,
      allowedOutboundEvents: [
        'integration.event',
        'tickets.created',
        'moderation.ban.issued',
      ],
    }),
});

export type WebhooksConfig = z.infer<typeof webhooksConfigSchema>;

function num(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function bool(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  return value !== 'false' && value !== '0';
}

function list(value: string | undefined): string[] | undefined {
  if (value === undefined || value === '') return undefined;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Builds the global config from ENV, applying schema defaults for gaps. */
export function resolveWebhooksConfig(
  env: Record<string, string | undefined>,
): WebhooksConfig {
  return webhooksConfigSchema.parse({
    maxInboundBodyBytes: num(env['WEBHOOKS_MAX_INBOUND_BODY_BYTES']),
    signatureToleranceSeconds: num(env['WEBHOOKS_SIGNATURE_TOLERANCE_SECONDS']),
    dedupeTtlSeconds: num(env['WEBHOOKS_DEDUPE_TTL_SECONDS']),
    cacheTtlSeconds: num(env['WEBHOOKS_CACHE_TTL_SECONDS']),
    inbound: {
      enabled: bool(env['WEBHOOKS_INBOUND_ENABLED']),
      maxConcurrency: num(env['WEBHOOKS_INBOUND_MAX_CONCURRENCY']),
    },
    outbound: {
      enabled: bool(env['WEBHOOKS_OUTBOUND_ENABLED']),
      maxAttempts: num(env['WEBHOOKS_OUTBOUND_MAX_ATTEMPTS']),
      backoff: {
        type: env['WEBHOOKS_OUTBOUND_BACKOFF_TYPE'],
        baseDelayMs: num(env['WEBHOOKS_OUTBOUND_BACKOFF_BASE_MS']),
        maxDelayMs: num(env['WEBHOOKS_OUTBOUND_BACKOFF_MAX_MS']),
      },
      requestTimeoutMs: num(env['WEBHOOKS_OUTBOUND_REQUEST_TIMEOUT_MS']),
      allowedOutboundEvents: list(env['WEBHOOKS_ALLOWED_OUTBOUND_EVENTS']),
    },
  });
}
