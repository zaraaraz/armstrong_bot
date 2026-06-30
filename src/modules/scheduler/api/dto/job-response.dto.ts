import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  ScheduleStatus,
  ScheduleType,
} from '../../domain/schedule.entity';

export class JobResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  kind!: string;

  @ApiProperty({ nullable: true, type: String })
  guildId!: string | null;

  @ApiProperty({ enum: ['once', 'recurring'] })
  type!: ScheduleType;

  @ApiProperty()
  status!: ScheduleStatus;

  @ApiPropertyOptional({ type: String, nullable: true })
  cron?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  everyMs?: number | null;

  @ApiProperty({ nullable: true, type: String })
  nextRunAt!: string | null;

  @ApiProperty({ nullable: true, type: String })
  lastRunAt!: string | null;

  @ApiProperty()
  createdAt!: string;
}

export class PaginatedJobsDto {
  @ApiProperty({ type: [JobResponseDto] })
  items!: JobResponseDto[];

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;
}

export class RunResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  attempt!: number;

  @ApiProperty()
  status!: ScheduleStatus;

  @ApiProperty()
  startedAt!: string;

  @ApiProperty({ nullable: true, type: String })
  finishedAt!: string | null;

  @ApiProperty({ nullable: true, type: Number })
  durationMs!: number | null;

  @ApiProperty({ nullable: true, type: String })
  error!: string | null;
}

export class PaginatedRunsDto {
  @ApiProperty({ type: [RunResponseDto] })
  items!: RunResponseDto[];

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  total!: number;
}

export class HealthResponseDto {
  @ApiProperty()
  queueDepth!: number;

  @ApiProperty()
  dlqSize!: number;

  @ApiProperty({ nullable: true, type: String })
  lastReconcileAt!: string | null;

  @ApiProperty()
  workerUp!: boolean;
}
