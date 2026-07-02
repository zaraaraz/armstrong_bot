import { z } from 'zod';
import { METRIC_SCOPES } from '../domain/metric-scope';

const isoDate = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'invalid ISO-8601 date')
  .transform((v) => new Date(v));

/** Query params for the paginated historical snapshot endpoint. */
export const metricsRangeQuerySchema = z.object({
  guildId: z.string().max(32).optional(),
  from: isoDate,
  to: isoDate,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export type MetricsRangeQueryDto = z.infer<typeof metricsRangeQuerySchema>;

/** Body for upserting a guild threshold override. */
export const upsertThresholdSchema = z.object({
  comparator: z.enum(['gt', 'lt', 'gte', 'lte']),
  value: z.number(),
  severity: z.enum(['warning', 'critical']).default('warning'),
  enabled: z.boolean().default(true),
});

export type UpsertThresholdDto = z.infer<typeof upsertThresholdSchema>;

export const scopeParamSchema = z.enum(
  METRIC_SCOPES as unknown as [string, ...string[]],
);
