import { z } from 'zod';

/**
 * Global metrics configuration, sourced from ENV with Zod defaults. Guild
 * overrides apply only to alerting thresholds (see {@link metricsGuildConfigSchema});
 * everything here is process-wide.
 */
export const metricsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  endpointPath: z.string().startsWith('/').default('/metrics'),
  // If unset, the scrape guard falls back to CIDR allow-list only.
  endpointBearerToken: z.string().min(16).optional(),
  endpointAllowlistCidrs: z
    .array(z.string())
    .default(['127.0.0.1/32', '::1/128']),
  defaultMetricsEnabled: z.boolean().default(true),
  collectIntervalMs: z.number().int().min(1000).default(10_000),
  histogramBucketsSeconds: z
    .array(z.number().positive())
    .default([0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]),
  tracing: z
    .object({
      enabled: z.boolean().default(true),
      otlpEndpoint: z.string().url().default('http://localhost:4318/v1/traces'),
      sampleRatio: z.number().min(0).max(1).default(0.1),
      serviceName: z.string().default('ghost-bot'),
    })
    .default({
      enabled: true,
      otlpEndpoint: 'http://localhost:4318/v1/traces',
      sampleRatio: 0.1,
      serviceName: 'ghost-bot',
    }),
  snapshot: z
    .object({
      enabled: z.boolean().default(true),
      cron: z.string().default('*/1 * * * *'),
      retentionDays: z.number().int().min(1).default(30),
    })
    .default({ enabled: true, cron: '*/1 * * * *', retentionDays: 30 }),
  thresholds: z
    .array(
      z.object({
        metric: z.string(),
        comparator: z.enum(['gt', 'lt', 'gte', 'lte']),
        value: z.number(),
        severity: z.enum(['warning', 'critical']).default('warning'),
      }),
    )
    .default([
      {
        metric: 'ghost_event_loop_lag_seconds',
        comparator: 'gt',
        value: 0.2,
        severity: 'critical',
      },
      {
        metric: 'ghost_queue_dlq_depth',
        comparator: 'gt',
        value: 0,
        severity: 'warning',
      },
    ]),
});

export type MetricsConfig = z.infer<typeof metricsConfigSchema>;

/** Per-guild override blob (GuildConfig.settings.metrics). Thresholds only. */
export const metricsGuildConfigSchema = z.object({
  thresholds: z
    .array(
      z.object({
        metric: z.string(),
        comparator: z.enum(['gt', 'lt', 'gte', 'lte']),
        value: z.number(),
        severity: z.enum(['warning', 'critical']).default('warning'),
        enabled: z.boolean().default(true),
      }),
    )
    .default([]),
});

export type MetricsGuildConfig = z.infer<typeof metricsGuildConfigSchema>;

function num(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function bool(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  return value !== 'false' && value !== '0';
}

function csv(value: string | undefined): string[] | undefined {
  if (value === undefined || value === '') return undefined;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function numList(value: string | undefined): number[] | undefined {
  const parts = csv(value);
  if (!parts) return undefined;
  const nums = parts.map(Number).filter((n) => Number.isFinite(n));
  return nums.length > 0 ? nums : undefined;
}

/**
 * Resolves the global config from ENV, layering `METRICS_*` overrides on top of
 * the Zod defaults. `undefined` entries are dropped by Zod, so a missing ENV
 * var falls through to the schema default (ENV -> defaults priority).
 */
export function resolveMetricsConfig(
  env: Record<string, string | undefined>,
): MetricsConfig {
  return metricsConfigSchema.parse({
    enabled: bool(env['METRICS_ENABLED']),
    endpointPath: env['METRICS_ENDPOINT_PATH'],
    endpointBearerToken: env['METRICS_ENDPOINT_BEARER_TOKEN'] || undefined,
    endpointAllowlistCidrs: csv(env['METRICS_ENDPOINT_ALLOWLIST_CIDRS']),
    defaultMetricsEnabled: bool(env['METRICS_DEFAULT_METRICS_ENABLED']),
    collectIntervalMs: num(env['METRICS_COLLECT_INTERVAL_MS']),
    histogramBucketsSeconds: numList(env['METRICS_HISTOGRAM_BUCKETS_SECONDS']),
    tracing: {
      enabled: bool(env['METRICS_TRACING_ENABLED']),
      otlpEndpoint: env['METRICS_TRACING_OTLP_ENDPOINT'],
      sampleRatio: num(env['METRICS_TRACING_SAMPLE_RATIO']),
      serviceName: env['METRICS_TRACING_SERVICE_NAME'],
    },
    snapshot: {
      enabled: bool(env['METRICS_SNAPSHOT_ENABLED']),
      cron: env['METRICS_SNAPSHOT_CRON'],
      retentionDays: num(env['METRICS_SNAPSHOT_RETENTION_DAYS']),
    },
  });
}
