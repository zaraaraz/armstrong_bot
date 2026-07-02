import type {
  NotificationCategory,
  NotificationChannel,
  NotificationPriority,
  TemplateVars,
} from '../notifications.public';

/** DeliveryStatus mirrors the Prisma enum. */
export type DeliveryStatus =
  'PENDING' | 'SENT' | 'FAILED' | 'DEAD' | 'CANCELLED';

/** A persisted notification with its fanned-out deliveries. */
export interface NotificationRecord {
  readonly id: string;
  readonly guildId: string | null;
  readonly category: NotificationCategory;
  readonly priority: NotificationPriority;
  readonly templateKey: string;
  readonly vars: TemplateVars;
  readonly dedupeKey: string | null;
  readonly createdAt: Date;
  readonly deliveries: readonly DeliveryRecord[];
}

/** One transport attempt row. */
export interface DeliveryRecord {
  readonly id: string;
  readonly notificationId: string;
  readonly channel: NotificationChannel;
  readonly status: DeliveryStatus;
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

/** Input shape for persisting a notification and its initial deliveries. */
export interface CreateNotificationInput {
  readonly guildId: string | null;
  readonly category: NotificationCategory;
  readonly priority: NotificationPriority;
  readonly templateKey: string;
  readonly vars: TemplateVars;
  readonly dedupeKey: string | null;
  readonly deliveries: readonly CreateDeliveryInput[];
}

export interface CreateDeliveryInput {
  readonly channel: NotificationChannel;
  readonly recipientUserId: string | null;
  readonly recipientRef: string | null;
  readonly scheduledFor: Date | null;
}

export interface Pagination {
  readonly page: number;
  readonly pageSize: number;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface NotificationQuery {
  readonly guildId: string | null;
  readonly category?: NotificationCategory;
  readonly pagination: Pagination;
}
