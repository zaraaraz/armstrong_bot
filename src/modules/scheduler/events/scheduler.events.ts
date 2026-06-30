import type { ScheduleStatus } from '../domain/schedule.entity';

/** Namespaced lifecycle event names emitted on the core Event Bus. */
export const SchedulerEvents = {
  Scheduled: 'scheduler.job.scheduled',
  Started: 'scheduler.job.started',
  Completed: 'scheduler.job.completed',
  Failed: 'scheduler.job.failed',
  Retried: 'scheduler.job.retried',
  DeadLettered: 'scheduler.job.dead_lettered',
  Cancelled: 'scheduler.job.cancelled',
  Deferred: 'scheduler.job.deferred', // pushed past a maintenance window
} as const;

export type SchedulerEventName =
  (typeof SchedulerEvents)[keyof typeof SchedulerEvents];

export interface JobLifecyclePayload {
  readonly jobId: string;
  readonly kind: string;
  readonly guildId: string | null;
  readonly status: ScheduleStatus;
  readonly attempt: number;
  readonly scheduledFor: string; // ISO
  readonly occurredAt: string; // ISO
  readonly traceId: string;
  readonly error?: { readonly code: string; readonly message: string };
}
