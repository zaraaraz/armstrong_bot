/**
 * Event payloads related to the Notifications module (Phase 4, item 17).
 *
 * The module EMITS `notification.*` lifecycle events (created / delivered /
 * failed) consumed by the dashboard for live status and by metrics/alerting.
 *
 * It also CONSUMES domain events from other modules (moderation, tickets) and
 * declares the `integration.*` events its own upstream notifiers publish
 * (Twitch/YouTube/GitHub); the routing table maps consumed events to
 * dispatches. Event names follow `module.entity.action`.
 */

type NotificationChannelName =
  'DISCORD_DM' | 'DISCORD_CHANNEL' | 'WEBHOOK' | 'EMAIL' | 'PUSH';

export interface NotificationCreatedPayload {
  readonly notificationId: string;
  readonly guildId: string | null;
  readonly category: string;
  readonly channels: ReadonlyArray<NotificationChannelName>;
}

export interface NotificationDeliveredPayload {
  readonly notificationId: string;
  readonly deliveryId: string;
  readonly channel: NotificationChannelName;
  readonly providerMessageId: string | null;
  readonly latencyMs: number;
  readonly guildId: string | null;
}

export interface NotificationFailedPayload {
  readonly notificationId: string;
  readonly deliveryId: string;
  readonly channel: NotificationChannelName;
  readonly attempts: number;
  readonly movedToDlq: boolean;
  readonly error: string;
  readonly guildId: string | null;
}

export interface IntegrationTwitchOnlinePayload {
  readonly guildId: string;
  readonly externalId: string; // twitch login
  readonly streamId: string;
  readonly title: string;
  readonly url: string;
  readonly occurredAt: string; // ISO
}

export interface IntegrationYoutubeUploadPayload {
  readonly guildId: string;
  readonly externalId: string; // channel id
  readonly videoId: string;
  readonly title: string;
  readonly url: string;
  readonly occurredAt: string; // ISO
}

export interface IntegrationGithubPushPayload {
  readonly guildId: string;
  readonly externalId: string; // repo full name
  readonly ref: string;
  readonly commitSha: string;
  readonly commitCount: number;
  readonly pusher: string;
  readonly url: string;
  readonly occurredAt: string; // ISO
}

export interface NotificationsEventPayloads {
  'notification.created': NotificationCreatedPayload;
  'notification.delivered': NotificationDeliveredPayload;
  'notification.failed': NotificationFailedPayload;
  'integration.twitch.online': IntegrationTwitchOnlinePayload;
  'integration.youtube.upload': IntegrationYoutubeUploadPayload;
  'integration.github.push': IntegrationGithubPushPayload;
}
