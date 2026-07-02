import { ApiProperty } from '@nestjs/swagger';
import { METRIC_SCOPES } from '../domain/metric-scope';

export class MetricsSnapshotDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: METRIC_SCOPES })
  scope!: string;

  @ApiProperty({ nullable: true, type: String })
  guildId!: string | null;

  @ApiProperty({ format: 'date-time' })
  capturedAt!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
  })
  values!: Record<string, number>;
}

export class PaginatedSnapshotDto {
  @ApiProperty({ type: [MetricsSnapshotDto] })
  items!: MetricsSnapshotDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;
}

export class ThresholdDto {
  @ApiProperty()
  metric!: string;

  @ApiProperty({ enum: ['gt', 'lt', 'gte', 'lte'] })
  comparator!: string;

  @ApiProperty()
  value!: number;

  @ApiProperty({ enum: ['warning', 'critical'] })
  severity!: string;

  @ApiProperty({ enum: ['default', 'override'] })
  source!: string;
}
