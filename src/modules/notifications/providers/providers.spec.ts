import { describe, expect, it } from 'vitest';
import { ProviderRegistry } from './provider.registry';
import { WebhookProvider } from './webhook.provider';
import { EmailProvider } from './email.provider';
import { PushProvider } from './push.provider';
import type { NotificationsConfigService } from '../config/notifications-config.service';
import {
  NotificationProvider,
  type NotificationChannel,
  type ProviderSendResult,
  type RenderedMessage,
} from '../notifications.public';

const message: RenderedMessage = {
  subject: null,
  body: 'hello',
  locale: 'pt',
  category: 'system',
  priority: 'normal',
};

class StubProvider extends NotificationProvider {
  constructor(readonly channel: NotificationChannel) {
    super();
  }
  send(): Promise<ProviderSendResult> {
    return Promise.resolve({ ok: true, retryable: false });
  }
  healthCheck(): Promise<{ healthy: boolean }> {
    return Promise.resolve({ healthy: true });
  }
}

function config(over: Record<string, unknown>): NotificationsConfigService {
  return {
    global: () => ({
      email: { enabled: false, fromAddress: 'no-reply@x.dev' },
      push: { enabled: false },
      ...over,
    }),
  } as unknown as NotificationsConfigService;
}

describe('ProviderRegistry', () => {
  it('indexes providers by channel and resolves them', () => {
    const dm = new StubProvider('DISCORD_DM');
    const email = new StubProvider('EMAIL');
    const registry = new ProviderRegistry([dm, email]);
    expect(registry.resolve('DISCORD_DM')).toBe(dm);
    expect(registry.resolve('EMAIL')).toBe(email);
    expect(registry.resolve('PUSH')).toBeNull();
    expect([...registry.channels()].sort()).toEqual(['DISCORD_DM', 'EMAIL']);
  });

  it('keeps the first provider on a duplicate channel', () => {
    const a = new StubProvider('WEBHOOK');
    const b = new StubProvider('WEBHOOK');
    const registry = new ProviderRegistry([a, b]);
    expect(registry.resolve('WEBHOOK')).toBe(a);
  });
});

describe('WebhookProvider', () => {
  it('rejects when no webhookUrl is present (permanent)', async () => {
    const provider: NotificationProvider = new WebhookProvider();
    const result = await provider.send({}, message, null);
    expect(result.ok).toBe(false);
    expect(result.retryable).toBe(false);
  });
});

describe('EmailProvider', () => {
  it('is a permanent failure while disabled', async () => {
    const provider: NotificationProvider = new EmailProvider(config({}));
    const result = await provider.send({ email: 'a@b.c' }, message, null);
    expect(result.ok).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.error).toContain('disabled');
  });

  it('is permanent when enabled but no SMTP url is configured', async () => {
    const provider: NotificationProvider = new EmailProvider(
      config({ email: { enabled: true } }),
    );
    const result = await provider.send({ email: 'a@b.c' }, message, null);
    expect(result.retryable).toBe(false);
    expect(result.error).toContain('SMTP');
  });
});

describe('PushProvider', () => {
  it('is a permanent failure while disabled', async () => {
    const provider: NotificationProvider = new PushProvider(config({}));
    const result = await provider.send({ pushEndpoint: 'e' }, message, null);
    expect(result.ok).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.error).toContain('disabled');
  });
});
