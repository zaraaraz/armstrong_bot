import { ApiProperty } from '@nestjs/swagger';
import { DELIVERY_STATUSES } from '../domain/delivery-status.enum';
import { WEBHOOK_PROVIDERS } from '../domain/webhook-provider.enum';

/** Enum value lists for Swagger metadata (mirrors sibling response DTOs). */
const PROVIDERS = WEBHOOK_PROVIDERS as readonly string[];
const STATUSES = DELIVERY_STATUSES as readonly string[];

/** An inbound endpoint as returned to the dashboard (never exposes the secret). */
export class EndpointResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: PROVIDERS })
  provider!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({ nullable: true, type: String })
  guildId!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

/**
 * Returned only on endpoint create/rotate — the once-only reveal of the public
 * ingress token and the plaintext signing secret. Never returned afterwards.
 */
export class EndpointSecretResponseDto extends EndpointResponseDto {
  @ApiProperty({
    description: 'Public ingress path token: /webhooks/in/:token.',
  })
  token!: string;

  @ApiProperty({ description: 'Plaintext signing secret; shown exactly once.' })
  signingSecret!: string;
}

/** An inbound delivery row for the delivery log. */
export class DeliveryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: PROVIDERS })
  provider!: string;

  @ApiProperty({ nullable: true, type: String })
  eventType!: string | null;

  @ApiProperty({ enum: STATUSES })
  status!: string;

  @ApiProperty({ nullable: true, type: String })
  externalId!: string | null;

  @ApiProperty()
  attempts!: number;

  @ApiProperty({ format: 'date-time' })
  receivedAt!: string;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  processedAt!: string | null;
}

/** An outbound subscription as returned to the dashboard. */
export class SubscriptionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  eventType!: string;

  @ApiProperty()
  targetUrl!: string;

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

/** An outbound delivery attempt row for the outbound history / DLQ view. */
export class OutboundDeliveryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  eventType!: string;

  @ApiProperty({ enum: STATUSES })
  status!: string;

  @ApiProperty()
  attempts!: number;

  @ApiProperty({ nullable: true, type: Number })
  lastStatusCode!: number | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  deliveredAt!: string | null;
}

/** Paginated wrapper for the delivery log. */
export class PagedDeliveriesDto {
  @ApiProperty({ type: [DeliveryResponseDto] })
  items!: DeliveryResponseDto[];

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;
}

/** Paginated wrapper for the outbound delivery history. */
export class PagedOutboundDeliveriesDto {
  @ApiProperty({ type: [OutboundDeliveryResponseDto] })
  items!: OutboundDeliveryResponseDto[];

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;
}
