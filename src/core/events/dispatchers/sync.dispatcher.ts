import { Injectable, Logger } from '@nestjs/common';
import type { EventEnvelope } from '../envelope/event-envelope';
import type { EventName } from '../registry/event-map';
import type {
  EventHandler,
  SubscribeOptions,
  Subscription,
} from '../event-bus';

interface Registration<K extends EventName> {
  handler: EventHandler<K>;
  options: SubscribeOptions;
}

@Injectable()
export class SyncDispatcher {
  private readonly logger = new Logger(SyncDispatcher.name);
  private readonly registry = new Map<string, Set<Registration<EventName>>>();

  subscribe<K extends EventName>(
    name: K,
    handler: EventHandler<K>,
    options: SubscribeOptions,
  ): Subscription {
    if (!this.registry.has(name)) this.registry.set(name, new Set());
    const reg: Registration<K> = { handler, options };
    this.registry.get(name)!.add(reg);

    return {
      handlerId: options.handlerId,
      unsubscribe: () => this.registry.get(name)?.delete(reg),
    };
  }

  async dispatch<K extends EventName>(
    envelope: EventEnvelope<K>,
  ): Promise<void> {
    const registrations = this.registry.get(envelope.name);
    if (!registrations || registrations.size === 0) return;

    for (const reg of registrations) {
      if (reg.options.guildId && reg.options.guildId !== envelope.guildId)
        continue;

      const start = Date.now();
      try {
        await (reg.handler as EventHandler<K>)(envelope);
        this.logger.debug(
          `sync handler ${reg.options.handlerId} for ${envelope.name} in ${Date.now() - start}ms`,
        );
      } catch (err) {
        this.logger.error(
          `sync handler ${reg.options.handlerId} failed for ${envelope.name}`,
          err,
        );
        throw err;
      }
    }
  }

  hasSubscribers(name: EventName): boolean {
    const set = this.registry.get(name);
    return !!set && set.size > 0;
  }
}
