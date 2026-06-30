import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, type JobsOptions, type RepeatOptions } from 'bullmq';
import { SCHEDULER_QUEUE } from './queue.tokens';

export interface SchedulerJobData {
  readonly scheduleId: string;
  readonly kind: string;
  readonly guildId: string | null;
  readonly payload: unknown;
  readonly scheduledFor: string; // ISO
}

/**
 * The Scheduler's private wrapper around the BullMQ producer side. No other
 * module may construct a Queue against {@link SCHEDULER_QUEUE}; this is the only
 * sanctioned enqueue path. Honours the "never leak BullMQ to consumers" rule.
 */
@Injectable()
export class SchedulerQueue implements OnModuleDestroy {
  private readonly logger = new Logger(SchedulerQueue.name);
  readonly connection: { host: string; port: number };
  readonly queue: Queue<SchedulerJobData>;

  constructor(config: ConfigService) {
    this.connection = {
      host: config.get<string>('REDIS_HOST', 'localhost'),
      port: config.get<number>('REDIS_PORT', 6379),
    };
    this.queue = new Queue<SchedulerJobData>(SCHEDULER_QUEUE, {
      connection: this.connection,
    });
  }

  /** Enqueue a one-shot delayed job. `jobId` enforces idempotent replacement. */
  async addOnce(
    jobId: string,
    data: SchedulerJobData,
    delayMs: number,
    opts: JobsOptions,
  ): Promise<void> {
    // Remove any prior pending job with the same id so re-schedule replaces it.
    await this.removeJob(jobId);
    await this.queue.add(data.kind, data, {
      jobId,
      delay: Math.max(0, delayMs),
      ...opts,
    });
    this.logger.debug(`Enqueued once job ${jobId} delay=${delayMs}ms`);
  }

  /** Register (or replace) a repeatable job. Returns the BullMQ repeat key. */
  async addRecurring(
    name: string,
    data: SchedulerJobData,
    repeat: RepeatOptions,
    opts: JobsOptions,
  ): Promise<string> {
    const job = await this.queue.add(name, data, {
      repeat,
      jobId: data.scheduleId,
      ...opts,
    });
    return job.repeatJobKey ?? data.scheduleId;
  }

  /** Remove a one-shot job (if still pending) by id. */
  async removeJob(jobId: string): Promise<void> {
    const job = await this.queue.getJob(jobId);
    if (job) await job.remove().catch(() => undefined);
  }

  /** Remove a repeatable job by its repeat key. */
  async removeRepeatable(repeatKey: string): Promise<void> {
    await this.queue.removeRepeatableByKey(repeatKey).catch(() => undefined);
  }

  /** Immediately enqueue a job for execution (trigger-now), bypassing delay. */
  async addImmediate(data: SchedulerJobData, opts: JobsOptions): Promise<void> {
    await this.queue.add(data.kind, data, { ...opts });
  }

  async depth(): Promise<number> {
    const counts = await this.queue.getJobCounts('waiting', 'delayed');
    return (counts['waiting'] ?? 0) + (counts['delayed'] ?? 0);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close().catch(() => undefined);
  }
}
