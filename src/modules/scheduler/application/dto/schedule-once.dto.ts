import { z } from 'zod';

/**
 * Input contract for {@link SchedulerService.scheduleOnce}. Exactly one of
 * `runAt` / `delayMs` must be provided.
 */
export const scheduleOnceSchema = z
  .object({
    guildId: z.string().nullable(),
    kind: z.string().min(1),
    payload: z.unknown(),
    runAt: z.coerce.date().optional(),
    delayMs: z.number().int().min(0).optional(),
    idempotencyKey: z.string().min(1).optional(),
    deferrableInMaintenance: z.boolean().default(true),
    maxAttempts: z.number().int().min(1).max(20).optional(),
  })
  .refine(
    (v) => (v.runAt === undefined) !== (v.delayMs === undefined),
    'Exactly one of runAt or delayMs must be provided',
  );

export interface ScheduleOnceInput<TPayload = unknown> {
  guildId: string | null;
  kind: string;
  payload: TPayload;
  runAt?: Date;
  delayMs?: number;
  idempotencyKey?: string;
  deferrableInMaintenance?: boolean;
  maxAttempts?: number;
}
