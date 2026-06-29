export interface EventMeta {
  readonly eventId: string;
  readonly traceId: string;
  readonly occurredAt: string;
  readonly source: string;
}

export interface DomainEvent<TPayload = unknown> {
  readonly name: string;
  readonly guildId: string | null;
  readonly payload: TPayload;
  readonly meta: EventMeta;
}

export type EventHandler<TPayload> = (
  event: DomainEvent<TPayload>,
) => Promise<void> | void;

export interface Unsubscribe {
  (): void;
}

export abstract class EventBus {
  abstract emit<TPayload>(
    name: string,
    payload: TPayload,
    options: { guildId: string | null; source: string },
  ): Promise<void>;

  abstract on<TPayload>(
    name: string,
    handler: EventHandler<TPayload>,
  ): Unsubscribe;

  abstract once<TPayload>(
    name: string,
    handler: EventHandler<TPayload>,
  ): Unsubscribe;
}
