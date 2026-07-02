import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '../../../cache/cache.service';
import { CacheNamespace } from '../../../cache/keys/cache-namespace.enum';
import { NotificationsConfigService } from '../config/notifications-config.service';
import { DedupeService } from '../domain/dedupe.service';
import {
  PreferenceResolver,
  type ChannelDecision,
} from '../domain/preference-resolver.service';
import { channelRequiresAddress } from '../domain/value-objects/notification-channel.vo';
import type { CreateDeliveryInput } from '../domain/notification.model';
import { NotificationRepository } from '../infrastructure/notification.repository';
import { NotificationQueues } from '../jobs/queues';
import { NotificationEventEmitter } from '../events/notification-event.emitter';
import { NotificationEvents } from '../events/notification.events';
import { NotificationsMetrics } from '../observability/notifications.metrics';
import { NotificationsTracing } from '../observability/notifications.tracing';
import {
  INotificationService,
  type DispatchNotificationInput,
  type DispatchResult,
  type NotificationChannel,
  type NotificationRecipient,
} from '../notifications.public';

interface PlannedDelivery extends CreateDeliveryInput {
  readonly recipient: NotificationRecipient;
}

/**
 * Application service: the sole entry point for outbound notifications. It does
 * NOT transport — it resolves channels from preferences, persists the
 * notification with one delivery row per resolved (recipient × channel), emits
 * `notification.created`, and enqueues one BullMQ delivery job per row. The
 * DeliveryProcessor performs the actual send. Idempotent via `dedupeKey`.
 */
@Injectable()
export class NotificationService extends INotificationService {
  private readonly logger = new Logger('notifications.dispatch');

  constructor(
    private readonly repo: NotificationRepository,
    private readonly preferences: PreferenceResolver,
    private readonly dedupe: DedupeService,
    private readonly config: NotificationsConfigService,
    private readonly queues: NotificationQueues,
    private readonly emitter: NotificationEventEmitter,
    private readonly cache: CacheService,
    private readonly metrics: NotificationsMetrics,
    private readonly tracing: NotificationsTracing,
  ) {
    super();
  }

  async dispatch(input: DispatchNotificationInput): Promise<DispatchResult> {
    return this.tracing.withSpan(
      'notifications.dispatch',
      {
        category: input.category,
        guildId: input.guildId ?? 'global',
        templateKey: input.templateKey,
      },
      () => this.doDispatch(input),
    );
  }

  private async doDispatch(
    input: DispatchNotificationInput,
  ): Promise<DispatchResult> {
    const priority = input.priority ?? 'normal';
    const global = this.config.global();

    // 1. Idempotency: a claimed dedupeKey short-circuits (return the prior id).
    if (input.dedupeKey) {
      const claimed = await this.dedupe.claim(
        input.guildId,
        input.dedupeKey,
        global.dedupeTtlSeconds,
      );
      if (!claimed) {
        const prior = await this.repo.findByDedupeKey(
          input.guildId,
          input.dedupeKey,
        );
        this.logger.debug(
          `dedupe hit key=${input.dedupeKey} guild=${input.guildId ?? 'global'}`,
        );
        return {
          notificationId: prior?.id ?? 'deduped',
          enqueuedDeliveries: 0,
          skipped: [{ channel: 'DISCORD_CHANNEL', reason: 'deduped' }],
        };
      }
    }

    // 2. Resolve channels per recipient and build the delivery plan.
    const skipped: Array<{ channel: NotificationChannel; reason: string }> = [];
    const planned: PlannedDelivery[] = [];

    for (const recipient of input.recipients) {
      const decisions = await this.preferences.resolve({
        guildId: input.guildId,
        userId: recipient.userId,
        category: input.category,
        priority,
        forcedChannels: input.channels,
      });
      for (const decision of decisions) {
        const planItem = this.planFor(recipient, decision);
        if (planItem.kind === 'skip') {
          skipped.push({ channel: decision.channel, reason: planItem.reason });
          continue;
        }
        planned.push(planItem.delivery);
      }
    }

    if (planned.length === 0) {
      // Nothing to enqueue — release the dedupe claim so a later, better-formed
      // dispatch for the same logical event can still go through.
      if (input.dedupeKey) {
        await this.dedupe.release(input.guildId, input.dedupeKey);
      }
      return {
        notificationId: 'skipped',
        enqueuedDeliveries: 0,
        skipped,
      };
    }

    // 3. Persist the notification + its deliveries.
    const record = await this.repo.create({
      guildId: input.guildId,
      category: input.category,
      priority,
      templateKey: input.templateKey,
      vars: input.vars,
      dedupeKey: input.dedupeKey ?? null,
      deliveries: planned.map((p) => ({
        channel: p.channel,
        recipientUserId: p.recipientUserId,
        recipientRef: p.recipientRef,
        scheduledFor: p.scheduledFor,
      })),
    });

    // 4. Emit created (after persistence, before enqueue — per the spec).
    await this.emitter.emit(
      NotificationEvents.Created,
      {
        notificationId: record.id,
        guildId: record.guildId,
        category: record.category,
        channels: [...new Set(record.deliveries.map((d) => d.channel))],
      },
      record.guildId,
    );

    // 5. Enqueue one delivery job per row.
    for (const delivery of record.deliveries) {
      this.metrics.recordDispatch(delivery.channel, record.category);
      await this.queues.enqueueDelivery(
        { deliveryId: delivery.id, notificationId: record.id },
        {
          attempts: global.maxDeliveryAttempts,
          backoffMs: global.backoffBaseMs,
          delayMs: delivery.scheduledFor
            ? Math.max(0, delivery.scheduledFor.getTime() - Date.now())
            : 0,
        },
      );
    }

    return {
      notificationId: record.id,
      enqueuedDeliveries: record.deliveries.length,
      skipped,
    };
  }

  async cancelPending(notificationId: string): Promise<void> {
    const cancelledIds = await this.repo.cancelPending(notificationId);
    await Promise.all(cancelledIds.map((id) => this.queues.removeDelivery(id)));
    if (cancelledIds.length > 0) {
      this.logger.debug(
        `cancelled ${cancelledIds.length} pending deliveries for ${notificationId}`,
      );
    }
  }

  /**
   * Turns one (recipient, channel decision) into either a delivery plan item or
   * a skip reason. A disallowed decision or an address-less channel is skipped.
   */
  private planFor(
    recipient: NotificationRecipient,
    decision: ChannelDecision,
  ):
    | { kind: 'deliver'; delivery: PlannedDelivery }
    | { kind: 'skip'; reason: string } {
    if (!decision.allowed) {
      return { kind: 'skip', reason: decision.reason ?? 'not-allowed' };
    }
    const ref = this.recipientRef(recipient, decision.channel);
    if (channelRequiresAddress(decision.channel) && !ref) {
      return {
        kind: 'skip',
        reason: `missing address for ${decision.channel}`,
      };
    }
    if (
      (decision.channel === 'DISCORD_DM' && !recipient.userId) ||
      (decision.channel === 'DISCORD_CHANNEL' && !recipient.channelId)
    ) {
      return { kind: 'skip', reason: `missing target for ${decision.channel}` };
    }
    return {
      kind: 'deliver',
      delivery: {
        channel: decision.channel,
        recipientUserId: recipient.userId ?? null,
        recipientRef: ref,
        scheduledFor: null,
        recipient,
      },
    };
  }

  /** The transport address stored on the delivery row per channel. */
  private recipientRef(
    recipient: NotificationRecipient,
    channel: NotificationChannel,
  ): string | null {
    switch (channel) {
      case 'DISCORD_DM':
        return recipient.userId ?? null;
      case 'DISCORD_CHANNEL':
        return recipient.channelId ?? null;
      case 'EMAIL':
        return recipient.email ?? null;
      case 'PUSH':
        return recipient.pushEndpoint ?? null;
      case 'WEBHOOK':
        return recipient.webhookUrl ?? null;
      default:
        return null;
    }
  }

  /** Cache key for the live delivery-status projection (dashboard reads). */
  statusCacheKey(guildId: string | null, notificationId: string): string {
    return guildId
      ? this.cache.keys.forGuild(
          guildId,
          CacheNamespace.Generic,
          'notif:status',
          notificationId,
        )
      : this.cache.keys.forGlobal(
          CacheNamespace.Generic,
          'notif:status',
          notificationId,
        );
  }
}
