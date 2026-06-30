/**
 * Scheduler module — PUBLIC API barrel.
 *
 * These are the ONLY symbols other modules may import. Everything else
 * (repositories, the queue wrapper, the worker, the reconciler) is internal and
 * must not be reached into. Consuming modules:
 *   1. register a {@link JobHandler} with {@link JobRegistry} at bootstrap, and
 *   2. schedule work through {@link SchedulerService}.
 * They never touch BullMQ/Redis.
 */
export { SchedulerModule } from './scheduler.module';

// Scheduling contract
export { SchedulerService } from './application/scheduler.service.contract';
export type { ScheduleOnceInput } from './application/dto/schedule-once.dto';
export type { ScheduleRecurringInput } from './application/dto/schedule-recurring.dto';

// Handler contract + registry
export { JobRegistry } from './domain/job-registry';
export type {
  JobHandler,
  JobExecutionContext,
} from './domain/job-handler.interface';
export { JobKind } from './domain/job-kind.enum';

// Public value types
export type {
  ScheduledJobRef,
  ScheduleStatus,
  ScheduleType,
} from './domain/schedule.entity';

// Events
export {
  SchedulerEvents,
  type SchedulerEventName,
  type JobLifecyclePayload,
} from './events/scheduler.events';
