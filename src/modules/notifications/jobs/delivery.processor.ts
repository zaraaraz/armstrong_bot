import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import {
  DELIVERY_JOB,
  NOTIFICATIONS_DELIVERY_QUEUE,
} from '../notifications.constants';
import { NotificationsConfigService } from '../config/notifications-config.service';
import { TemplateService } from '../domain/template.service';
import { NotificationRepository } from '../infrastructure/notification.repository';
import type {
  DeliveryRecord,
  NotificationRecord,
} from '../domain/notification.model';
import { ProviderRegistry } from '../providers/provider.registry';
import { NotificationQueues, type DeliveryJobData } from './queues';
import { NotificationEventEmitter } from '../events/notification-event.emitter';
import { NotificationEvents } from '../events/notification.events';
import { NotificationsMetrics } from '../observability/notifications.metrics';
import { NotificationsTracing } from '../observability/notifications.tracing';
import type {
  NotificationRecipient,
  ProviderSendResult,
} from '../notifications.public';

/**
 * BullMQ worker draining `notifications.delivery`. For each job it renders the
 * template in the recipient's locale, resolves the channel provider, sends, and
 * records the outcome:
 *  - `ok`               -> mark SENT, emit `notification.delivered`.
 *  - transient failure  -> bump attempts and THROW so BullMQ retries with backoff.
 *  - permanent failure  -> mark DEAD, emit `notification.failed(movedToDlq)`.
 *  - retries exhausted  -> the `failed` handler marks DEAD + DLQ.
 * A cancelled delivery (status flipped by cancelPending) is a no-op.
 */
@Injectable()
export class DeliveryProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('notifications.delivery.worker');
  private worker: Worker<DeliveryJobData> | null = null;

  constructor(
    private readonly queues: NotificationQueues,
    private readonly repo: NotificationRepository,
    private readonly templates: TemplateService,
    private readonly providers: ProviderRegistry,
    private readonly config: NotificationsConfigService,
    private readonly emitter: NotificationEventEmitter,
    private readonly metrics: NotificationsMetrics,
    private readonly tracing: NotificationsTracing,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<DeliveryJobData>(
      NOTIFICATIONS_DELIVERY_QUEUE,
      (job) => this.process(job),
      { connection: this.queues.connection, concurrency: 8 },
    );
    this.worker.on('error', (err) =>
      this.logger.warn(`worker error: ${err.message}`),
    );
    this.worker.on('failed', (job, err) => {
      if (!job) return;
      const attempts = job.opts.attempts ?? 1;
      if (job.attemptsMade >= attempts) {
        void this.onExhausted(job.data, err);
      }
    });
  }

  private async process(job: Job<DeliveryJobData>): Promise<void> {
    if (job.name !== DELIVERY_JOB) return;
    await this.tracing.withSpan(
      'notifications.deliver',
      {
        deliveryId: job.data.deliveryId,
        notificationId: job.data.notificationId,
      },
      () => this.deliver(job),
    );
  }

  private async deliver(job: Job<DeliveryJobData>): Promise<void> {
    const delivery = await this.repo.findDelivery(job.data.deliveryId);
    if (!delivery) {
      this.logger.warn(`delivery ${job.data.deliveryId} vanished; skipping`);
      return;
    }
    if (delivery.status === 'CANCELLED' || delivery.status === 'SENT') {
      return; // cancelled before pickup, or a redundant duplicate job
    }

    const notification = await this.repo.findById(delivery.notificationId);
    if (!notification) {
      this.logger.warn(
        `notification ${delivery.notificationId} vanished; dead-lettering delivery`,
      );
      await this.markDead(delivery, 'notification missing');
      return;
    }

    const provider = this.providers.resolve(delivery.channel);
    if (!provider) {
      await this.markDead(delivery, `no provider for ${delivery.channel}`);
      return;
    }

    const message = await this.render(notification);
    const recipient = this.recipientFromDelivery(delivery);
    const attemptNo = job.attemptsMade + 1;

    const started = Date.now();
    let result: ProviderSendResult;
    try {
      result = await provider.send(recipient, message, notification.guildId);
    } catch (err) {
      // A provider that throws is treated as transient by default.
      result = {
        ok: false,
        retryable: true,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    const latencyMs = Date.now() - started;
    this.metrics.observeLatency(delivery.channel, latencyMs);

    if (result.ok) {
      await this.repo.markResult(delivery.id, {
        status: 'SENT',
        providerMessageId: result.providerMessageId ?? null,
        error: null,
        deliveredAt: new Date(),
        attempts: attemptNo,
      });
      await this.emitter.emit(
        NotificationEvents.Delivered,
        {
          notificationId: notification.id,
          deliveryId: delivery.id,
          channel: delivery.channel,
          providerMessageId: result.providerMessageId ?? null,
          latencyMs,
          guildId: notification.guildId,
        },
        notification.guildId,
      );
      return;
    }

    this.metrics.recordFailure(
      delivery.channel,
      result.retryable ? 'transient' : 'permanent',
    );

    if (!result.retryable) {
      await this.markDead(
        delivery,
        result.error ?? 'permanent failure',
        attemptNo,
      );
      return;
    }

    // Transient: record the attempt, then throw so BullMQ applies backoff and
    // retries. The `failed` handler dead-letters once attempts are exhausted.
    await this.repo.markAttempt(delivery.id, attemptNo, result.error ?? null);
    await this.emitFailed(
      notification.guildId,
      notification.id,
      delivery,
      attemptNo,
      false,
      result.error ?? 'transient failure',
    );
    throw new Error(result.error ?? 'transient delivery failure');
  }

  private async render(notification: NotificationRecord) {
    // Locale: user preference resolution is out of the worker's reach here, so
    // fall back to the guild/global default locale for the rendered copy.
    const locale = this.config.global().defaultLocale;
    return this.templates.render({
      guildId: notification.guildId,
      templateKey: notification.templateKey,
      vars: notification.vars,
      locale,
      category: notification.category,
      priority: notification.priority,
    });
  }

  private recipientFromDelivery(
    delivery: DeliveryRecord,
  ): NotificationRecipient {
    const ref = delivery.recipientRef ?? undefined;
    switch (delivery.channel) {
      case 'DISCORD_DM':
        return { userId: delivery.recipientUserId ?? ref };
      case 'DISCORD_CHANNEL':
        return { channelId: ref };
      case 'EMAIL':
        return { userId: delivery.recipientUserId ?? undefined, email: ref };
      case 'PUSH':
        return {
          userId: delivery.recipientUserId ?? undefined,
          pushEndpoint: ref,
        };
      case 'WEBHOOK':
        return { webhookUrl: ref };
      default:
        return {};
    }
  }

  private async markDead(
    delivery: DeliveryRecord,
    error: string,
    attempts = delivery.attempts,
  ): Promise<void> {
    await this.repo.markResult(delivery.id, {
      status: 'DEAD',
      error,
      deliveredAt: null,
      attempts,
    });
    this.metrics.recordDlq(delivery.channel);
    const notification = await this.repo.findById(delivery.notificationId);
    await this.emitFailed(
      notification?.guildId ?? null,
      delivery.notificationId,
      delivery,
      attempts,
      true,
      error,
    );
  }

  /** Invoked once BullMQ has exhausted all retries for a transient failure. */
  private async onExhausted(data: DeliveryJobData, err: Error): Promise<void> {
    const delivery = await this.repo.findDelivery(data.deliveryId);
    if (
      !delivery ||
      delivery.status === 'SENT' ||
      delivery.status === 'CANCELLED'
    ) {
      return;
    }
    this.logger.error(
      `delivery ${data.deliveryId} dead-lettered: ${err.message}`,
    );
    await this.markDead(delivery, err.message, delivery.attempts);
  }

  private async emitFailed(
    guildId: string | null,
    notificationId: string,
    delivery: DeliveryRecord,
    attempts: number,
    movedToDlq: boolean,
    error: string,
  ): Promise<void> {
    await this.emitter
      .emit(
        NotificationEvents.Failed,
        {
          notificationId,
          deliveryId: delivery.id,
          channel: delivery.channel,
          attempts,
          movedToDlq,
          error,
          guildId,
        },
        guildId,
      )
      .catch(() => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
  }
}
