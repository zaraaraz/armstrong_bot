import type { JobLifecyclePayload } from '../../../../modules/scheduler/events/scheduler.events';

export interface MaintenanceWindowPayload {
  readonly guildId: string | null;
  readonly source: string;
  readonly endsAt: string | null; // ISO; null when not time-bounded
  readonly occurredAt: string; // ISO
}

/**
 * Scheduler lifecycle events (emitted) plus the maintenance-window events the
 * Scheduler consumes from the core/system maintenance source.
 */
export interface SchedulerEventPayloads {
  'scheduler.job.scheduled': JobLifecyclePayload;
  'scheduler.job.started': JobLifecyclePayload;
  'scheduler.job.completed': JobLifecyclePayload;
  'scheduler.job.failed': JobLifecyclePayload;
  'scheduler.job.retried': JobLifecyclePayload;
  'scheduler.job.dead_lettered': JobLifecyclePayload;
  'scheduler.job.cancelled': JobLifecyclePayload;
  'scheduler.job.deferred': JobLifecyclePayload;
  'maintenance.window.opened': MaintenanceWindowPayload;
  'maintenance.window.closed': MaintenanceWindowPayload;
}
