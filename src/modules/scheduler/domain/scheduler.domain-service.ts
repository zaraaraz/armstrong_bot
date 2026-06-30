import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { nextCronRun } from './cron.util';
import { MaintenanceWindow } from './maintenance-window.vo';
import type {
  SchedulerGlobalConfig,
  SchedulerGuildConfig,
} from '../config/scheduler.config';

export interface RetryPolicy {
  readonly attempts: number;
  readonly backoff: {
    readonly type: 'fixed' | 'exponential';
    readonly delay: number;
  };
}

export interface NextRunInput {
  readonly cron?: string | null;
  readonly everyMs?: number | null;
  readonly timezone: string;
  readonly from: Date;
}

/**
 * Pure domain logic for the Scheduler: next-run computation, maintenance-window
 * deferral, idempotency-key derivation and retry-policy selection. No I/O — every
 * input is passed in, which makes this the unit-test surface.
 */
@Injectable()
export class SchedulerDomainService {
  /**
   * Next fire time strictly after `from`. For interval jobs this is
   * `from + everyMs`; for cron it delegates to cron-parser. Returns null when a
   * cron expression has no future occurrence.
   */
  computeNextRun(input: NextRunInput): Date | null {
    if (input.everyMs != null) {
      return new Date(input.from.getTime() + input.everyMs);
    }
    if (input.cron) {
      return nextCronRun(input.cron, input.timezone, input.from);
    }
    return null;
  }

  /**
   * Derive a stable BullMQ job id. An explicit `idempotencyKey` wins; otherwise
   * we hash the identifying tuple so equivalent re-schedules collide and replace.
   */
  deriveIdempotencyKey(params: {
    guildId: string | null;
    kind: string;
    idempotencyKey?: string | null;
    runAt?: Date | null;
  }): string {
    if (params.idempotencyKey) {
      return `${params.guildId ?? 'global'}:${params.kind}:${params.idempotencyKey}`;
    }
    const material = [
      params.guildId ?? 'global',
      params.kind,
      params.runAt ? params.runAt.toISOString() : 'na',
    ].join('|');
    return createHash('sha256').update(material).digest('hex').slice(0, 32);
  }

  /** Select the BullMQ retry policy for a job from global config + per-job override. */
  retryPolicy(
    global: SchedulerGlobalConfig,
    maxAttemptsOverride?: number,
  ): RetryPolicy {
    return {
      attempts: maxAttemptsOverride ?? global.defaultMaxAttempts,
      backoff: {
        type: global.backoffStrategy,
        delay: global.defaultBackoffMs,
      },
    };
  }

  /**
   * Resolve a target run time against a guild's maintenance windows. If `runAt`
   * falls inside an open deferrable window and the job is deferrable, push it to
   * the end of that window. Returns the (possibly deferred) instant plus whether
   * a deferral happened.
   */
  resolveAgainstMaintenance(params: {
    runAt: Date;
    deferrable: boolean;
    guildConfig: SchedulerGuildConfig;
  }): { runAt: Date; deferred: boolean } {
    if (!params.deferrable) return { runAt: params.runAt, deferred: false };

    const windows = params.guildConfig.maintenanceWindows.map((w) =>
      MaintenanceWindow.from(w, params.guildConfig.timezone),
    );

    let cursor = params.runAt;
    let deferred = false;
    // Re-resolve until the instant is clear of every window (windows may chain).
    for (let i = 0; i < windows.length * 2 + 1; i++) {
      const blocking = windows.find(
        (w) => w.deferNonCritical && w.contains(cursor),
      );
      if (!blocking) break;
      const end = blocking.endOfWindowAt(cursor);
      if (!end) break;
      cursor = end;
      deferred = true;
    }
    return { runAt: cursor, deferred };
  }

  /** Compute the cutoff before which `ScheduleRun` rows may be purged. */
  retentionCutoff(global: SchedulerGlobalConfig, now: Date): Date {
    return new Date(now.getTime() - global.runRetentionDays * 86_400_000);
  }
}
