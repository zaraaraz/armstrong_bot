import { Injectable } from '@nestjs/common';
import { EventBus } from '../../../core/events/event-bus';
import type { GhostEventMap } from '../../../core/events/registry/event-map';
import type { AuditEventName } from './audit.events';

/** Publishes the audit module's own lifecycle events on the core Event Bus. */
@Injectable()
export class AuditEventEmitter {
  constructor(private readonly eventBus: EventBus) {}

  async emit<K extends AuditEventName>(
    name: K,
    payload: GhostEventMap[K],
    guildId: string | null,
  ): Promise<void> {
    await this.eventBus.publish(name, payload, {
      guildId,
      actor: { type: 'system', id: 'audit' },
    });
  }
}
