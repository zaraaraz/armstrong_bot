import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import type {
  NotificationCategory,
  NotificationChannel,
  NotificationPriority,
  TemplateVars,
} from '../notifications.public';
import type {
  CreateNotificationInput,
  DeliveryRecord,
  DeliveryStatus,
  NotificationQuery,
  NotificationRecord,
  Page,
} from '../domain/notification.model';

interface DeliveryRow {
  readonly id: string;
  readonly notificationId: string;
  readonly channel: string;
  readonly status: string;
  readonly recipientUserId: string | null;
  readonly recipientRef: string | null;
  readonly providerMessageId: string | null;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly scheduledFor: Date | null;
  readonly deliveredAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface NotificationRow {
  readonly id: string;
  readonly guildId: string | null;
  readonly category: string;
  readonly priority: string;
  readonly templateKey: string;
  readonly vars: unknown;
  readonly dedupeKey: string | null;
  readonly createdAt: Date;
  readonly deliveries?: DeliveryRow[];
}

export interface MarkResultInput {
  readonly status: Extract<DeliveryStatus, 'SENT' | 'FAILED' | 'DEAD'>;
  readonly providerMessageId?: string | null;
  readonly error?: string | null;
  readonly deliveredAt?: Date | null;
  readonly attempts: number;
}

/**
 * Prisma-only persistence for {@link Notification} + {@link NotificationDelivery}.
 * The only file in this module that touches those tables. Reads scope to
 * `deletedAt IS NULL` on the notification.
 */
@Injectable()
export class NotificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get notifications() {
    return this.prisma['notification'];
  }

  private get deliveries() {
    return this.prisma['notificationDelivery'];
  }

  /** Persists a notification with all initial deliveries in one transaction. */
  async create(input: CreateNotificationInput): Promise<NotificationRecord> {
    const row = (await this.notifications.create({
      data: {
        guildId: input.guildId,
        category: input.category,
        priority: input.priority,
        templateKey: input.templateKey,
        vars: input.vars,
        dedupeKey: input.dedupeKey,
        deliveries: {
          create: input.deliveries.map((d) => ({
            channel: d.channel,
            recipientUserId: d.recipientUserId,
            recipientRef: d.recipientRef,
            scheduledFor: d.scheduledFor,
          })),
        },
      },
      include: { deliveries: true },
    })) as NotificationRow;
    return this.toRecord(row);
  }

  /** Returns an existing notification that claimed the same dedupe key. */
  async findByDedupeKey(
    guildId: string | null,
    dedupeKey: string,
  ): Promise<NotificationRecord | null> {
    const row = (await this.notifications.findFirst({
      where: { guildId, dedupeKey, deletedAt: null },
      include: { deliveries: true },
      orderBy: { createdAt: 'desc' },
    })) as NotificationRow | null;
    return row ? this.toRecord(row) : null;
  }

  async findById(id: string): Promise<NotificationRecord | null> {
    const row = (await this.notifications.findFirst({
      where: { id, deletedAt: null },
      include: { deliveries: true },
    })) as NotificationRow | null;
    return row ? this.toRecord(row) : null;
  }

  async findDelivery(id: string): Promise<DeliveryRecord | null> {
    const row = (await this.deliveries.findUnique({
      where: { id },
    })) as DeliveryRow | null;
    return row ? this.toDelivery(row) : null;
  }

  async list(query: NotificationQuery): Promise<Page<NotificationRecord>> {
    const where: Prisma.NotificationWhereInput = {
      guildId: query.guildId,
      deletedAt: null,
      ...(query.category ? { category: query.category } : {}),
    };
    const [rows, total] = await Promise.all([
      this.notifications.findMany({
        where,
        include: { deliveries: true },
        orderBy: { createdAt: 'desc' },
        skip: (query.pagination.page - 1) * query.pagination.pageSize,
        take: query.pagination.pageSize,
      }) as Promise<NotificationRow[]>,
      this.notifications.count({ where }),
    ]);
    return {
      items: rows.map((r) => this.toRecord(r)),
      total,
      page: query.pagination.page,
      pageSize: query.pagination.pageSize,
    };
  }

  /** Records a terminal delivery outcome from the worker. */
  async markResult(deliveryId: string, input: MarkResultInput): Promise<void> {
    await this.deliveries.update({
      where: { id: deliveryId },
      data: {
        status: input.status,
        providerMessageId: input.providerMessageId ?? undefined,
        lastError: input.error ?? null,
        deliveredAt: input.deliveredAt ?? null,
        attempts: input.attempts,
      },
    });
  }

  /** Bumps the attempt counter and records the transient error mid-retry. */
  async markAttempt(
    deliveryId: string,
    attempts: number,
    error: string | null,
  ): Promise<void> {
    await this.deliveries.update({
      where: { id: deliveryId },
      data: { attempts, lastError: error, status: 'FAILED' },
    });
  }

  /**
   * Cancels every still-pending delivery for a notification. Returns the ids of
   * the deliveries actually cancelled so the caller can pull their jobs.
   */
  async cancelPending(notificationId: string): Promise<string[]> {
    const pending = (await this.deliveries.findMany({
      where: { notificationId, status: 'PENDING' },
      select: { id: true },
    })) as Array<{ id: string }>;
    if (pending.length === 0) return [];
    await this.deliveries.updateMany({
      where: { notificationId, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
    return pending.map((p) => p.id);
  }

  /** Deliveries in FAILED/DEAD state for the DLQ inspector. */
  async listFailed(
    guildId: string | null,
    page: number,
    pageSize: number,
  ): Promise<Page<DeliveryRecord>> {
    const where: Prisma.NotificationDeliveryWhereInput = {
      status: { in: ['FAILED', 'DEAD'] },
      notification: { guildId, deletedAt: null },
    };
    const [rows, total] = await Promise.all([
      this.deliveries.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }) as Promise<DeliveryRow[]>,
      this.deliveries.count({ where }),
    ]);
    return {
      items: rows.map((r) => this.toDelivery(r)),
      total,
      page,
      pageSize,
    };
  }

  private toRecord(row: NotificationRow): NotificationRecord {
    return {
      id: row.id,
      guildId: row.guildId,
      category: row.category as NotificationCategory,
      priority: row.priority as NotificationPriority,
      templateKey: row.templateKey,
      vars: (row.vars ?? {}) as TemplateVars,
      dedupeKey: row.dedupeKey,
      createdAt: row.createdAt,
      deliveries: (row.deliveries ?? []).map((d) => this.toDelivery(d)),
    };
  }

  private toDelivery(row: DeliveryRow): DeliveryRecord {
    return {
      id: row.id,
      notificationId: row.notificationId,
      channel: row.channel as NotificationChannel,
      status: row.status as DeliveryStatus,
      recipientUserId: row.recipientUserId,
      recipientRef: row.recipientRef,
      providerMessageId: row.providerMessageId,
      attempts: row.attempts,
      lastError: row.lastError,
      scheduledFor: row.scheduledFor,
      deliveredAt: row.deliveredAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
