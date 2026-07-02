import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  DELIVERY_JOB,
  DIGEST_BUILD_JOB,
  INTEGRATION_POLL_JOB,
  NOTIFICATIONS_DELIVERY_QUEUE,
  NOTIFICATIONS_DIGEST_QUEUE,
  NOTIFICATIONS_INTEGRATION_POLL_QUEUE,
} from '../notifications.constants';
import type { IntegrationProviderName } from '../infrastructure/integration-subscription.repository';

/** Payload of one `notifications.delivery` job (one per resolved channel). */
export interface DeliveryJobData {
  readonly deliveryId: string;
  readonly notificationId: string;
}

export interface IntegrationPollJobData {
  readonly provider: IntegrationProviderName;
}

/**
 * Module-private wrappers over the three BullMQ producers. Mirrors the
 * scheduler/audit queue pattern — no shared core Queue layer exists. Retries,
 * backoff and DLQ semantics live on the job options here; the workers in
 * `*.processor.ts` consume them.
 */
@Injectable()
export class NotificationQueues implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationQueues.name);
  readonly connection: { host: string; port: number };
  readonly delivery: Queue<DeliveryJobData>;
  readonly digest: Queue<Record<string, never>>;
  readonly integrationPoll: Queue<IntegrationPollJobData>;

  constructor(config: ConfigService) {
    this.connection = {
      host: config.get<string>('REDIS_HOST', 'localhost'),
      port: config.get<number>('REDIS_PORT', 6379),
    };
    this.delivery = new Queue(NOTIFICATIONS_DELIVERY_QUEUE, {
      connection: this.connection,
    });
    this.digest = new Queue(NOTIFICATIONS_DIGEST_QUEUE, {
      connection: this.connection,
    });
    this.integrationPoll = new Queue(NOTIFICATIONS_INTEGRATION_POLL_QUEUE, {
      connection: this.connection,
    });
  }

  /**
   * Enqueues one delivery attempt. `jobId` is derived from the deliveryId so a
   * duplicate enqueue (event replay) collapses onto the same job. Backoff is
   * exponential; on final failure the job stays in `failed` (the DLQ).
   */
  async enqueueDelivery(
    data: DeliveryJobData,
    opts: { attempts: number; backoffMs: number; delayMs?: number },
  ): Promise<void> {
    await this.delivery.add(DELIVERY_JOB, data, {
      jobId: `deliver:${data.deliveryId}`,
      attempts: opts.attempts,
      backoff: { type: 'exponential', delay: opts.backoffMs },
      delay: opts.delayMs && opts.delayMs > 0 ? opts.delayMs : undefined,
      removeOnComplete: { count: 1000 },
      removeOnFail: false, // keep for the DLQ inspector
    });
  }

  /** Removes a still-queued delivery job (used by cancelPending). */
  async removeDelivery(deliveryId: string): Promise<void> {
    const job = await this.delivery.getJob(`deliver:${deliveryId}`);
    // Only remove jobs that have not started; a completed/active job is a no-op.
    await job?.remove().catch(() => undefined);
  }

  /** Registers (idempotently) a guild's recurring digest build. */
  async ensureDigestJob(guildId: string, cron: string): Promise<void> {
    await this.digest.add(
      DIGEST_BUILD_JOB,
      {},
      {
        jobId: `digest:${guildId}`,
        repeat: { pattern: cron },
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 10 },
      },
    );
  }

  async removeDigestJob(guildId: string): Promise<void> {
    const scheduler = await this.digest
      .getJobScheduler(`digest:${guildId}`)
      .catch(() => null);
    if (scheduler) {
      await this.digest
        .removeJobScheduler(`digest:${guildId}`)
        .catch(() => undefined);
    }
  }

  /** Registers (idempotently) the recurring poll for one integration provider. */
  async ensurePollJob(
    provider: IntegrationProviderName,
    everySeconds: number,
  ): Promise<void> {
    await this.integrationPoll.add(
      INTEGRATION_POLL_JOB,
      { provider },
      {
        jobId: `poll:${provider}`,
        repeat: { every: everySeconds * 1000 },
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 10 },
      },
    );
  }

  async deliveryDepth(): Promise<number> {
    const counts = await this.delivery.getJobCounts('waiting', 'delayed');
    return (counts['waiting'] ?? 0) + (counts['delayed'] ?? 0);
  }

  async dlqSize(): Promise<number> {
    const counts = await this.delivery.getJobCounts('failed');
    return counts['failed'] ?? 0;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([
      this.delivery.close().catch(() => undefined),
      this.digest.close().catch(() => undefined),
      this.integrationPoll.close().catch(() => undefined),
    ]);
    this.logger.debug('notification queues closed');
  }
}
