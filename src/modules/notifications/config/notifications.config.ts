import { z } from 'zod';

/** Transport channels the module can deliver on. */
export const notificationChannelEnum = z.enum([
  'DISCORD_DM',
  'DISCORD_CHANNEL',
  'WEBHOOK',
  'EMAIL',
  'PUSH',
]);

/**
 * Global (process-wide) notification settings, sourced from ENV. Delivery
 * tuning (attempts/backoff/dedupe) and transport credentials are global-only;
 * per-guild behaviour (channels, quiet hours, digest) lives in the guild
 * schema below.
 */
export const notificationsGlobalConfigSchema = z.object({
  defaultLocale: z.string().min(2).default('pt'),
  maxDeliveryAttempts: z.number().int().min(1).max(10).default(5),
  backoffBaseMs: z.number().int().min(100).default(2000),
  dedupeTtlSeconds: z.number().int().min(0).default(3600),
  templateCacheTtlSeconds: z.number().int().min(0).max(3600).default(300),
  preferenceCacheTtlSeconds: z.number().int().min(0).max(3600).default(300),
  maxPageSize: z.number().int().min(1).max(500).default(100),
  email: z.object({
    enabled: z.boolean().default(false),
    fromAddress: z.string().email().default('no-reply@ghostbot.dev'),
    smtpUrl: z.string().url().optional(),
  }),
  push: z.object({
    enabled: z.boolean().default(false),
    vapidPublicKey: z.string().optional(),
    vapidPrivateKey: z.string().optional(),
  }),
  integrations: z.object({
    enabled: z.boolean().default(false),
    twitchPollSeconds: z.number().int().min(30).default(60),
    youtubePollSeconds: z.number().int().min(60).default(300),
    githubWebhookSecret: z.string().optional(),
  }),
});

export type NotificationsGlobalConfig = z.infer<
  typeof notificationsGlobalConfigSchema
>;

/** Per-guild overridable behaviour (GuildConfig.settings.notifications). */
export const notificationsGuildConfigSchema = z.object({
  enabledChannels: z
    .array(notificationChannelEnum)
    .default(['DISCORD_CHANNEL']),
  announceChannelId: z.string().nullable().default(null),
  staffChannelId: z.string().nullable().default(null),
  quietHours: z
    .object({
      enabled: z.boolean().default(false),
      startHour: z.number().int().min(0).max(23).default(23),
      endHour: z.number().int().min(0).max(23).default(7),
      timezone: z.string().default('Europe/Lisbon'),
    })
    .default({
      enabled: false,
      startHour: 23,
      endHour: 7,
      timezone: 'Europe/Lisbon',
    }),
  digest: z
    .object({
      enabled: z.boolean().default(false),
      cron: z.string().default('0 9 * * *'),
    })
    .default({ enabled: false, cron: '0 9 * * *' }),
});

export type NotificationsGuildConfig = z.infer<
  typeof notificationsGuildConfigSchema
>;

function num(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function bool(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  return value !== 'false' && value !== '0';
}

/** Builds the global config from ENV, applying schema defaults for gaps. */
export function resolveNotificationsGlobalConfig(
  env: Record<string, string | undefined>,
): NotificationsGlobalConfig {
  return notificationsGlobalConfigSchema.parse({
    defaultLocale: env['NOTIFICATIONS_DEFAULT_LOCALE'],
    maxDeliveryAttempts: num(env['NOTIFICATIONS_MAX_DELIVERY_ATTEMPTS']),
    backoffBaseMs: num(env['NOTIFICATIONS_BACKOFF_BASE_MS']),
    dedupeTtlSeconds: num(env['NOTIFICATIONS_DEDUPE_TTL_SECONDS']),
    templateCacheTtlSeconds: num(
      env['NOTIFICATIONS_TEMPLATE_CACHE_TTL_SECONDS'],
    ),
    preferenceCacheTtlSeconds: num(
      env['NOTIFICATIONS_PREFERENCE_CACHE_TTL_SECONDS'],
    ),
    maxPageSize: num(env['NOTIFICATIONS_MAX_PAGE_SIZE']),
    email: {
      enabled: bool(env['NOTIFICATIONS_EMAIL_ENABLED']),
      fromAddress: env['NOTIFICATIONS_EMAIL_FROM'],
      smtpUrl: env['NOTIFICATIONS_EMAIL_SMTP_URL'],
    },
    push: {
      enabled: bool(env['NOTIFICATIONS_PUSH_ENABLED']),
      vapidPublicKey: env['NOTIFICATIONS_PUSH_VAPID_PUBLIC_KEY'],
      vapidPrivateKey: env['NOTIFICATIONS_PUSH_VAPID_PRIVATE_KEY'],
    },
    integrations: {
      enabled: bool(env['NOTIFICATIONS_INTEGRATIONS_ENABLED']),
      twitchPollSeconds: num(env['NOTIFICATIONS_TWITCH_POLL_SECONDS']),
      youtubePollSeconds: num(env['NOTIFICATIONS_YOUTUBE_POLL_SECONDS']),
      githubWebhookSecret: env['NOTIFICATIONS_GITHUB_WEBHOOK_SECRET'],
    },
  });
}

/**
 * Guild resolution: schema defaults layered under the guild's own
 * `GuildConfig.settings.notifications` override blob.
 */
export function resolveNotificationsGuildConfig(
  override?: Partial<NotificationsGuildConfig>,
): NotificationsGuildConfig {
  return notificationsGuildConfigSchema.parse(override ?? {});
}
