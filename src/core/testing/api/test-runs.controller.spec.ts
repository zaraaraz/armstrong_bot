import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { TestRunsController } from './test-runs.controller';
import { TestRunRepository } from '../infrastructure/test-run.repository';

function makeRepo(): TestRunRepository {
  return {
    list: vi.fn(),
    findById: vi.fn(),
    softDelete: vi.fn(),
  } as unknown as TestRunRepository;
}

describe('TestRunsController', () => {
  let controller: TestRunsController;
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    repo = makeRepo();
    controller = new TestRunsController(repo);
  });

  it('list returns paginated result', async () => {
    vi.mocked(repo.list).mockResolvedValue({
      items: [
        {
          id: 'tr-1',
          commitSha: 'abc',
          branch: 'main',
          suite: 'UNIT',
          passed: 5,
          failed: 0,
          skipped: 0,
          durationMs: 3000,
          coverageLines: null,
          coverageBranches: null,
          createdAt: new Date('2026-06-30T00:00:00Z'),
          deletedAt: null,
        },
      ],
      total: 1,
    });

    const result = await controller.list({ page: '1', pageSize: '25' });

    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].suite).toBe('UNIT');
  });

  it('getOne throws 404 when not found', async () => {
    vi.mocked(repo.findById).mockResolvedValue(null);
    await expect(controller.getOne('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('getOne maps Decimal coverage fields to numbers', async () => {
    const { Prisma } = await import('@prisma/client');
    const Decimal = Prisma.Decimal;
    vi.mocked(repo.findById).mockResolvedValue({
      id: 'tr-2',
      commitSha: 'def',
      branch: 'feat',
      suite: 'INTEGRATION',
      passed: 3,
      failed: 1,
      skipped: 0,
      durationMs: 8000,
      coverageLines: new Decimal('82.50'),
      coverageBranches: new Decimal('76.00'),
      createdAt: new Date('2026-06-30T00:00:00Z'),
      deletedAt: null,
    });

    const result = await controller.getOne('tr-2');

    expect(result.coverageLines).toBe(82.5);
    expect(result.coverageBranches).toBe(76);
  });
});
