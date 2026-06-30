import { Injectable, Logger } from '@nestjs/common';

export interface SchedulerAuditEntry {
  /** Actor performing the control action (user id, 'system', 'api', etc.). */
  readonly actor: string;
  readonly guildId: string | null;
  readonly action:
    | 'scheduler.pause'
    | 'scheduler.resume'
    | 'scheduler.cancel'
    | 'scheduler.trigger'
    | 'scheduler.config';
  readonly jobId: string | null;
  readonly before?: string | null;
  readonly after?: string | null;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Audit sink for scheduler control actions. For now it emits structured Pino
 * logs under the `scheduler.audit` category; once the core Audit module
 * (roadmap item 15) lands, this delegates to it without changing callers.
 */
@Injectable()
export class SchedulerAuditService {
  private readonly logger = new Logger('scheduler.audit');

  record(entry: SchedulerAuditEntry): void {
    this.logger.log(
      JSON.stringify({
        category: 'scheduler.audit',
        actor: entry.actor,
        guildId: entry.guildId,
        action: entry.action,
        jobId: entry.jobId,
        before: entry.before ?? null,
        after: entry.after ?? null,
        ...(entry.metadata ? { metadata: entry.metadata } : {}),
      }),
    );
  }
}
