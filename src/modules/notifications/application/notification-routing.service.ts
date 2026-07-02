import { Injectable, Logger } from '@nestjs/common';
import type { EventEnvelope } from '../../../core/events/envelope/event-envelope';
import { NotificationsConfigService } from '../config/notifications-config.service';
import { RoutedEvents } from '../events/notification.events';
import type {
  DispatchNotificationInput,
  NotificationCategory,
} from '../notifications.public';

/**
 * Maps a consumed domain event to a dispatch payload (or null to ignore it).
 * Each entry reads the typed envelope payload and the guild's configured
 * announce/staff channel — it never calls the emitting module. The set of
 * routed events is the config-driven routing table; the recipient/target
 * resolution is code because it depends on per-guild channel configuration.
 */
@Injectable()
export class NotificationRoutingService {
  private readonly logger = new Logger('notifications.routing');

  constructor(private readonly config: NotificationsConfigService) {}

  /** Event names this module subscribes to. */
  routedEventNames(): readonly string[] {
    return Object.values(RoutedEvents);
  }

  /** Builds the dispatch payload for a routed event, or null to skip it. */
  async route(
    envelope: EventEnvelope,
  ): Promise<DispatchNotificationInput | null> {
    switch (envelope.name) {
      case RoutedEvents.ModerationBanExecuted:
        return this.moderationBan(envelope);
      case RoutedEvents.TicketOpened:
        return this.ticketOpened(envelope);
      case RoutedEvents.IntegrationTwitchOnline:
        return await this.twitchOnline(envelope);
      case RoutedEvents.IntegrationYoutubeUpload:
        return await this.youtubeUpload(envelope);
      case RoutedEvents.IntegrationGithubPush:
        return await this.githubPush(envelope);
      default:
        return null;
    }
  }

  private async moderationBan(
    env: EventEnvelope,
  ): Promise<DispatchNotificationInput | null> {
    if (env.guildId === null) return null;
    const staffChannel = await this.staffChannel(env.guildId);
    if (!staffChannel) return null;
    const p = env.payload as {
      caseId: string;
      targetUserId: string;
      moderatorUserId: string;
      reason: string | null;
    };
    return {
      guildId: env.guildId,
      category: 'moderation',
      priority: 'high',
      templateKey: 'moderation.banned',
      vars: {
        caseId: p.caseId,
        target: p.targetUserId,
        moderator: p.moderatorUserId,
        reason: p.reason ?? 'n/a',
      },
      recipients: [{ channelId: staffChannel }],
      channels: ['DISCORD_CHANNEL'],
      dedupeKey: `moderation.banned:${p.caseId}`,
    };
  }

  private async ticketOpened(
    env: EventEnvelope,
  ): Promise<DispatchNotificationInput | null> {
    if (env.guildId === null) return null;
    const staffChannel = await this.staffChannel(env.guildId);
    if (!staffChannel) return null;
    const p = env.payload as {
      ticketId: string;
      userId: string;
      category: string | null;
    };
    return {
      guildId: env.guildId,
      category: 'tickets',
      priority: 'normal',
      templateKey: 'tickets.created',
      vars: {
        ticketId: p.ticketId,
        user: p.userId,
        ticketCategory: p.category ?? 'general',
      },
      recipients: [{ channelId: staffChannel }],
      channels: ['DISCORD_CHANNEL'],
      dedupeKey: `tickets.created:${p.ticketId}`,
    };
  }

  private async twitchOnline(
    env: EventEnvelope,
  ): Promise<DispatchNotificationInput | null> {
    const p = env.payload as {
      guildId: string;
      externalId: string;
      streamId: string;
      title: string;
      url: string;
    };
    return this.integration(
      p.guildId,
      'integrations.twitch.online',
      { streamer: p.externalId, title: p.title, url: p.url },
      `integration.twitch.online:${p.streamId}`,
      env,
    );
  }

  private async youtubeUpload(
    env: EventEnvelope,
  ): Promise<DispatchNotificationInput | null> {
    const p = env.payload as {
      guildId: string;
      externalId: string;
      videoId: string;
      title: string;
      url: string;
    };
    return this.integration(
      p.guildId,
      'integrations.youtube.upload',
      { channel: p.externalId, title: p.title, url: p.url },
      `integration.youtube.upload:${p.videoId}`,
      env,
    );
  }

  private async githubPush(
    env: EventEnvelope,
  ): Promise<DispatchNotificationInput | null> {
    const p = env.payload as {
      guildId: string;
      externalId: string;
      ref: string;
      commitSha: string;
      commitCount: number;
      pusher: string;
      url: string;
    };
    return this.integration(
      p.guildId,
      'integrations.github.push',
      {
        repo: p.externalId,
        ref: p.ref,
        count: p.commitCount,
        pusher: p.pusher,
        url: p.url,
      },
      `integration.github.push:${p.commitSha}`,
      env,
    );
  }

  /**
   * Integration events carry their own announce channel via the meta the
   * notifier attaches; fall back to the guild's default announce channel. A
   * subscription with no resolvable channel is skipped (returns null).
   */
  private async integration(
    guildId: string,
    templateKey: string,
    vars: Record<string, string | number>,
    dedupeKey: string,
    env: EventEnvelope,
  ): Promise<DispatchNotificationInput | null> {
    const metaChannel = env.meta?.['announceChannelId'];
    const cfg = await this.config.forGuild(guildId);
    const channelId =
      typeof metaChannel === 'string' ? metaChannel : cfg.announceChannelId;
    if (!channelId) {
      this.logger.debug(
        `no announce channel for ${templateKey} in guild ${guildId}; skipping`,
      );
      return null;
    }
    const category: NotificationCategory = 'integrations';
    return {
      guildId,
      category,
      priority: 'normal',
      templateKey,
      vars,
      recipients: [{ channelId }],
      channels: ['DISCORD_CHANNEL'],
      dedupeKey,
    };
  }

  private async staffChannel(guildId: string): Promise<string | null> {
    const cfg = await this.config.forGuild(guildId);
    return cfg.staffChannelId ?? cfg.announceChannelId;
  }
}
