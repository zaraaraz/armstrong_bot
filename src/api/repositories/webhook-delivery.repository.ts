import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface WebhookDeliveryRecord {
  readonly id: string;
  readonly provider: string;
  readonly eventType: string;
  readonly guildId: string | null;
  readonly status: string;
  readonly attempts: number;
  readonly requestId: string;
  readonly receivedAt: Date;
  readonly processedAt: Date | null;
  readonly error: string | null;
}

export interface CreateWebhookDeliveryInput {
  readonly provider: string;
  readonly eventType: string;
  readonly guildId: string | null;
  readonly signature: string | null;
  readonly payload: unknown;
  readonly requestId: string;
}

/** Repository boundary for inbound webhook persistence (Prisma confined here). */
export abstract class WebhookDeliveryRepository {
  abstract create(
    input: CreateWebhookDeliveryInput,
  ): Promise<WebhookDeliveryRecord>;
  abstract markProcessed(id: string): Promise<void>;
  abstract markFailed(id: string, error: string): Promise<void>;
  abstract recentByGuild(
    guildId: string,
    limit: number,
  ): Promise<WebhookDeliveryRecord[]>;
}

function toRecord(row: {
  id: string;
  provider: string;
  eventType: string;
  guildId: string | null;
  status: string;
  attempts: number;
  requestId: string;
  receivedAt: Date;
  processedAt: Date | null;
  error: string | null;
}): WebhookDeliveryRecord {
  return {
    id: row.id,
    provider: row.provider,
    eventType: row.eventType,
    guildId: row.guildId,
    status: row.status,
    attempts: row.attempts,
    requestId: row.requestId,
    receivedAt: row.receivedAt,
    processedAt: row.processedAt,
    error: row.error,
  };
}

@Injectable()
export class PrismaWebhookDeliveryRepository extends WebhookDeliveryRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(
    input: CreateWebhookDeliveryInput,
  ): Promise<WebhookDeliveryRecord> {
    const row = await this.prisma.webhookDelivery.create({
      data: {
        provider: input.provider,
        eventType: input.eventType,
        guildId: input.guildId,
        signature: input.signature,
        payload: input.payload as object,
        requestId: input.requestId,
      },
    });
    return toRecord(row);
  }

  async markProcessed(id: string): Promise<void> {
    await this.prisma.webhookDelivery.update({
      where: { id },
      data: { status: 'processed', processedAt: new Date() },
    });
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.prisma.webhookDelivery.update({
      where: { id },
      data: { status: 'failed', error, attempts: { increment: 1 } },
    });
  }

  async recentByGuild(
    guildId: string,
    limit: number,
  ): Promise<WebhookDeliveryRecord[]> {
    const rows = await this.prisma.webhookDelivery.findMany({
      where: { guildId, deletedAt: null },
      orderBy: { receivedAt: 'desc' },
      take: limit,
    });
    return rows.map(toRecord);
  }
}
