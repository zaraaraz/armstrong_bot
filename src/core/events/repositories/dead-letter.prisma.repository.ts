import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  DeadLetterRepository,
  type DeadLetterRecord,
} from './dead-letter.repository';
import type { EventEnvelope } from '../envelope/event-envelope';
import type { EventName } from '../registry/event-map';

@Injectable()
export class PrismaDeadLetterRepository extends DeadLetterRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create<K extends EventName>(
    envelope: EventEnvelope<K>,
    handlerId: string,
    attempts: number,
    error: Error,
  ): Promise<DeadLetterRecord> {
    const errorCode =
      (error as NodeJS.ErrnoException).code ?? error.name ?? 'UNKNOWN';
    const row = await this.prisma.eventDeadLetter.create({
      data: {
        envelopeId: envelope.id,
        eventName: envelope.name,
        guildId: envelope.guildId,
        handlerId,
        payload: envelope.payload as Prisma.InputJsonValue,
        attempts,
        lastError: error.message,
        errorCode,
        status: 'pending',
      },
    });
    return this.map(row);
  }

  async updateStatus(
    id: string,
    status: 'replayed' | 'discarded',
  ): Promise<DeadLetterRecord> {
    const row = await this.prisma.eventDeadLetter.update({
      where: { id },
      data: {
        status,
        ...(status === 'replayed' && { replayedAt: new Date() }),
        ...(status === 'discarded' && { deletedAt: new Date() }),
      },
    });
    return this.map(row);
  }

  async findById(id: string): Promise<DeadLetterRecord | null> {
    const row = await this.prisma.eventDeadLetter.findUnique({ where: { id } });
    return row ? this.map(row) : null;
  }

  async list(filter: {
    eventName?: string;
    handlerId?: string;
    status?: string;
    guildId?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{ items: DeadLetterRecord[]; total: number }> {
    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 25;
    const where = {
      deletedAt: null,
      ...(filter.eventName && { eventName: filter.eventName }),
      ...(filter.handlerId && { handlerId: filter.handlerId }),
      ...(filter.status && { status: filter.status }),
      ...(filter.guildId && { guildId: filter.guildId }),
    };

    const [total, rows] = await Promise.all([
      this.prisma.eventDeadLetter.count({ where }),
      this.prisma.eventDeadLetter.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return { total, items: rows.map((r) => this.map(r)) };
  }

  private map(row: {
    id: string;
    envelopeId: string;
    eventName: string;
    guildId: string | null;
    handlerId: string;
    payload: unknown;
    attempts: number;
    lastError: string;
    errorCode: string;
    status: string;
    createdAt: Date;
    replayedAt: Date | null;
  }): DeadLetterRecord {
    return {
      id: row.id,
      envelopeId: row.envelopeId,
      eventName: row.eventName,
      guildId: row.guildId,
      handlerId: row.handlerId,
      payload: row.payload,
      attempts: row.attempts,
      lastError: row.lastError,
      errorCode: row.errorCode,
      status: row.status as DeadLetterRecord['status'],
      createdAt: row.createdAt,
      replayedAt: row.replayedAt,
    };
  }
}
