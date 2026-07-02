import { Injectable } from '@nestjs/common';
import { EventBus } from '../../../../core/events/event-bus';
import { NotificationsConfigService } from '../../config/notifications-config.service';
import {
  IntegrationSubscriptionRepository,
  type IntegrationSubscriptionRecord,
} from '../../infrastructure/integration-subscription.repository';
import {
  IntegrationNotifierBase,
  type UpstreamItem,
} from './integration-notifier.base';

/**
 * Twitch stream-online notifier. Polls the Helix "streams" endpoint per
 * subscription; a newly-observed streamId (differing from the stored cursor)
 * fans out `integration.twitch.online` exactly once. The Helix call itself is
 * the {@link fetchLatest} seam — dormant (returns null) until Twitch API
 * credentials are configured, at which point wiring the fetch is additive.
 */
@Injectable()
export class TwitchNotifierService extends IntegrationNotifierBase {
  constructor(
    subs: IntegrationSubscriptionRepository,
    bus: EventBus,
    private readonly config: NotificationsConfigService,
  ) {
    super('TWITCH', subs, bus);
  }

  protected fetchLatest(
    _sub: IntegrationSubscriptionRecord,
  ): Promise<UpstreamItem | null> {
    if (!this.config.global().integrations.enabled) {
      return Promise.resolve(null);
    }
    // Helix poll goes here; returns null while no live stream is detected or no
    // credentials are configured.
    return Promise.resolve(null);
  }

  /** Test/extension hook: build the fan-out item from a detected stream. */
  buildItem(
    sub: IntegrationSubscriptionRecord,
    stream: { streamId: string; title: string },
  ): UpstreamItem {
    return {
      cursor: stream.streamId,
      eventName: 'integration.twitch.online',
      payload: {
        guildId: sub.guildId,
        externalId: sub.externalId,
        streamId: stream.streamId,
        title: stream.title,
        url: `https://twitch.tv/${sub.externalId}`,
        occurredAt: new Date().toISOString(),
      },
    };
  }
}
