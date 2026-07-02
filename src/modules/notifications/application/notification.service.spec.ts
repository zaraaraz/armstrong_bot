import { beforeEach, describe, expect, it } from 'vitest';
import { NotificationService } from './notification.service';
import type { NotificationRepository } from '../infrastructure/notification.repository';
import type {
  PreferenceResolver,
  ChannelDecision,
  ResolveChannelsInput,
} from '../domain/preference-resolver.service';
import type { DedupeService } from '../domain/dedupe.service';
import type { NotificationsConfigService } from '../config/notifications-config.service';
import type { NotificationQueues, DeliveryJobData } from '../jobs/queues';
import type { NotificationEventEmitter } from '../events/notification-event.emitter';
import type { CacheService } from '../../../cache/cache.service';
import type { NotificationsMetrics } from '../observability/notifications.metrics';
import type { NotificationsTracing } from '../observability/notifications.tracing';
import type {
  CreateNotificationInput,
  NotificationRecord,
} from '../domain/notification.model';

class FakeRepo {
  created: CreateNotificationInput[] = [];
  cancelled: string[] = [];
  byDedupe: NotificationRecord | null = null;

  create(input: CreateNotificationInput): Promise<NotificationRecord> {
    this.created.push(input);
    return Promise.resolve({
      id: 'n1',
      guildId: input.guildId,
      category: input.category,
      priority: input.priority,
      templateKey: input.templateKey,
      vars: input.vars,
      dedupeKey: input.dedupeKey,
      createdAt: new Date('2026-07-02T00:00:00Z'),
      deliveries: input.deliveries.map((d, i) => ({
        id: `d${i}`,
        notificationId: 'n1',
        channel: d.channel,
        status: 'PENDING' as const,
        recipientUserId: d.recipientUserId,
        recipientRef: d.recipientRef,
        providerMessageId: null,
        attempts: 0,
        lastError: null,
        scheduledFor: d.scheduledFor,
        deliveredAt: null,
        createdAt: new Date('2026-07-02T00:00:00Z'),
        updatedAt: new Date('2026-07-02T00:00:00Z'),
      })),
    });
  }
  findByDedupeKey(): Promise<NotificationRecord | null> {
    return Promise.resolve(this.byDedupe);
  }
  cancelPending(id: string): Promise<string[]> {
    this.cancelled.push(id);
    return Promise.resolve(['d0']);
  }
}

class FakeResolver {
  decisions: ChannelDecision[] = [
    { channel: 'DISCORD_CHANNEL', allowed: true, reason: null },
  ];
  resolve(_input: ResolveChannelsInput): Promise<ChannelDecision[]> {
    return Promise.resolve(this.decisions);
  }
}

class FakeDedupe {
  claims: string[] = [];
  released: string[] = [];
  shouldClaim = true;
  claim(_g: string | null, key: string): Promise<boolean> {
    this.claims.push(key);
    return Promise.resolve(this.shouldClaim);
  }
  release(_g: string | null, key: string): Promise<void> {
    this.released.push(key);
    return Promise.resolve();
  }
}

class FakeQueues {
  enqueued: DeliveryJobData[] = [];
  removed: string[] = [];
  enqueueDelivery(data: DeliveryJobData): Promise<void> {
    this.enqueued.push(data);
    return Promise.resolve();
  }
  removeDelivery(id: string): Promise<void> {
    this.removed.push(id);
    return Promise.resolve();
  }
}

class FakeEmitter {
  emitted: string[] = [];
  emit(name: string): Promise<void> {
    this.emitted.push(name);
    return Promise.resolve();
  }
}

const config = {
  global: () => ({
    dedupeTtlSeconds: 3600,
    maxDeliveryAttempts: 5,
    backoffBaseMs: 2000,
  }),
} as unknown as NotificationsConfigService;

const tracing = {
  withSpan: <T>(_n: string, _a: unknown, fn: () => Promise<T>) => fn(),
} as unknown as NotificationsTracing;

const metrics = {
  recordDispatch: () => undefined,
  setQueueDepth: () => undefined,
} as unknown as NotificationsMetrics;

const cache = {
  keys: {
    forGuild: (...p: string[]) => p.join(':'),
    forGlobal: (...p: string[]) => p.join(':'),
  },
} as unknown as CacheService;

function make(): {
  service: NotificationService;
  repo: FakeRepo;
  resolver: FakeResolver;
  dedupe: FakeDedupe;
  queues: FakeQueues;
  emitter: FakeEmitter;
} {
  const repo = new FakeRepo();
  const resolver = new FakeResolver();
  const dedupe = new FakeDedupe();
  const queues = new FakeQueues();
  const emitter = new FakeEmitter();
  const service = new NotificationService(
    repo as unknown as NotificationRepository,
    resolver as unknown as PreferenceResolver,
    dedupe as unknown as DedupeService,
    config,
    queues as unknown as NotificationQueues,
    emitter as unknown as NotificationEventEmitter,
    cache,
    metrics,
    tracing,
  );
  return { service, repo, resolver, dedupe, queues, emitter };
}

describe('NotificationService.dispatch', () => {
  let ctx: ReturnType<typeof make>;

  beforeEach(() => {
    ctx = make();
  });

  it('persists one delivery per resolved channel and enqueues a job each', async () => {
    ctx.resolver.decisions = [
      { channel: 'DISCORD_CHANNEL', allowed: true, reason: null },
      { channel: 'EMAIL', allowed: true, reason: null },
    ];
    const result = await ctx.service.dispatch({
      guildId: 'g1',
      category: 'system',
      templateKey: 'system.test',
      vars: {},
      recipients: [{ channelId: 'c1', email: 'a@b.c' }],
    });
    expect(result.enqueuedDeliveries).toBe(2);
    expect(ctx.repo.created[0].deliveries).toHaveLength(2);
    expect(ctx.queues.enqueued).toHaveLength(2);
    expect(ctx.emitter.emitted).toContain('notification.created');
  });

  it('short-circuits when the dedupe key is already claimed', async () => {
    ctx.dedupe.shouldClaim = false;
    ctx.repo.byDedupe = {
      id: 'prior',
    } as unknown as NotificationRecord;
    const result = await ctx.service.dispatch({
      guildId: 'g1',
      category: 'system',
      templateKey: 'system.test',
      vars: {},
      recipients: [{ channelId: 'c1' }],
      dedupeKey: 'evt-1',
    });
    expect(result.notificationId).toBe('prior');
    expect(result.enqueuedDeliveries).toBe(0);
    expect(ctx.repo.created).toHaveLength(0);
    expect(ctx.queues.enqueued).toHaveLength(0);
  });

  it('records skipped channels with a reason and does not enqueue them', async () => {
    ctx.resolver.decisions = [
      { channel: 'DISCORD_CHANNEL', allowed: true, reason: null },
      { channel: 'EMAIL', allowed: false, reason: 'quiet-hours' },
    ];
    const result = await ctx.service.dispatch({
      guildId: 'g1',
      category: 'system',
      templateKey: 'system.test',
      vars: {},
      recipients: [{ channelId: 'c1', email: 'a@b.c' }],
    });
    expect(result.enqueuedDeliveries).toBe(1);
    expect(result.skipped).toContainEqual({
      channel: 'EMAIL',
      reason: 'quiet-hours',
    });
  });

  it('skips a channel whose required address is missing', async () => {
    ctx.resolver.decisions = [
      { channel: 'EMAIL', allowed: true, reason: null },
    ];
    const result = await ctx.service.dispatch({
      guildId: 'g1',
      category: 'system',
      templateKey: 'system.test',
      vars: {},
      recipients: [{ userId: 'u1' }], // no email
    });
    expect(result.enqueuedDeliveries).toBe(0);
    expect(result.skipped[0].reason).toContain('missing address');
    // dedupe not used here, but a plan with zero deliveries must not persist.
    expect(ctx.repo.created).toHaveLength(0);
  });

  it('releases the dedupe claim when nothing gets enqueued', async () => {
    ctx.resolver.decisions = [
      { channel: 'EMAIL', allowed: false, reason: 'user-disabled' },
    ];
    await ctx.service.dispatch({
      guildId: 'g1',
      category: 'system',
      templateKey: 'system.test',
      vars: {},
      recipients: [{ email: 'a@b.c' }],
      dedupeKey: 'evt-2',
    });
    expect(ctx.dedupe.released).toContain('evt-2');
  });

  it('cancelPending cancels rows and pulls their queued jobs', async () => {
    await ctx.service.cancelPending('n1');
    expect(ctx.repo.cancelled).toContain('n1');
    expect(ctx.queues.removed).toContain('d0');
  });
});
