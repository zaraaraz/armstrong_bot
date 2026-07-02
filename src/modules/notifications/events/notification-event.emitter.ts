import { Injectable } from '@nestjs/common';
import { EventBus } from '../../../core/events/event-bus';
import type { GhostEventMap } from '../../../core/events/registry/event-map';
import type { NotificationEventName } from './notification.events';

/** Publishes the notification module's own lifecycle events on the core bus. */
@Injectable()
export class NotificationEventEmitter {
  constructor(private readonly eventBus: EventBus) {}

  async emit<K extends NotificationEventName>(
    name: K,
    payload: GhostEventMap[K],
    guildId: string | null,
  ): Promise<void> {
    await this.eventBus.publish(name, payload, {
      guildId,
      actor: { type: 'system', id: 'notifications' },
    });
  }
}
