import { ApiProperty } from '@nestjs/swagger';

class HealthContributorDto {
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['up', 'down', 'degraded'] }) state!:
    'up' | 'down' | 'degraded';
  @ApiProperty({ required: false }) detail?: Record<
    string,
    string | number | boolean
  >;
}

export class HealthResponseDto {
  @ApiProperty({ enum: ['ok', 'degraded', 'error'] }) status!:
    'ok' | 'degraded' | 'error';
  @ApiProperty({ type: [HealthContributorDto] })
  contributors!: HealthContributorDto[];
  @ApiProperty() uptimeSeconds!: number;
}
