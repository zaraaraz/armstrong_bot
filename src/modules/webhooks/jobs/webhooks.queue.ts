import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  INBOUND_PROCESS_JOB,
  OUTBOUND_DELIVER_JOB,
  WEBHOOKS_INBOUND_QUEUE,
  WEBHOOKS_OUTBOUND_QUEUE,
} from '../webhooks.constants';

/** Payload of one `webhooks.inbound` process job (one per received delivery). */
export interface InboundProcessJobData {
  readonly internalDeliveryId: string;
}

/** Payload of one `webhooks.outbound` deliver job (one per subscription match). */
export interface OutboundDeliverJobData {
  readonly outboundDeliveryId: string;
  readonly subscriptionId: string;
}

/**
 * Module-private wrappers over the two BullMQ producers. Mirrors the
 * notifications queue pattern — no shared core Queue layer exists. Retries,
 * backoff and DLQ semantics live on the job options here; the workers in
 * `*.worker.ts` consume them. `removeOnFail: false` IS the dead-letter queue.
 */
@Injectable()
export class WebhooksQueues implements OnModuleDestroy {
  private readonly logger = new Logger(WebhooksQueues.name);
  readonly connection: { host: string; port: number };
  readonly inbound: Queue<InboundProcessJobData>;
  readonly outbound: Queue<OutboundDeliverJobData>;

  constructor(config: ConfigService) {
    this.connection = {
      host: config.get<string>('REDIS_HOST', 'localhost'),
      port: config.get<number>('REDIS_PORT', 6379),
    };
    this.inbound = new Queue(WEBHOOKS_INBOUND_QUEUE, {
      connection: this.connection,
    });
    this.outbound = new Queue(WEBHOOKS_OUTBOUND_QUEUE, {
      connection: this.connection,
    });
  }

  /**
   * Enqueues normalization + fan-out of a received inbound delivery. `jobId` is
   * derived from the internal delivery id so a duplicate enqueue (replay)
   * collapses onto the same job. Backoff is exponential; on final failure the
   * job stays in `failed` (the DLQ) for the inspector.
   */
  async enqueueInboundProcess(data: InboundProcessJobData): Promise<void> {
    await this.inbound.add(INBOUND_PROCESS_JOB, data, {
      jobId: `inbound:${data.internalDeliveryId}`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: false, // keep for the DLQ inspector
    });
  }

  /**
   * Enqueues one outbound delivery attempt. `jobId` is derived from the outbound
   * delivery id so a duplicate enqueue collapses onto the same job. Backoff is
   * exponential; on exhaustion the job stays in `failed` (the DLQ).
   */
  async enqueueOutboundDeliver(
    data: OutboundDeliverJobData,
    opts: { attempts: number; backoffMs: number },
  ): Promise<void> {
    await this.outbound.add(OUTBOUND_DELIVER_JOB, data, {
      jobId: `outbound:${data.outboundDeliveryId}`,
      attempts: opts.attempts,
      backoff: { type: 'exponential', delay: opts.backoffMs },
      removeOnComplete: { count: 1000 },
      removeOnFail: false, // keep for the DLQ inspector
    });
  }

  async inboundDepth(): Promise<number> {
    const counts = await this.inbound.getJobCounts('waiting', 'delayed');
    return (counts['waiting'] ?? 0) + (counts['delayed'] ?? 0);
  }

  async outboundDlqSize(): Promise<number> {
    const counts = await this.outbound.getJobCounts('failed');
    return counts['failed'] ?? 0;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([
      this.inbound.close().catch(() => undefined),
      this.outbound.close().catch(() => undefined),
    ]);
    this.logger.debug('webhook queues closed');
  }
}
