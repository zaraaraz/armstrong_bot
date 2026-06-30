import {
  Controller,
  Get,
  Param,
  Query,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import {
  TestRunRepository,
  type TestRunRecord,
} from '../infrastructure/test-run.repository';
import type { PaginatedTestRunDto, TestRunDto } from '../dto/test-run.dto';
import type { TestSuite } from '@prisma/client';

@ApiTags('Testing')
@ApiBearerAuth()
@Controller('admin/test-runs')
export class TestRunsController {
  constructor(private readonly repo: TestRunRepository) {}

  @Get()
  @ApiOperation({ summary: 'Paginated CI test run history' })
  async list(
    @Query() raw: Record<string, string>,
  ): Promise<PaginatedTestRunDto> {
    const page = Math.max(1, Number(raw['page'] ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(raw['pageSize'] ?? 25)));
    const branch = raw['branch'] as string | undefined;
    const suite = raw['suite'] as TestSuite | undefined;

    const { items, total } = await this.repo.list({
      page,
      pageSize,
      branch,
      suite,
    });

    return { data: items.map((r) => this.toDto(r)), total, page, pageSize };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Single test run record' })
  async getOne(@Param('id') id: string): Promise<TestRunDto> {
    const record = await this.repo.findById(id);
    if (!record) throw new NotFoundException(`TestRun ${id} not found`);
    return this.toDto(record);
  }

  private toDto(r: TestRunRecord): TestRunDto {
    return {
      id: r.id,
      commitSha: r.commitSha,
      branch: r.branch,
      suite: r.suite,
      passed: r.passed,
      failed: r.failed,
      skipped: r.skipped,
      durationMs: r.durationMs,
      coverageLines: r.coverageLines ? Number(r.coverageLines) : null,
      coverageBranches: r.coverageBranches ? Number(r.coverageBranches) : null,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
