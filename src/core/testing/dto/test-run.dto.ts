import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TestRunDto {
  @ApiProperty() readonly id!: string;
  @ApiProperty() readonly commitSha!: string;
  @ApiProperty() readonly branch!: string;
  @ApiProperty({ enum: ['UNIT', 'INTEGRATION', 'CONTRACT', 'E2E'] })
  readonly suite!: 'UNIT' | 'INTEGRATION' | 'CONTRACT' | 'E2E';
  @ApiProperty() readonly passed!: number;
  @ApiProperty() readonly failed!: number;
  @ApiProperty() readonly skipped!: number;
  @ApiProperty() readonly durationMs!: number;
  @ApiPropertyOptional({ type: Number }) readonly coverageLines!: number | null;
  @ApiPropertyOptional({ type: Number }) readonly coverageBranches!:
    number | null;
  @ApiProperty() readonly createdAt!: string;
}

export class PaginatedTestRunDto {
  @ApiProperty({ type: [TestRunDto] }) readonly data!: readonly TestRunDto[];
  @ApiProperty() readonly total!: number;
  @ApiProperty() readonly page!: number;
  @ApiProperty() readonly pageSize!: number;
}
