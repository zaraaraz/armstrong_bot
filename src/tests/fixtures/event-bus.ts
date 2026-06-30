import type {
  EventName,
  GhostEventMap,
} from '../../core/events/registry/event-map';
import type {
  EventEnvelope,
  EventActor,
} from '../../core/events/envelope/event-envelope';
import type {
  EventHandler,
  PublishOptions,
  Subscription,
  SubscribeOptions,
} from '../../core/events/event-bus';
import { EventBus } from '../../core/events/event-bus';

export interface RecordedEvent<T = unknown> {
  readonly name: string;
  readonly payload: T;
  readonly emittedAt: Date;
}

export interface FakeEventBus extends EventBus {
  recorded(name?: string): readonly RecordedEvent[];
  reset(): void;
}

const SYSTEM_ACTOR: EventActor = { type: 'system', id: 'test' };

export class FakeEventBusImpl extends EventBus implements FakeEventBus {
  private readonly _recorded: RecordedEvent[] = [];

  override publish<K extends EventName>(
    name: K,
    payload: GhostEventMap[K],
    _options?: PublishOptions,
  ): Promise<EventEnvelope<K>> {
    this._recorded.push({ name, payload, emittedAt: new Date() });
    return Promise.resolve({
      id: `fake-${this._recorded.length}`,
      name,
      payload,
      guildId: null,
      actor: SYSTEM_ACTOR,
      occurredAt: new Date().toISOString(),
      correlationId: `corr-${this._recorded.length}`,
      causationId: null,
      version: 1,
    });
  }

  override subscribe<K extends EventName>(
    _name: K,
    _handler: EventHandler<K>,
    options: SubscribeOptions,
  ): Subscription {
    return { handlerId: options.handlerId, unsubscribe: () => {} };
  }

  override async publishBatch(
    events: ReadonlyArray<{
      name: EventName;
      payload: GhostEventMap[EventName];
      options?: PublishOptions;
    }>,
  ): Promise<ReadonlyArray<EventEnvelope>> {
    return Promise.all(
      events.map((e) => this.publish(e.name, e.payload, e.options)),
    );
  }

  recorded(name?: string): readonly RecordedEvent[] {
    return name
      ? this._recorded.filter((r) => r.name === name)
      : [...this._recorded];
  }

  reset(): void {
    this._recorded.length = 0;
  }
}

export function makeFakeEventBus(): FakeEventBus {
  return new FakeEventBusImpl();
}
