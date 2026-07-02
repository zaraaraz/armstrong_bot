import { Logger } from '@nestjs/common';
import type { EventName } from '../../../../core/events/registry/event-map';
import type { GhostEventMap } from '../../../../core/events/registry/event-map';
import { EventBus } from '../../../../core/events/event-bus';
import {
  IntegrationSubscriptionRepository,
  type IntegrationProviderName,
  type IntegrationSubscriptionRecord,
} from '../../infrastructure/integration-subscription.repository';

/** One detected upstream item, provider-agnostic. */
export interface UpstreamItem {
  /** Stable id used as the cursor + the fan-out dedupe marker. */
  readonly cursor: string;
  readonly eventName: EventName;
  readonly payload: GhostEventMap[EventName];
}

/**
 * Shared exactly-once polling logic for the integration notifiers. Concrete
 * notifiers implement {@link fetchLatest}; the base compares the returned
 * cursor against the stored one, emits the `integration.*` event exactly once
 * (with the announce channel attached to `meta` so routing targets it), and
 * only then advances the cursor. A re-poll that returns the same cursor is a
 * no-op — satisfying the "fans out exactly once; re-poll no duplicate" gate.
 */
export abstract class IntegrationNotifierBase {
  protected readonly logger: Logger;

  protected constructor(
    protected readonly provider: IntegrationProviderName,
    protected readonly subs: IntegrationSubscriptionRepository,
    protected readonly bus: EventBus,
  ) {
    this.logger = new Logger(
      `notifications.integration.${provider.toLowerCase()}`,
    );
  }

  /** Polls every active subscription for this provider. */
  async poll(): Promise<void> {
    const subscriptions = await this.subs.listActiveByProvider(this.provider);
    for (const sub of subscriptions) {
      await this.pollOne(sub).catch((err: unknown) => {
        this.logger.warn(
          `poll failed for ${sub.externalId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
  }

  /** Polls one subscription and fans out at most one new upstream item. */
  async pollOne(sub: IntegrationSubscriptionRecord): Promise<boolean> {
    const item = await this.fetchLatest(sub);
    if (!item) return false;
    if (item.cursor === sub.cursor) return false; // already seen — no duplicate

    await this.bus.publish(item.eventName, item.payload, {
      guildId: sub.guildId,
      actor: {
        type: 'system',
        id: `notifications.${this.provider.toLowerCase()}`,
      },
      idempotencyKey: item.cursor,
      meta: sub.announceChannelId
        ? { announceChannelId: sub.announceChannelId }
        : undefined,
    });
    // Advance only after a successful publish so a failure re-fires next poll.
    await this.subs.setCursor(sub.id, item.cursor);
    this.logger.debug(
      `fanned out ${item.eventName} for ${sub.externalId} (cursor ${item.cursor})`,
    );
    return true;
  }

  /**
   * Fetch the latest upstream item for a subscription, or null when nothing is
   * available / no upstream API is configured. Concrete notifiers override this
   * with their provider's API call; the default keeps the notifier dormant
   * (returns null) until credentials + client are wired.
   */
  protected abstract fetchLatest(
    sub: IntegrationSubscriptionRecord,
  ): Promise<UpstreamItem | null>;
}
