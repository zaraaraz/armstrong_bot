import { z } from 'zod';
import { isValidCron } from '../../domain/cron.util';

/**
 * Input contract for {@link SchedulerService.scheduleRecurring}. Exactly one of
 * `cron` / `everyMs` must be provided. `idempotencyKey` is required and acts as
 * the stable identity for re-scheduling.
 */
export const scheduleRecurringSchema = z
  .object({
    guildId: z.string().nullable(),
    kind: z.string().min(1),
    payload: z.unknown(),
    cron: z.string().min(1).optional(),
    everyMs: z.number().int().min(1_000).optional(),
    timezone: z.string().min(1).optional(),
    idempotencyKey: z.string().min(1),
    deferrableInMaintenance: z.boolean().default(true),
    maxAttempts: z.number().int().min(1).max(20).optional(),
  })
  .refine(
    (v) => (v.cron === undefined) !== (v.everyMs === undefined),
    'Exactly one of cron or everyMs must be provided',
  )
  .refine(
    (v) => v.cron === undefined || isValidCron(v.cron, v.timezone ?? 'UTC'),
    'Invalid cron expression',
  );

export interface ScheduleRecurringInput<TPayload = unknown> {
  guildId: string | null;
  kind: string;
  payload: TPayload;
  cron?: string;
  everyMs?: number;
  timezone?: string;
  idempotencyKey: string;
  deferrableInMaintenance?: boolean;
  maxAttempts?: number;
}
