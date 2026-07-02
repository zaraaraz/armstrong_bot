import { ApiProperty } from '@nestjs/swagger';

export class AuditEntryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ['GUILD', 'GLOBAL'] })
  scope!: string;

  @ApiProperty({ nullable: true, type: String })
  guildId!: string | null;

  @ApiProperty({ description: 'bigint serialised' })
  seq!: string;

  @ApiProperty()
  action!: string;

  @ApiProperty({
    enum: ['COMMAND', 'DASHBOARD', 'API', 'JOB', 'SYSTEM', 'EVENT'],
  })
  source!: string;

  @ApiProperty({ nullable: true, type: String })
  actorId!: string | null;

  @ApiProperty({ enum: ['USER', 'SYSTEM', 'BOT'] })
  actorType!: string;

  @ApiProperty({ nullable: true, type: String })
  targetType!: string | null;

  @ApiProperty({ nullable: true, type: String })
  targetId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  channelId!: string | null;

  @ApiProperty()
  correlationId!: string;

  @ApiProperty({ nullable: true, type: String })
  causationId!: string | null;

  @ApiProperty({ description: 'translatable label key' })
  summary!: string;

  @ApiProperty({ type: Object })
  metadata!: Record<string, unknown>;

  @ApiProperty({ type: Object, nullable: true })
  before!: Record<string, unknown> | null;

  @ApiProperty({ type: Object, nullable: true })
  after!: Record<string, unknown> | null;

  @ApiProperty({ nullable: true, type: String })
  previousHash!: string | null;

  @ApiProperty()
  hash!: string;

  @ApiProperty()
  occurredAt!: string;

  @ApiProperty()
  createdAt!: string;
}

export class PaginatedAuditDto {
  @ApiProperty({ type: [AuditEntryResponseDto] })
  items!: AuditEntryResponseDto[];

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;
}

export class ChainVerificationDto {
  @ApiProperty({ enum: ['GUILD', 'GLOBAL'] })
  scope!: string;

  @ApiProperty({ nullable: true, type: String })
  guildId!: string | null;

  @ApiProperty()
  checked!: number;

  @ApiProperty()
  valid!: boolean;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'bigint serialised',
  })
  firstBrokenSeq!: string | null;

  @ApiProperty()
  verifiedAt!: string;
}

export class RetentionConfigDto {
  @ApiProperty()
  retentionDays!: number;

  @ApiProperty()
  archiveBeforeDelete!: boolean;

  @ApiProperty({ enum: ['json', 'ndjson', 'csv'] })
  archiveFormat!: string;
}

export class AuditHealthDto {
  @ApiProperty()
  queueDepth!: number;

  @ApiProperty()
  dlqSize!: number;

  @ApiProperty()
  ingestEnabled!: boolean;
}
