import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EventBus, type DomainEvent, type EventHandler, type Unsubscribe } from './event-bus';

@Injectable()
export class InProcessEventBus extends EventBus {
  private readonly logger = new Logger(InProcessEventBus.name);
  private readonly handlers = new Map<string, Set<EventHandler<unknown>>>();

  async emit<TPayload>(
    name: string,
    payload: TPayload,
    options: { guildId: string | null; source: string },
  ): Promise<void> {
    const event: DomainEvent<TPayload> = {
      name,
      guildId: options.guildId,
      payload,
      meta: {
        eventId: randomUUID(),
        traceId: randomUUID(),
        occurredAt: new Date().toISOString(),
        source: options.source,
      },
    };

    const set = this.handlers.get(name);
    if (!set || set.size === 0) return;

    for (const handler of set) {
      try {
        await handler(event as DomainEvent<unknown>);
      } catch (err) {
        this.logger.error(`Handler error for event "${name}"`, err);
      }
    }
  }

  on<TPayload>(name: string, handler: EventHandler<TPayload>): Unsubscribe {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name)!.add(handler as EventHandler<unknown>);
    return () => this.handlers.get(name)?.delete(handler as EventHandler<unknown>);
  }

  once<TPayload>(name: string, handler: EventHandler<TPayload>): Unsubscribe {
    const wrapped: EventHandler<TPayload> = async (event) => {
      unsub();
      await handler(event);
    };
    const unsub = this.on(name, wrapped);
    return unsub;
  }
}
