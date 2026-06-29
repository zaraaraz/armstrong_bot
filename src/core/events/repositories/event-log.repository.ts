import type { EventEnvelope } from '../envelope/event-envelope';
import type { EventName } from '../registry/event-map';
import type { DeliveryPolicy } from '../registry/event-policy';

export interface EventLogRecord {
  id: string;
  envelopeId: string;
  eventName: string;
  guildId: string | null;
  actorType: string;
  actorId: string;
  payload: unknown;
  correlationId: string;
  causationId: string | null;
  version: number;
  delivery: DeliveryPolicy;
  status: 'published' | 'dispatched' | 'failed';
  occurredAt: Date;
  createdAt: Date;
}

export interface EventLogFilter {
  eventName?: string;
  guildId?: string;
  correlationId?: string;
  status?: 'published' | 'dispatched' | 'failed';
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

export abstract class EventLogRepository {
  abstract persist<K extends EventName>(
    envelope: EventEnvelope<K>,
    delivery: DeliveryPolicy,
  ): Promise<EventLogRecord>;

  abstract updateStatus(
    envelopeId: string,
    status: 'dispatched' | 'failed',
  ): Promise<void>;

  abstract findByEnvelopeId(envelopeId: string): Promise<EventLogRecord | null>;

  abstract list(
    filter: EventLogFilter,
  ): Promise<{ items: EventLogRecord[]; total: number }>;
}
