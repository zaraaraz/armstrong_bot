import type { EventEnvelope } from '../envelope/event-envelope';
import type { EventName } from '../registry/event-map';

export interface DeadLetterRecord {
  id: string;
  envelopeId: string;
  eventName: string;
  guildId: string | null;
  handlerId: string;
  payload: unknown;
  attempts: number;
  lastError: string;
  errorCode: string;
  status: 'pending' | 'replayed' | 'discarded';
  createdAt: Date;
  replayedAt: Date | null;
}

export abstract class DeadLetterRepository {
  abstract create<K extends EventName>(
    envelope: EventEnvelope<K>,
    handlerId: string,
    attempts: number,
    error: Error,
  ): Promise<DeadLetterRecord>;

  abstract updateStatus(
    id: string,
    status: 'replayed' | 'discarded',
  ): Promise<DeadLetterRecord>;

  abstract findById(id: string): Promise<DeadLetterRecord | null>;

  abstract list(filter: {
    eventName?: string;
    handlerId?: string;
    status?: string;
    guildId?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{ items: DeadLetterRecord[]; total: number }>;
}
