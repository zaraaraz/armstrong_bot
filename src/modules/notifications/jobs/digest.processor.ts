import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import {
  DIGEST_BUILD_JOB,
  NOTIFICATIONS_DIGEST_QUEUE,
} from '../notifications.constants';
import { NotificationQueues } from './queues';

/**
 * BullMQ worker draining `notifications.digest`. A guild with digest enabled
 * gets a repeatable job (registered via {@link NotificationQueues.ensureDigestJob})
 * whose id encodes the guildId. The build step is a seam: today it logs; the
 * per-category digest summarisation listed in section 15 (Future Extensions)
 * plugs in here without touching the queue or the delivery pipeline.
 */
@Injectable()
export class DigestProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('notifications.digest.worker');
  private worker: Worker | null = null;

  constructor(private readonly queues: NotificationQueues) {}

  onModuleInit(): void {
    this.worker = new Worker(
      NOTIFICATIONS_DIGEST_QUEUE,
      (job) => this.process(job),
      { connection: this.queues.connection, concurrency: 2 },
    );
    this.worker.on('error', (err) =>
      this.logger.warn(`worker error: ${err.message}`),
    );
  }

  private async process(job: Job): Promise<void> {
    if (job.name !== DIGEST_BUILD_JOB) return;
    // jobId is `digest:<guildId>`.
    const guildId = String(job.id ?? '').replace(/^digest:/, '');
    this.logger.debug(`building digest for guild ${guildId || 'unknown'}`);
    // Digest aggregation + dispatch is a documented future extension; the
    // recurring trigger and worker exist so enabling it is additive.
    await Promise.resolve();
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
  }
}
