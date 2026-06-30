/**
 * Lifecycle status of a schedule. Mirrors the Prisma `ScheduleStatus` enum and
 * is part of the public contract (DTOs and events expose these literals).
 */
export type ScheduleStatus =
  | 'pending'
  | 'active' // recurring + registered in BullMQ
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type ScheduleType = 'once' | 'recurring';

/**
 * Domain representation of a persisted schedule row. Internal to the module;
 * consumers see only {@link ScheduledJobRef}.
 */
export interface ScheduleEntity {
  readonly id: string;
  readonly guildId: string | null;
  readonly kind: string;
  readonly type: ScheduleType;
  readonly status: ScheduleStatus;
  readonly payload: unknown;
  readonly idempotencyKey: string | null;
  readonly cron: string | null;
  readonly everyMs: number | null;
  readonly timezone: string;
  readonly nextRunAt: Date | null;
  readonly lastRunAt: Date | null;
  readonly deferrable: boolean;
  readonly maxAttempts: number;
  readonly bullJobId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

/** A live execution attempt record. */
export interface ScheduleRunEntity {
  readonly id: string;
  readonly scheduleId: string;
  readonly guildId: string | null;
  readonly attempt: number;
  readonly status: ScheduleStatus;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  readonly durationMs: number | null;
  readonly error: string | null;
  readonly traceId: string | null;
}

/**
 * The opaque reference handed back to consumers from the public scheduling API.
 * Deliberately narrow: no payload, no BullMQ internals.
 */
export interface ScheduledJobRef {
  readonly id: string;
  readonly kind: string;
  readonly guildId: string | null;
  readonly status: ScheduleStatus;
  readonly nextRunAt: Date | null;
}

export function toJobRef(entity: ScheduleEntity): ScheduledJobRef {
  return {
    id: entity.id,
    kind: entity.kind,
    guildId: entity.guildId,
    status: entity.status,
    nextRunAt: entity.nextRunAt,
  };
}
