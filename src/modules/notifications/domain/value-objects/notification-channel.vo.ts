import type { NotificationChannel } from '../../notifications.public';

/** All transport channels, in a stable order for iteration/defaults. */
export const ALL_CHANNELS: readonly NotificationChannel[] = [
  'DISCORD_DM',
  'DISCORD_CHANNEL',
  'WEBHOOK',
  'EMAIL',
  'PUSH',
] as const;

const CHANNEL_SET = new Set<string>(ALL_CHANNELS);

export function isNotificationChannel(
  value: string,
): value is NotificationChannel {
  return CHANNEL_SET.has(value);
}

/** Channels that need a per-recipient address rather than a channel id. */
export function channelRequiresAddress(channel: NotificationChannel): boolean {
  return channel === 'EMAIL' || channel === 'PUSH' || channel === 'WEBHOOK';
}
