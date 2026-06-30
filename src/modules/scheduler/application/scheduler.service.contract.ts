import type { ScheduledJobRef } from '../domain/schedule.entity';
import type { ScheduleOnceInput } from './dto/schedule-once.dto';
import type { ScheduleRecurringInput } from './dto/schedule-recurring.dto';

/**
 * The public scheduling contract. This is the ONLY scheduler surface other
 * modules may depend on — they never touch BullMQ/Redis directly.
 *
 * All control methods are guild-scoped: passing a `guildId` restricts the action
 * to that guild's jobs; global/system jobs use `null` and require platform-level
 * authority at the call site.
 */
export abstract class SchedulerService {
  abstract scheduleOnce<T>(
    input: ScheduleOnceInput<T>,
  ): Promise<ScheduledJobRef>;
  abstract scheduleRecurring<T>(
    input: ScheduleRecurringInput<T>,
  ): Promise<ScheduledJobRef>;
  abstract cancel(jobId: string, guildId: string | null): Promise<boolean>;
  abstract pause(jobId: string, guildId: string | null): Promise<boolean>;
  abstract resume(jobId: string, guildId: string | null): Promise<boolean>;
  abstract triggerNow(jobId: string, guildId: string | null): Promise<void>;
  abstract get(
    jobId: string,
    guildId: string | null,
  ): Promise<ScheduledJobRef | null>;
}
