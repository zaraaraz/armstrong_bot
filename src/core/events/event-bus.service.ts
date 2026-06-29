import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  EventBus,
  type PublishOptions,
  type EventHandler,
  type Subscription,
  type SubscribeOptions,
} from './event-bus';
import type { EventEnvelope } from './envelope/event-envelope';
import type { EventName, GhostEventMap } from './registry/event-map';
import { getEventPolicy } from './registry/event-policy';
import { CorrelationContext } from './envelope/correlation.context';
import { SyncDispatcher } from './dispatchers/sync.dispatcher';
import { AsyncDispatcher } from './dispatchers/async.dispatcher';
import { IdempotencyGuard } from './idempotency/idempotency.guard';
import { EventLogRepository } from './repositories/event-log.repository';

@Injectable()
export class EventBusService extends EventBus {
  private readonly logger = new Logger(EventBusService.name);

  constructor(
    private readonly sync: SyncDispatcher,
    private readonly async: AsyncDispatcher,
    private readonly idempotency: IdempotencyGuard,
    private readonly eventLog: EventLogRepository,
  ) {
    super();
  }

  async publish<K extends EventName>(
    name: K,
    payload: GhostEventMap[K],
    options: PublishOptions = {},
  ): Promise<EventEnvelope<K>> {
    const ctx = CorrelationContext.get();
    const correlationId = options.correlationId ?? ctx.correlationId;
    const causationId = options.causationId ?? ctx.causationId;

    const envelope: EventEnvelope<K> = {
      id: randomUUID(),
      name,
      payload,
      guildId: options.guildId ?? null,
      actor: options.actor ?? { type: 'system', id: 'core' },
      occurredAt: new Date().toISOString(),
      correlationId,
      causationId: causationId ?? null,
      version: options.version ?? 1,
      idempotencyKey: options.idempotencyKey,
      meta: options.meta,
    };

    const policy = getEventPolicy(name);
    const delivery = options.deliveryOverride ?? policy.delivery;

    this.logger.debug(
      `publish ${name} delivery=${delivery} envelopeId=${envelope.id}`,
    );

    if (policy.idempotent && envelope.idempotencyKey) {
      const dup = await this.idempotency.isDuplicate(envelope.idempotencyKey);
      if (dup) {
        this.logger.debug(
          `duplicate skipped for key=${envelope.idempotencyKey}`,
        );
        return envelope;
      }
      await this.idempotency.markSeen(envelope.idempotencyKey);
    }

    if (delivery === 'async' || delivery === 'both') {
      await this.eventLog.persist(envelope, delivery);
    }

    if (delivery === 'sync' || delivery === 'both') {
      await this.sync.dispatch(envelope);
    }

    if (delivery === 'async' || delivery === 'both') {
      await this.async.enqueue(envelope);
    }

    return envelope;
  }

  subscribe<K extends EventName>(
    name: K,
    handler: EventHandler<K>,
    options: SubscribeOptions,
  ): Subscription {
    if (options.durable) {
      return this.async.subscribe(name, handler, options);
    }
    const syncSub = this.sync.subscribe(name, handler, options);
    const asyncSub = this.async.subscribe(name, handler, options);
    return {
      handlerId: options.handlerId,
      unsubscribe: () => {
        syncSub.unsubscribe();
        asyncSub.unsubscribe();
      },
    };
  }

  async publishBatch(
    events: ReadonlyArray<{
      readonly name: EventName;
      readonly payload: GhostEventMap[EventName];
      readonly options?: PublishOptions;
    }>,
  ): Promise<ReadonlyArray<EventEnvelope>> {
    const correlationId = randomUUID();
    const results: EventEnvelope[] = [];
    for (const ev of events) {
      const envelope = await this.publish(ev.name, ev.payload, {
        ...ev.options,
        correlationId,
      });
      results.push(envelope);
    }
    return results;
  }
}
