import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import {
  INBOUND_PROCESS_JOB,
  WEBHOOKS_INBOUND_QUEUE,
} from '../webhooks.constants';
import { WebhooksQueues, type InboundProcessJobData } from './webhooks.queue';
import { InboundWebhookService } from '../application/inbound-webhook.service';

/**
 * BullMQ worker draining `webhooks.inbound`. For each received delivery it hands
 * the internal delivery id to {@link InboundWebhookService.process}, which
 * normalizes the stored raw body and publishes the resulting `IntegrationEvent`
 * on the Event Bus. A thrown error propagates so BullMQ applies backoff and
 * retries; once attempts are exhausted the job stays in `failed` (the DLQ).
 */
@Injectable()
export class InboundProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('webhooks.inbound.worker');
  private worker: Worker<InboundProcessJobData> | null = null;

  constructor(
    private readonly queues: WebhooksQueues,
    private readonly service: InboundWebhookService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<InboundProcessJobData>(
      WEBHOOKS_INBOUND_QUEUE,
      (job) => this.process(job),
      { connection: this.queues.connection, concurrency: 10 },
    );
    this.worker.on('error', (err) =>
      this.logger.warn(`worker error: ${err.message}`),
    );
  }

  private async process(job: Job<InboundProcessJobData>): Promise<void> {
    if (job.name !== INBOUND_PROCESS_JOB) return;
    // Let processing errors throw so BullMQ retries with backoff.
    await this.service.process(job.data.internalDeliveryId);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
  }
}
