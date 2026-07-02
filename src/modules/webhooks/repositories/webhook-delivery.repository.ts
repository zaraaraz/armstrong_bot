import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { CacheService } from '../../../cache/cache.service';
import { WebhookProvider } from '../domain/webhook-provider.enum';
import { DeliveryStatus } from '../domain/delivery-status.enum';
import type { PageResult } from '../domain/integration-event';

/** Row shape returned by the `webhookIngressDelivery` Prisma delegate. */
interface IngressDeliveryRow {
  readonly id: string;
  readonly endpointId: string;
  readonly guildId: string | null;
  readonly provider: string;
  readonly externalId: string | null;
  readonly eventType: string | null;
  readonly status: string;
  readonly rawBody: Buffer;
  readonly headers: unknown;
  readonly rejectReason: string | null;
  readonly attempts: number;
  readonly receivedAt: Date;
  readonly processedAt: Date | null;
}

/** Row shape returned by the `webhookOutboundDelivery` Prisma delegate. */
interface OutboundDeliveryRow {
  readonly id: string;
  readonly subscriptionId: string;
  readonly guildId: string;
  readonly eventType: string;
  readonly status: string;
  readonly attempts: number;
  readonly lastStatusCode: number | null;
  readonly lastError: string | null;
  readonly payload: unknown;
  readonly createdAt: Date;
  readonly deliveredAt: Date | null;
}

/** Clean domain view of an inbound (ingress) delivery. */
export interface IngressDeliveryRecord {
  readonly id: string;
  readonly endpointId: string;
  readonly guildId: string | null;
  readonly provider: WebhookProvider;
  readonly externalId: string | null;
  readonly eventType: string | null;
  readonly status: DeliveryStatus;
  /** Raw request bytes retained for replay. */
  readonly rawBody: Buffer;
  readonly headers: Readonly<Record<string, unknown>>;
  readonly rejectReason: string | null;
  readonly attempts: number;
  readonly receivedAt: Date;
  readonly processedAt: Date | null;
}

/** Clean domain view of an outbound delivery. */
export interface OutboundDeliveryRecord {
  readonly id: string;
  readonly subscriptionId: string;
  readonly guildId: string;
  readonly eventType: string;
  readonly status: DeliveryStatus;
  readonly attempts: number;
  readonly lastStatusCode: number | null;
  readonly lastError: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
  readonly deliveredAt: Date | null;
}

/** Input to persist a freshly received inbound delivery. */
export interface CreateIngressDeliveryInput {
  readonly endpointId: string;
  readonly guildId: string | null;
  readonly provider: WebhookProvider;
  readonly externalId: string | null;
  readonly headers: Readonly<Record<string, unknown>>;
  /** Exact request bytes (Prisma `Bytes` <-> Buffer). */
  readonly rawBody: Buffer;
}

/** Patch applied to an ingress delivery as it moves through its lifecycle. */
export interface UpdateIngressStatusInput {
  readonly status: DeliveryStatus;
  readonly eventType?: string | null;
  readonly rejectReason?: string | null;
  readonly processedAt?: Date | null;
  readonly attempts?: number;
}

/** Filterable, indexed query over ingress deliveries. */
export interface IngressDeliveryQuery {
  readonly guildId: string | null;
  readonly page: number;
  readonly pageSize: number;
  readonly provider?: WebhookProvider;
  readonly status?: DeliveryStatus;
  readonly eventType?: string;
  readonly from?: Date;
  readonly to?: Date;
}

/** Input to persist a freshly created outbound delivery attempt. */
export interface CreateOutboundDeliveryInput {
  readonly subscriptionId: string;
  readonly guildId: string;
  readonly eventType: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** Patch applied to an outbound delivery after each attempt. */
export interface UpdateOutboundDeliveryInput {
  readonly status: DeliveryStatus;
  readonly attempts: number;
  readonly lastStatusCode?: number | null;
  readonly lastError?: string | null;
  readonly deliveredAt?: Date | null;
}

/**
 * Prisma-only persistence for BOTH webhook delivery tables:
 * `webhook_ingress_deliveries` (inbound) and `webhook_outbound_deliveries`
 * (outbound). The only file in this module that touches them. Delivery rows are
 * hard rows (no soft-delete column); reads filter on the indexed dashboard
 * columns.
 */
@Injectable()
export class WebhookDeliveryRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  private get ingress() {
    return this.prisma['webhookIngressDelivery'];
  }

  private get outbound() {
    return this.prisma['webhookOutboundDelivery'];
  }

  // --- Ingress -------------------------------------------------------------

  /** Persists a newly received inbound delivery (status `received`). */
  async createIngress(
    input: CreateIngressDeliveryInput,
  ): Promise<IngressDeliveryRecord> {
    const row = (await this.ingress.create({
      data: {
        endpointId: input.endpointId,
        guildId: input.guildId,
        provider: input.provider,
        externalId: input.externalId,
        headers: input.headers as Prisma.InputJsonValue,
        rawBody: new Uint8Array(input.rawBody),
        status: DeliveryStatus.Received,
      },
    })) as IngressDeliveryRow;
    return this.toIngress(row);
  }

  async findIngressById(id: string): Promise<IngressDeliveryRecord | null> {
    const row = (await this.ingress.findUnique({
      where: { id },
    })) as IngressDeliveryRow | null;
    return row ? this.toIngress(row) : null;
  }

  /** DB-level dedupe check against the `@@unique([endpointId, externalId])`. */
  async findIngressByExternalId(
    endpointId: string,
    externalId: string,
  ): Promise<IngressDeliveryRecord | null> {
    const row = (await this.ingress.findFirst({
      where: { endpointId, externalId },
    })) as IngressDeliveryRow | null;
    return row ? this.toIngress(row) : null;
  }

  /** Advances an ingress delivery through its lifecycle. */
  async updateIngressStatus(
    id: string,
    input: UpdateIngressStatusInput,
  ): Promise<void> {
    await this.ingress.update({
      where: { id },
      data: {
        status: input.status,
        eventType: input.eventType ?? undefined,
        rejectReason: input.rejectReason ?? undefined,
        processedAt: input.processedAt ?? undefined,
        attempts: input.attempts ?? undefined,
      },
    });
  }

  /** Paginated, filterable ingress delivery log for the dashboard. */
  async listIngress(
    query: IngressDeliveryQuery,
  ): Promise<PageResult<IngressDeliveryRecord>> {
    const where: Record<string, unknown> = { guildId: query.guildId };
    if (query.provider) where['provider'] = query.provider;
    if (query.status) where['status'] = query.status;
    if (query.eventType) where['eventType'] = query.eventType;
    if (query.from || query.to) {
      where['receivedAt'] = {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      };
    }

    const [rows, total] = await Promise.all([
      this.ingress.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }) as Promise<IngressDeliveryRow[]>,
      this.ingress.count({ where }) as Promise<number>,
    ]);
    return {
      items: rows.map((r) => this.toIngress(r)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  // --- Outbound ------------------------------------------------------------

  /** Persists a newly created outbound delivery (status `processing`). */
  async createOutbound(
    input: CreateOutboundDeliveryInput,
  ): Promise<OutboundDeliveryRecord> {
    const row = (await this.outbound.create({
      data: {
        subscriptionId: input.subscriptionId,
        guildId: input.guildId,
        eventType: input.eventType,
        payload: input.payload as Prisma.InputJsonValue,
        status: DeliveryStatus.Processing,
      },
    })) as OutboundDeliveryRow;
    return this.toOutbound(row);
  }

  async findOutboundById(id: string): Promise<OutboundDeliveryRecord | null> {
    const row = (await this.outbound.findUnique({
      where: { id },
    })) as OutboundDeliveryRow | null;
    return row ? this.toOutbound(row) : null;
  }

  /** Records the outcome of an outbound delivery attempt. */
  async updateOutbound(
    id: string,
    input: UpdateOutboundDeliveryInput,
  ): Promise<void> {
    await this.outbound.update({
      where: { id },
      data: {
        status: input.status,
        attempts: input.attempts,
        lastStatusCode: input.lastStatusCode ?? undefined,
        lastError: input.lastError ?? undefined,
        deliveredAt: input.deliveredAt ?? undefined,
      },
    });
  }

  /** Paginated outbound delivery history for a guild (newest first). */
  async listOutbound(
    guildId: string,
    page: number,
    pageSize: number,
  ): Promise<PageResult<OutboundDeliveryRecord>> {
    const where = { guildId };
    const [rows, total] = await Promise.all([
      this.outbound.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }) as Promise<OutboundDeliveryRow[]>,
      this.outbound.count({ where }) as Promise<number>,
    ]);
    return {
      items: rows.map((r) => this.toOutbound(r)),
      total,
      page,
      pageSize,
    };
  }

  // --- Mappers -------------------------------------------------------------

  private toIngress(row: IngressDeliveryRow): IngressDeliveryRecord {
    return {
      id: row.id,
      endpointId: row.endpointId,
      guildId: row.guildId,
      provider: row.provider as WebhookProvider,
      externalId: row.externalId,
      eventType: row.eventType,
      status: row.status as DeliveryStatus,
      rawBody: row.rawBody,
      headers:
        row.headers && typeof row.headers === 'object'
          ? (row.headers as Readonly<Record<string, unknown>>)
          : {},
      rejectReason: row.rejectReason,
      attempts: row.attempts,
      receivedAt: row.receivedAt,
      processedAt: row.processedAt,
    };
  }

  private toOutbound(row: OutboundDeliveryRow): OutboundDeliveryRecord {
    return {
      id: row.id,
      subscriptionId: row.subscriptionId,
      guildId: row.guildId,
      eventType: row.eventType,
      status: row.status as DeliveryStatus,
      attempts: row.attempts,
      lastStatusCode: row.lastStatusCode,
      lastError: row.lastError,
      payload:
        row.payload && typeof row.payload === 'object'
          ? (row.payload as Readonly<Record<string, unknown>>)
          : {},
      createdAt: row.createdAt,
      deliveredAt: row.deliveredAt,
    };
  }
}
