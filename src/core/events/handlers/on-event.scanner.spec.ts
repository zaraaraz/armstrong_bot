import { Injectable } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  EventBus,
  type EventHandler,
  type SubscribeOptions,
} from '../event-bus';
import type { EventEnvelope } from '../envelope/event-envelope';
import type { EventName, GhostEventMap } from '../registry/event-map';
import { OnEvent } from './event-handler.decorator';
import { OnEventScanner } from './on-event.scanner';

interface Registration {
  readonly name: EventName;
  readonly handler: EventHandler<EventName>;
  readonly options: SubscribeOptions;
}

/** Minimal in-memory EventBus that records subscriptions for assertions. */
@Injectable()
class FakeEventBus extends EventBus {
  readonly registrations: Registration[] = [];

  publish<K extends EventName>(): Promise<EventEnvelope<K>> {
    throw new Error('not used in this test');
  }

  subscribe<K extends EventName>(
    name: K,
    handler: EventHandler<K>,
    options: SubscribeOptions,
  ) {
    this.registrations.push({ name, handler, options });
    return { handlerId: options.handlerId, unsubscribe: () => undefined };
  }

  publishBatch(): Promise<ReadonlyArray<EventEnvelope>> {
    throw new Error('not used in this test');
  }

  tap(handlerId: string) {
    return { handlerId, unsubscribe: () => undefined };
  }
}

@Injectable()
class SampleListener {
  readonly received: Array<EventEnvelope<EventName>> = [];

  @OnEvent('moderation.ban.executed', { handlerId: 'sample:onBan' })
  onBan(envelope: EventEnvelope<'moderation.ban.executed'>) {
    this.received.push(envelope);
  }

  @OnEvent('discord.member.joined', { durable: true })
  onJoin(envelope: EventEnvelope<'discord.member.joined'>) {
    this.received.push(envelope);
  }

  // Not decorated — must be ignored by the scanner.
  helper(): void {}
}

function makeEnvelope<K extends EventName>(
  name: K,
  payload: GhostEventMap[K],
): EventEnvelope<K> {
  return {
    id: 'env-1',
    name,
    payload,
    guildId: null,
    actor: { type: 'system', id: 'test' },
    occurredAt: '2026-06-30T00:00:00.000Z',
    correlationId: 'corr-1',
    causationId: null,
    version: 1,
  };
}

describe('OnEventScanner', () => {
  let bus: FakeEventBus;
  let listener: SampleListener;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DiscoveryModule],
      providers: [
        OnEventScanner,
        SampleListener,
        { provide: EventBus, useClass: FakeEventBus },
      ],
    }).compile();

    await moduleRef.init(); // triggers onApplicationBootstrap

    bus = moduleRef.get<FakeEventBus>(EventBus);
    listener = moduleRef.get(SampleListener);
  });

  it('registers every @OnEvent-decorated method', () => {
    expect(bus.registrations).toHaveLength(2);

    const names = bus.registrations.map((r) => r.name).sort();
    expect(names).toEqual(['discord.member.joined', 'moderation.ban.executed']);
  });

  it('honours an explicit handlerId and defaults to Class:method otherwise', () => {
    const ban = bus.registrations.find(
      (r) => r.name === 'moderation.ban.executed',
    );
    const join = bus.registrations.find(
      (r) => r.name === 'discord.member.joined',
    );

    expect(ban?.options.handlerId).toBe('sample:onBan');
    expect(join?.options.handlerId).toBe('SampleListener:onJoin');
    expect(join?.options.durable).toBe(true);
  });

  it('binds the handler to its instance so dispatch updates instance state', async () => {
    const ban = bus.registrations.find(
      (r) => r.name === 'moderation.ban.executed',
    )!;

    const envelope = makeEnvelope('moderation.ban.executed', {
      caseId: 'c1',
      targetUserId: 'u1',
      moderatorUserId: 'm1',
      reason: null,
      deleteMessageSeconds: 0,
      expiresAt: null,
    });

    await ban.handler(envelope);

    expect(listener.received).toContain(envelope);
  });

  it('ignores methods without the decorator', () => {
    expect(
      bus.registrations.some((r) => r.options.handlerId.endsWith('helper')),
    ).toBe(false);
  });
});
