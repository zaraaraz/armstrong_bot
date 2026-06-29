import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EventBus } from '../event-bus';
import { EventLogRepository } from '../repositories/event-log.repository';
import { DeadLetterRepository } from '../repositories/dead-letter.repository';
import type { EventName } from '../registry/event-map';

export interface ReplayFilter {
  eventName?: string;
  guildId?: string;
  correlationId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}

@Injectable()
export class EventReplayService {
  private readonly logger = new Logger(EventReplayService.name);
  private readonly MAX_BATCH = 500;

  constructor(
    private readonly bus: EventBus,
    private readonly eventLog: EventLogRepository,
    private readonly deadLetter: DeadLetterRepository,
  ) {}

  async replayByFilter(
    filter: ReplayFilter,
    requestedBy: string,
  ): Promise<{ replayId: string; count: number }> {
    const limit = Math.min(filter.limit ?? this.MAX_BATCH, this.MAX_BATCH);
    const { items } = await this.eventLog.list({
      eventName: filter.eventName,
      guildId: filter.guildId,
      correlationId: filter.correlationId,
      from: filter.from,
      to: filter.to,
      pageSize: limit,
    });

    const replayId = randomUUID();
    let count = 0;

    for (const record of items) {
      await this.bus.publish(
        record.eventName as EventName,
        record.payload as never,
        {
          guildId: record.guildId,
          actor: { type: 'system', id: requestedBy },
          correlationId: record.correlationId,
          causationId: record.envelopeId,
          deliveryOverride: record.delivery,
        },
      );
      count++;
    }

    await this.bus.publish(
      'events.replay.completed',
      { replayId, count, requestedBy },
      {
        actor: { type: 'system', id: 'event-replay' },
      },
    );

    this.logger.log(
      `Replay ${replayId} completed count=${count} by=${requestedBy}`,
    );
    return { replayId, count };
  }

  async replayDeadLetter(id: string, requestedBy: string): Promise<void> {
    const record = await this.deadLetter.findById(id);
    if (!record) throw new Error(`DeadLetter ${id} not found`);
    if (record.status !== 'pending')
      throw new Error(`DeadLetter ${id} is already ${record.status}`);

    await this.bus.publish(
      record.eventName as EventName,
      record.payload as never,
      {
        guildId: record.guildId,
        actor: { type: 'system', id: requestedBy },
        causationId: record.envelopeId,
      },
    );

    await this.deadLetter.updateStatus(id, 'replayed');
    this.logger.log(`Replayed dead-letter id=${id} by=${requestedBy}`);
  }

  async discardDeadLetter(id: string): Promise<void> {
    const record = await this.deadLetter.findById(id);
    if (!record) throw new Error(`DeadLetter ${id} not found`);
    await this.deadLetter.updateStatus(id, 'discarded');
    this.logger.log(`Discarded dead-letter id=${id}`);
  }
}
