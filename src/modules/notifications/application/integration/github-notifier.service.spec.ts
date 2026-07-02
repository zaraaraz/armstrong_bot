import { beforeEach, describe, expect, it } from 'vitest';
import { createHmac } from 'crypto';
import { GithubNotifierService } from './github-notifier.service';
import type { EventBus } from '../../../../core/events/event-bus';
import type { NotificationsConfigService } from '../../config/notifications-config.service';
import type {
  IntegrationSubscriptionRecord,
  IntegrationSubscriptionRepository,
} from '../../infrastructure/integration-subscription.repository';

class FakeSubs {
  rows: IntegrationSubscriptionRecord[] = [];
  cursors: Record<string, string> = {};
  listActiveByProvider(): Promise<IntegrationSubscriptionRecord[]> {
    return Promise.resolve(this.rows);
  }
  setCursor(id: string, cursor: string): Promise<void> {
    this.cursors[id] = cursor;
    return Promise.resolve();
  }
}

class FakeBus {
  published: Array<{ name: string; payload: unknown; opts: unknown }> = [];
  publish(name: string, payload: unknown, opts: unknown): Promise<unknown> {
    this.published.push({ name, payload, opts });
    return Promise.resolve({});
  }
}

const SECRET = 's3cr3t';

function config(secret: string | undefined): NotificationsConfigService {
  return {
    global: () => ({ integrations: { githubWebhookSecret: secret } }),
  } as unknown as NotificationsConfigService;
}

function sign(body: string, secret = SECRET): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

describe('GithubNotifierService.verifySignature', () => {
  const svc = new GithubNotifierService(
    new FakeSubs() as unknown as IntegrationSubscriptionRepository,
    new FakeBus() as unknown as EventBus,
    config(SECRET),
  );

  it('accepts a correctly-signed body', () => {
    const body = '{"a":1}';
    expect(svc.verifySignature(body, sign(body))).toBe(true);
  });

  it('rejects a tampered body', () => {
    const body = '{"a":1}';
    const sig = sign(body);
    expect(svc.verifySignature('{"a":2}', sig)).toBe(false);
  });

  it('rejects a missing / malformed signature header', () => {
    expect(svc.verifySignature('{}', undefined)).toBe(false);
    expect(svc.verifySignature('{}', 'md5=abc')).toBe(false);
  });

  it('fails closed when no secret is configured', () => {
    const noSecret = new GithubNotifierService(
      new FakeSubs() as unknown as IntegrationSubscriptionRepository,
      new FakeBus() as unknown as EventBus,
      config(undefined),
    );
    expect(noSecret.verifySignature('{}', sign('{}'))).toBe(false);
  });
});

describe('GithubNotifierService.ingest', () => {
  let subs: FakeSubs;
  let bus: FakeBus;
  let svc: GithubNotifierService;

  beforeEach(() => {
    subs = new FakeSubs();
    bus = new FakeBus();
    svc = new GithubNotifierService(
      subs as unknown as IntegrationSubscriptionRepository,
      bus as unknown as EventBus,
      config(SECRET),
    );
  });

  const push = {
    ref: 'refs/heads/main',
    after: 'abc123',
    commits: [{}, {}],
    repository: { full_name: 'org/repo', html_url: 'https://gh/org/repo' },
    pusher: { name: 'ana' },
  };

  it('fans out to each subscribed guild and advances the cursor', async () => {
    subs.rows = [
      {
        id: 's1',
        guildId: 'g1',
        provider: 'GITHUB',
        externalId: 'org/repo',
        announceChannelId: 'c1',
        cursor: null,
        active: true,
      },
    ];
    const result = await svc.ingest(push);
    expect(result.accepted).toBe(true);
    expect(bus.published).toHaveLength(1);
    expect(bus.published[0].name).toBe('integration.github.push');
    expect(subs.cursors['s1']).toBe('abc123');
  });

  it('ignores a push for an unsubscribed repository', async () => {
    subs.rows = [
      {
        id: 's1',
        guildId: 'g1',
        provider: 'GITHUB',
        externalId: 'other/repo',
        announceChannelId: null,
        cursor: null,
        active: true,
      },
    ];
    const result = await svc.ingest(push);
    expect(result.accepted).toBe(false);
    expect(bus.published).toHaveLength(0);
  });

  it('rejects a body missing repository or sha', async () => {
    const result = await svc.ingest({ after: 'x' });
    expect(result.accepted).toBe(false);
  });
});
