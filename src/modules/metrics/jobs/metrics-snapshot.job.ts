import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { MetricsQueue } from '../infrastructure/metrics.queue';
import { MetricsSnapshotWriter } from '../application/metrics-snapshot.writer';
import { MetricsConfigService } from '../config/metrics-config.service';
import {
  METRICS_QUEUE,
  METRICS_RETENTION_JOB,
  METRICS_SNAPSHOT_JOB,
} from '../metrics.constants';

const RETENTION_CRON = '0 3 * * *'; // daily 03:00

/**
 * BullMQ worker draining `metrics.snapshot`. Runs the recurring snapshot
 * capture and the daily retention sweep. Registered idempotently on init; the
 * worker is closed on shutdown. All heavy work is off the hot path here.
 */
@Injectable()
export class MetricsSnapshotJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('metrics.snapshot.worker');
  private worker: Worker<Record<string, never>> | null = null;

  constructor(
    private readonly queue: MetricsQueue,
    private readonly writer: MetricsSnapshotWriter,
    private readonly config: MetricsConfigService,
  ) {}

  onModuleInit(): void {
    const cfg = this.config.global();
    if (!cfg.enabled || !cfg.snapshot.enabled) {
      this.logger.log('snapshot job disabled by config');
      return;
    }

    this.worker = new Worker(METRICS_QUEUE, (job) => this.process(job), {
      connection: this.queue.connection,
      concurrency: 1,
    });
    this.worker.on('error', (err) => {
      this.logger.warn(`worker error: ${err.message}`);
    });
    this.worker.on('failed', (job, err) => {
      this.logger.error(`job ${job?.id} failed: ${err.message}`);
    });

    void this.queue
      .ensureSnapshotJob(cfg.snapshot.cron)
      .catch((err: Error) =>
        this.logger.warn(`could not register snapshot job: ${err.message}`),
      );
    void this.queue
      .ensureRetentionJob(RETENTION_CRON)
      .catch((err: Error) =>
        this.logger.warn(`could not register retention job: ${err.message}`),
      );
  }

  private async process(job: Job<Record<string, never>>): Promise<void> {
    if (job.name === METRICS_SNAPSHOT_JOB) {
      await this.writer.capture();
      return;
    }
    if (job.name === METRICS_RETENTION_JOB) {
      await this.writer.prune();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
  }
}
