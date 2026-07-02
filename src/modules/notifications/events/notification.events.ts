/** Namespaced event names emitted by the Notifications module on the bus. */
export const NotificationEvents = {
  Created: 'notification.created',
  Delivered: 'notification.delivered',
  Failed: 'notification.failed',
} as const;

export type NotificationEventName =
  (typeof NotificationEvents)[keyof typeof NotificationEvents];

/**
 * Source events the module CONSUMES to fan out notifications. Some pre-exist in
 * other modules (moderation/tickets); the `integration.*` ones are declared in
 * `core/events/registry/payloads/notifications.payloads.ts` and emitted by this
 * module's own upstream notifiers.
 */
export const RoutedEvents = {
  ModerationBanExecuted: 'moderation.ban.executed',
  TicketOpened: 'tickets.ticket.opened',
  IntegrationTwitchOnline: 'integration.twitch.online',
  IntegrationYoutubeUpload: 'integration.youtube.upload',
  IntegrationGithubPush: 'integration.github.push',
} as const;

export type RoutedEventName = (typeof RoutedEvents)[keyof typeof RoutedEvents];
