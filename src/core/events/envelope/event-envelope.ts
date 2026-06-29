import type { EventName, GhostEventMap } from '../registry/event-map';

export interface EventActor {
  readonly type: 'user' | 'system' | 'discord' | 'job' | 'api';
  readonly id: string;
  readonly username?: string;
}

export interface EventEnvelope<K extends EventName = EventName> {
  readonly id: string;
  readonly name: K;
  readonly payload: GhostEventMap[K];
  readonly guildId: string | null;
  readonly actor: EventActor;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly version: number;
  readonly idempotencyKey?: string;
  readonly meta?: Readonly<Record<string, string | number | boolean>>;
}
