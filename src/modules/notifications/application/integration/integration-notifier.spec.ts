import { beforeEach, describe, expect, it } from 'vitest';
import {
  IntegrationNotifierBase,
  type UpstreamItem,
} from './integration-notifier.base';
import type { EventBus } from '../../../../core/events/event-bus';
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
  published: Array<{ name: string; opts: unknown }> = [];
  publish(name: string, _payload: unknown, opts: unknown): Promise<unknown> {
    this.published.push({ name, opts });
    return Promise.resolve({});
  }
}

/** Test notifier whose upstream item is fully controllable. */
class TestNotifier extends IntegrationNotifierBase {
  next: UpstreamItem | null = null;

  constructor(subs: FakeSubs, bus: FakeBus) {
    super(
      'TWITCH',
      subs as unknown as IntegrationSubscriptionRepository,
      bus as unknown as EventBus,
    );
  }

  protected fetchLatest(): Promise<UpstreamItem | null> {
    return Promise.resolve(this.next);
  }
}

const sub = (
  over: Partial<IntegrationSubscriptionRecord>,
): IntegrationSubscriptionRecord => ({
  id: 's1',
  guildId: 'g1',
  provider: 'TWITCH',
  externalId: 'streamer',
  announceChannelId: 'c1',
  cursor: null,
  active: true,
  ...over,
});

const item = (cursor: string): UpstreamItem => ({
  cursor,
  eventName: 'integration.twitch.online',
  payload: {
    guildId: 'g1',
    externalId: 'streamer',
    streamId: cursor,
    title: 't',
    url: 'u',
    occurredAt: '2026-07-02T00:00:00Z',
  },
});

describe('IntegrationNotifierBase.pollOne (exactly-once)', () => {
  let subs: FakeSubs;
  let bus: FakeBus;
  let notifier: TestNotifier;

  beforeEach(() => {
    subs = new FakeSubs();
    bus = new FakeBus();
    notifier = new TestNotifier(subs, bus);
  });

  it('fans out a new stream once and advances the cursor', async () => {
    notifier.next = item('stream-1');
    const fired = await notifier.pollOne(sub({ cursor: null }));
    expect(fired).toBe(true);
    expect(bus.published).toHaveLength(1);
    expect(subs.cursors['s1']).toBe('stream-1');
  });

  it('does not re-fire when the cursor is unchanged (re-poll)', async () => {
    notifier.next = item('stream-1');
    const fired = await notifier.pollOne(sub({ cursor: 'stream-1' }));
    expect(fired).toBe(false);
    expect(bus.published).toHaveLength(0);
  });

  it('fires again for a genuinely new stream id', async () => {
    notifier.next = item('stream-2');
    const fired = await notifier.pollOne(sub({ cursor: 'stream-1' }));
    expect(fired).toBe(true);
    expect(subs.cursors['s1']).toBe('stream-2');
  });

  it('passes the announce channel through on the event meta', async () => {
    notifier.next = item('stream-1');
    await notifier.pollOne(sub({ cursor: null, announceChannelId: 'c99' }));
    expect(bus.published[0].opts).toMatchObject({
      meta: { announceChannelId: 'c99' },
    });
  });

  it('is a no-op when nothing is upstream', async () => {
    notifier.next = null;
    expect(await notifier.pollOne(sub({}))).toBe(false);
  });
});
