import { z } from 'zod';

/**
 * Global scheduler configuration. Resolved from ENV → defaults at bootstrap and
 * applies process-wide (queue concurrency, retry policy, reconcile cadence).
 */
export const schedulerGlobalConfigSchema = z.object({
  concurrency: z.number().int().min(1).max(100).default(8),
  defaultMaxAttempts: z.number().int().min(1).max(20).default(5),
  defaultBackoffMs: z.number().int().min(100).default(5_000),
  backoffStrategy: z.enum(['fixed', 'exponential']).default('exponential'),
  reconcileIntervalMs: z.number().int().min(5_000).default(60_000),
  deadLetterQueue: z.string().min(1).default('scheduler:dlq'),
  runRetentionDays: z.number().int().min(1).max(365).default(30),
});

/**
 * Per-guild scheduler configuration. Resolved ENV → DB (guild row) → defaults.
 * Drives cron timezone evaluation and maintenance-window deferral.
 */
export const maintenanceWindowConfigSchema = z.object({
  cron: z.string().min(1), // start, e.g. '0 3 * * *'
  durationMinutes: z.number().int().min(1).max(1440),
  deferNonCritical: z.boolean().default(true),
});

export const schedulerGuildConfigSchema = z.object({
  timezone: z.string().min(1).default('UTC'),
  maintenanceWindows: z.array(maintenanceWindowConfigSchema).default([]),
  cleanupEnabled: z.boolean().default(true),
});

export type SchedulerGlobalConfig = z.infer<typeof schedulerGlobalConfigSchema>;
export type SchedulerGuildConfig = z.infer<typeof schedulerGuildConfigSchema>;
export type MaintenanceWindowConfig = z.infer<
  typeof maintenanceWindowConfigSchema
>;

/** Coerce raw ENV strings into the global config shape, then Zod-validate. */
export function resolveSchedulerGlobalConfig(
  env: Record<string, string | undefined>,
): SchedulerGlobalConfig {
  const num = (v: string | undefined): number | undefined =>
    v === undefined || v === '' ? undefined : Number(v);

  return schedulerGlobalConfigSchema.parse({
    concurrency: num(env['SCHEDULER_CONCURRENCY']),
    defaultMaxAttempts: num(env['SCHEDULER_MAX_ATTEMPTS']),
    defaultBackoffMs: num(env['SCHEDULER_BACKOFF_MS']),
    backoffStrategy: env['SCHEDULER_BACKOFF_STRATEGY'],
    reconcileIntervalMs: num(env['SCHEDULER_RECONCILE_INTERVAL_MS']),
    deadLetterQueue: env['SCHEDULER_DLQ'],
    runRetentionDays: num(env['SCHEDULER_RUN_RETENTION_DAYS']),
  });
}

/** Merge a (possibly partial) guild override over defaults and validate. */
export function resolveSchedulerGuildConfig(
  override?: Partial<SchedulerGuildConfig>,
): SchedulerGuildConfig {
  return schedulerGuildConfigSchema.parse(override ?? {});
}
