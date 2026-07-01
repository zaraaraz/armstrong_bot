import { Injectable } from '@nestjs/common';
import { EventBus } from '../../../core/events/event-bus';
import type { EventName } from '../../../core/events/registry/event-map';
import { StorageEvents, type StorageEventName } from '../events/storage.events';

/** The payload of `bus.publish`'s second argument, narrowed for the cast bridge. */
type PublishPayload = Parameters<EventBus['publish']>[1];

/**
 * The union of payloads storage emits. The object-lifecycle events
 * (`stored` / `deleted` / `accessed`) carry the object identity plus a `deduped`
 * flag; `quota.exceeded` and `gc.completed` carry their own shapes. All timestamps
 * are ISO strings, matching the payload contracts in `events/storage.events.ts`.
 */
export type StorageEventPayload =
  | {
      readonly objectId: string;
      readonly key: string;
      readonly guildId: string | null;
      readonly namespace: string;
      readonly size: number;
      readonly contentHash: string;
      readonly ownerType: string;
      readonly ownerId: string;
      readonly deduped?: boolean;
      readonly occurredAt: string;
    }
  | {
      readonly guildId: string;
      readonly usedBytes: number;
      readonly quotaBytes: number;
      readonly occurredAt: string;
    }
  | {
      readonly deletedObjects: number;
      readonly freedBytes: number;
      readonly occurredAt: string;
    };

/**
 * Publishes storage lifecycle events on the core Event Bus with a system actor.
 *
 * The storage event names are not (yet) part of the statically-typed
 * {@link GhostEventMap}; like the plugin and replay subsystems, this bridges the
 * gap by casting the name to {@link EventName} and the payload to the bus's
 * publish-argument type — keeping strict typing at the call sites while the
 * central registry catches up. No `any` is used.
 */
@Injectable()
export class StorageEventEmitter {
  readonly events = StorageEvents;

  constructor(private readonly bus: EventBus) {}

  /**
   * Publish a storage event under a system actor. The caller supplies the fully
   * built payload; a stable idempotency key is derived so a retry re-publishes
   * the same logical event rather than a duplicate.
   */
  async emit(
    name: StorageEventName,
    payload: StorageEventPayload,
  ): Promise<void> {
    await this.bus.publish(name as EventName, payload as PublishPayload, {
      guildId: this.guildIdOf(payload),
      actor: { type: 'system', id: 'storage' },
      idempotencyKey: this.idempotencyKey(name, payload),
    });
  }

  /** The guild an event is scoped to, or null for platform-wide events (GC). */
  private guildIdOf(payload: StorageEventPayload): string | null {
    return 'guildId' in payload ? payload.guildId : null;
  }

  /** A deterministic key so bus retries de-duplicate identical publishes. */
  private idempotencyKey(
    name: StorageEventName,
    payload: StorageEventPayload,
  ): string {
    if ('objectId' in payload) {
      return `${name}:${payload.objectId}:${payload.occurredAt}`;
    }
    if ('guildId' in payload) {
      return `${name}:${payload.guildId}:${payload.occurredAt}`;
    }
    return `${name}:${payload.occurredAt}`;
  }
}
