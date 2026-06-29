import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  EventLogRepository,
  type EventLogFilter,
  type EventLogRecord,
} from './event-log.repository';
import type { EventEnvelope } from '../envelope/event-envelope';
import type { EventName } from '../registry/event-map';
import type { DeliveryPolicy } from '../registry/event-policy';

@Injectable()
export class PrismaEventLogRepository extends EventLogRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async persist<K extends EventName>(
    envelope: EventEnvelope<K>,
    delivery: DeliveryPolicy,
  ): Promise<EventLogRecord> {
    const row = await this.prisma.eventLog.create({
      data: {
        envelopeId: envelope.id,
        eventName: envelope.name,
        guildId: envelope.guildId,
        actorType: envelope.actor.type,
        actorId: envelope.actor.id,
        payload: envelope.payload as Prisma.InputJsonValue,
        correlationId: envelope.correlationId,
        causationId: envelope.causationId,
        version: envelope.version,
        delivery,
        status: 'published',
        occurredAt: new Date(envelope.occurredAt),
      },
    });
    return this.map(row);
  }

  async updateStatus(
    envelopeId: string,
    status: 'dispatched' | 'failed',
  ): Promise<void> {
    await this.prisma.eventLog.update({
      where: { envelopeId },
      data: { status },
    });
  }

  async findByEnvelopeId(envelopeId: string): Promise<EventLogRecord | null> {
    const row = await this.prisma.eventLog.findUnique({
      where: { envelopeId },
    });
    return row ? this.map(row) : null;
  }

  async list(
    filter: EventLogFilter,
  ): Promise<{ items: EventLogRecord[]; total: number }> {
    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 25;
    const where = this.buildWhere(filter);

    const [total, rows] = await Promise.all([
      this.prisma.eventLog.count({ where }),
      this.prisma.eventLog.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { occurredAt: 'desc' },
      }),
    ]);

    return { total, items: rows.map((r) => this.map(r)) };
  }

  private buildWhere(f: EventLogFilter) {
    return {
      deletedAt: null,
      ...(f.eventName && { eventName: f.eventName }),
      ...(f.guildId && { guildId: f.guildId }),
      ...(f.correlationId && { correlationId: f.correlationId }),
      ...(f.status && { status: f.status }),
      ...((f.from ?? f.to) && {
        occurredAt: {
          ...(f.from && { gte: f.from }),
          ...(f.to && { lte: f.to }),
        },
      }),
    };
  }

  private map(row: {
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
    delivery: string;
    status: string;
    occurredAt: Date;
    createdAt: Date;
  }): EventLogRecord {
    return {
      id: row.id,
      envelopeId: row.envelopeId,
      eventName: row.eventName,
      guildId: row.guildId,
      actorType: row.actorType,
      actorId: row.actorId,
      payload: row.payload,
      correlationId: row.correlationId,
      causationId: row.causationId,
      version: row.version,
      delivery: row.delivery as DeliveryPolicy,
      status: row.status as EventLogRecord['status'],
      occurredAt: row.occurredAt,
      createdAt: row.createdAt,
    };
  }
}
