import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  METRICS_QUEUE,
  METRICS_RETENTION_JOB,
  METRICS_SNAPSHOT_JOB,
} from '../metrics.constants';

/**
 * Module-private BullMQ producer for the recurring snapshot + retention jobs.
 * Mirrors the audit/scheduler queue pattern — there is no shared core Queue
 * layer. Both jobs are idempotent recurring jobs keyed by a stable jobId.
 */
@Injectable()
export class MetricsQueue implements OnModuleDestroy {
  private readonly logger = new Logger(MetricsQueue.name);
  readonly connection: { host: string; port: number };
  readonly queue: Queue<Record<string, never>>;

  constructor(config: ConfigService) {
    this.connection = {
      host: config.get<string>('REDIS_HOST', 'localhost'),
      port: config.get<number>('REDIS_PORT', 6379),
    };
    this.queue = new Queue(METRICS_QUEUE, { connection: this.connection });
  }

  /** Registers (idempotently) the recurring snapshot job. */
  async ensureSnapshotJob(cron: string): Promise<void> {
    await this.queue.add(
      METRICS_SNAPSHOT_JOB,
      {},
      {
        jobId: METRICS_SNAPSHOT_JOB,
        repeat: { pattern: cron },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 50 },
      },
    );
  }

  /** Registers (idempotently) the daily retention sweep. */
  async ensureRetentionJob(cron: string): Promise<void> {
    await this.queue.add(
      METRICS_RETENTION_JOB,
      {},
      {
        jobId: METRICS_RETENTION_JOB,
        repeat: { pattern: cron },
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 10 },
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close().catch(() => undefined);
    this.logger.debug('metrics queue closed');
  }
}
