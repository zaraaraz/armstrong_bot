import type { EventName } from '../registry/event-map';

/** Reflect metadata key under which @OnEvent stores its config. */
export const ON_EVENT_METADATA = 'ghost:on-event';

/** Options accepted by the @OnEvent decorator. */
export interface OnEventOptions {
  /** Stable handler id; defaults to `<ClassName>:<methodName>` when omitted. */
  readonly handlerId?: string;
  /** Only receive events for this guild. Omit for all guilds. */
  readonly guildId?: string;
  /** Force this subscriber onto the durable (async) transport. */
  readonly durable?: boolean;
}

/** Shape stored in metadata and consumed by the bootstrap scanner. */
export interface OnEventMetadata {
  readonly name: EventName;
  readonly options?: OnEventOptions;
}

/**
 * Declarative subscription. Applied to a method of an Application Service.
 * The bootstrap {@link OnEventScanner} discovers these and registers them
 * with the EventBus, so modules never call `subscribe()` imperatively.
 *
 * @example
 *   @OnEvent('moderation.ban.executed', { handlerId: 'tickets:onBan' })
 *   async onBan(envelope: EventEnvelope<'moderation.ban.executed'>) { ... }
 */
export function OnEvent<K extends EventName>(
  name: K,
  options?: OnEventOptions,
): MethodDecorator {
  return Reflect.metadata(ON_EVENT_METADATA, {
    name,
    options,
  } satisfies OnEventMetadata);
}
