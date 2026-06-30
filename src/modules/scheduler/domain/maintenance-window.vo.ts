import { CronExpressionParser } from 'cron-parser';
import type { MaintenanceWindowConfig } from '../config/scheduler.config';

/**
 * Immutable value object describing a recurring maintenance window: a cron-defined
 * start plus a fixed duration. Used by the domain service to decide whether a
 * deferrable job should be pushed past an open window.
 */
export class MaintenanceWindow {
  private constructor(
    readonly cron: string,
    readonly durationMs: number,
    readonly deferNonCritical: boolean,
    readonly timezone: string,
  ) {}

  static from(
    config: MaintenanceWindowConfig,
    timezone: string,
  ): MaintenanceWindow {
    return new MaintenanceWindow(
      config.cron,
      config.durationMinutes * 60_000,
      config.deferNonCritical,
      timezone,
    );
  }

  /**
   * The most recent window start at or before `at`, if `at` falls inside that
   * window. Returns null when `at` is not within any occurrence.
   */
  private startCovering(at: Date): Date | null {
    const interval = CronExpressionParser.parse(this.cron, {
      tz: this.timezone,
      currentDate: at,
    });
    // cron-parser's `prev()` walks backwards from currentDate.
    const prev = interval.prev().toDate();
    return at.getTime() - prev.getTime() < this.durationMs ? prev : null;
  }

  /** Whether `at` falls inside an open occurrence of this window. */
  contains(at: Date): boolean {
    return this.startCovering(at) !== null;
  }

  /** The instant this window closes for the occurrence covering `at`, else null. */
  endOfWindowAt(at: Date): Date | null {
    const start = this.startCovering(at);
    return start ? new Date(start.getTime() + this.durationMs) : null;
  }
}
