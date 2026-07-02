import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import {
  OUTBOUND_DELIVER_JOB,
  WEBHOOKS_OUTBOUND_QUEUE,
} from '../webhooks.constants';
import { WebhooksQueues, type OutboundDeliverJobData } from './webhooks.queue';
import { OutboundDispatchService } from '../application/outbound-dispatch.service';

/**
 * BullMQ worker draining `webhooks.outbound`. For each job it signs and POSTs the
 * stored payload to the subscription target via
 * {@link OutboundDispatchService.deliver}; a retryable failure throws so BullMQ
 * applies exponential backoff. Once attempts are exhausted the `failed` handler
 * calls {@link OutboundDispatchService.onExhausted} to mark the delivery
 * `dead_lettered` and emit `webhooks.outbound.dead_lettered`.
 */
@Injectable()
export class OutboundDeliveryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('webhooks.outbound.worker');
  private worker: Worker<OutboundDeliverJobData> | null = null;

  constructor(
    private readonly queues: WebhooksQueues,
    private readonly dispatch: OutboundDispatchService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<OutboundDeliverJobData>(
      WEBHOOKS_OUTBOUND_QUEUE,
      (job) => this.process(job),
      { connection: this.queues.connection, concurrency: 10 },
    );
    this.worker.on('error', (err) =>
      this.logger.warn(`worker error: ${err.message}`),
    );
    this.worker.on('failed', (job, err) => {
      if (!job) return;
      const attempts = job.opts.attempts ?? 1;
      if (job.attemptsMade >= attempts) {
        this.logger.error(
          `outbound delivery ${job.data.outboundDeliveryId} dead-lettered: ${err.message}`,
        );
        void this.dispatch.onExhausted(job.data.outboundDeliveryId);
      }
    });
  }

  private async process(job: Job<OutboundDeliverJobData>): Promise<void> {
    if (job.name !== OUTBOUND_DELIVER_JOB) return;
    // A retryable failure throws so BullMQ retries with backoff; the `failed`
    // handler dead-letters once attempts are exhausted.
    await this.dispatch.deliver(job.data.outboundDeliveryId);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
  }
}
