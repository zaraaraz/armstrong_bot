import { describe, expect, it } from 'vitest';
import {
  resolveNotificationsGlobalConfig,
  resolveNotificationsGuildConfig,
} from './notifications.config';

describe('resolveNotificationsGlobalConfig', () => {
  it('applies defaults on an empty environment', () => {
    const cfg = resolveNotificationsGlobalConfig({});
    expect(cfg.defaultLocale).toBe('pt');
    expect(cfg.maxDeliveryAttempts).toBe(5);
    expect(cfg.dedupeTtlSeconds).toBe(3600);
    expect(cfg.email.enabled).toBe(false);
    expect(cfg.integrations.enabled).toBe(false);
  });

  it('reads overrides from ENV with type coercion', () => {
    const cfg = resolveNotificationsGlobalConfig({
      NOTIFICATIONS_MAX_DELIVERY_ATTEMPTS: '8',
      NOTIFICATIONS_EMAIL_ENABLED: 'true',
      NOTIFICATIONS_EMAIL_SMTP_URL: 'smtp://user:pass@host:587',
      NOTIFICATIONS_DEFAULT_LOCALE: 'en',
    });
    expect(cfg.maxDeliveryAttempts).toBe(8);
    expect(cfg.email.enabled).toBe(true);
    expect(cfg.email.smtpUrl).toBe('smtp://user:pass@host:587');
    expect(cfg.defaultLocale).toBe('en');
  });

  it('rejects an out-of-range attempt count', () => {
    expect(() =>
      resolveNotificationsGlobalConfig({
        NOTIFICATIONS_MAX_DELIVERY_ATTEMPTS: '99',
      }),
    ).toThrow();
  });
});

describe('resolveNotificationsGuildConfig', () => {
  it('applies defaults with no override', () => {
    const cfg = resolveNotificationsGuildConfig();
    expect(cfg.enabledChannels).toEqual(['DISCORD_CHANNEL']);
    expect(cfg.quietHours.enabled).toBe(false);
    expect(cfg.digest.cron).toBe('0 9 * * *');
  });

  it('merges an override blob', () => {
    const cfg = resolveNotificationsGuildConfig({
      enabledChannels: ['DISCORD_CHANNEL', 'EMAIL'],
      announceChannelId: '123',
      quietHours: {
        enabled: true,
        startHour: 22,
        endHour: 6,
        timezone: 'Europe/Lisbon',
      },
    });
    expect(cfg.enabledChannels).toContain('EMAIL');
    expect(cfg.announceChannelId).toBe('123');
    expect(cfg.quietHours.startHour).toBe(22);
  });
});
