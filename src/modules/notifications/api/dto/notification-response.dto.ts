import { ApiProperty } from '@nestjs/swagger';

const CHANNELS = ['DISCORD_DM', 'DISCORD_CHANNEL', 'WEBHOOK', 'EMAIL', 'PUSH'];
const STATUSES = ['PENDING', 'SENT', 'FAILED', 'DEAD', 'CANCELLED'];

export class DeliveryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: CHANNELS })
  channel!: string;

  @ApiProperty({ enum: STATUSES })
  status!: string;

  @ApiProperty({ nullable: true, type: String })
  recipientUserId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  recipientRef!: string | null;

  @ApiProperty({ nullable: true, type: String })
  providerMessageId!: string | null;

  @ApiProperty()
  attempts!: number;

  @ApiProperty({ nullable: true, type: String })
  lastError!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  deliveredAt!: string | null;
}

export class NotificationResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ nullable: true, type: String })
  guildId!: string | null;

  @ApiProperty()
  category!: string;

  @ApiProperty()
  priority!: string;

  @ApiProperty()
  templateKey!: string;

  @ApiProperty({ type: Object })
  vars!: Record<string, unknown>;

  @ApiProperty({ nullable: true, type: String })
  dedupeKey!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: [DeliveryResponseDto] })
  deliveries!: DeliveryResponseDto[];
}

export class PaginatedNotificationsDto {
  @ApiProperty({ type: [NotificationResponseDto] })
  items!: NotificationResponseDto[];

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;
}

export class DispatchResultDto {
  @ApiProperty()
  notificationId!: string;

  @ApiProperty()
  enqueuedDeliveries!: number;

  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: {
        channel: { type: 'string' },
        reason: { type: 'string' },
      },
    },
  })
  skipped!: Array<{ channel: string; reason: string }>;
}

export class PreferenceEntryDto {
  @ApiProperty()
  category!: string;

  @ApiProperty({ enum: CHANNELS })
  channel!: string;

  @ApiProperty()
  enabled!: boolean;
}

export class MergedPreferencesDto {
  @ApiProperty()
  guildId!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty({ type: [PreferenceEntryDto] })
  preferences!: PreferenceEntryDto[];
}

export class IntegrationSubscriptionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ['TWITCH', 'YOUTUBE', 'GITHUB'] })
  provider!: string;

  @ApiProperty()
  externalId!: string;

  @ApiProperty({ nullable: true, type: String })
  announceChannelId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  cursor!: string | null;

  @ApiProperty()
  active!: boolean;
}

export class NotificationsHealthDto {
  @ApiProperty()
  deliveryQueueDepth!: number;

  @ApiProperty()
  dlqSize!: number;

  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: {
        channel: { type: 'string' },
        healthy: { type: 'boolean' },
        detail: { type: 'string' },
      },
    },
  })
  providers!: Array<{ channel: string; healthy: boolean; detail?: string }>;
}
