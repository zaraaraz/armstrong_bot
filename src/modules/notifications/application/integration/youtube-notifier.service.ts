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
 * YouTube new-upload notifier. Polls a channel's uploads feed; a newly-observed
 * videoId (differing from the stored cursor) fans out
 * `integration.youtube.upload` exactly once. {@link fetchLatest} is the feed
 * seam — dormant until the feed/API is wired.
 */
@Injectable()
export class YoutubeNotifierService extends IntegrationNotifierBase {
  constructor(
    subs: IntegrationSubscriptionRepository,
    bus: EventBus,
    private readonly config: NotificationsConfigService,
  ) {
    super('YOUTUBE', subs, bus);
  }

  protected fetchLatest(
    _sub: IntegrationSubscriptionRecord,
  ): Promise<UpstreamItem | null> {
    if (!this.config.global().integrations.enabled) {
      return Promise.resolve(null);
    }
    return Promise.resolve(null);
  }

  buildItem(
    sub: IntegrationSubscriptionRecord,
    video: { videoId: string; title: string },
  ): UpstreamItem {
    return {
      cursor: video.videoId,
      eventName: 'integration.youtube.upload',
      payload: {
        guildId: sub.guildId,
        externalId: sub.externalId,
        videoId: video.videoId,
        title: video.title,
        url: `https://youtu.be/${video.videoId}`,
        occurredAt: new Date().toISOString(),
      },
    };
  }
}
