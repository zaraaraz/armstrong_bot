import type { EventName, GhostEventMap } from './registry/event-map';
import type { EventEnvelope, EventActor } from './envelope/event-envelope';

export interface PublishOptions {
  readonly guildId?: string | null;
  readonly actor?: EventActor;
  readonly correlationId?: string;
  readonly causationId?: string | null;
  readonly idempotencyKey?: string;
  readonly version?: number;
  readonly meta?: Readonly<Record<string, string | number | boolean>>;
  readonly deliveryOverride?: 'sync' | 'async' | 'both';
}

export type EventHandler<K extends EventName> = (
  envelope: EventEnvelope<K>,
) => void | Promise<void>;

export interface Subscription {
  readonly handlerId: string;
  unsubscribe(): void;
}

export interface SubscribeOptions {
  readonly handlerId: string;
  readonly guildId?: string;
  readonly durable?: boolean;
}

export abstract class EventBus {
  abstract publish<K extends EventName>(
    name: K,
    payload: GhostEventMap[K],
    options?: PublishOptions,
  ): Promise<EventEnvelope<K>>;

  abstract subscribe<K extends EventName>(
    name: K,
    handler: EventHandler<K>,
    options: SubscribeOptions,
  ): Subscription;

  abstract publishBatch(
    events: ReadonlyArray<{
      readonly name: EventName;
      readonly payload: GhostEventMap[EventName];
      readonly options?: PublishOptions;
    }>,
  ): Promise<ReadonlyArray<EventEnvelope>>;
}
