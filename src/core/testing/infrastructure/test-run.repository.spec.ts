import { describe, it, expect, beforeEach } from 'vitest';
import { createPrismaMock } from '../../../tests/fixtures/prisma/prisma-mock';
import { TestRunRepository } from './test-run.repository';
import { PrismaService } from '../../../database/prisma.service';

describe('TestRunRepository', () => {
  let prismaMock: ReturnType<typeof createPrismaMock>;
  let repo: TestRunRepository;

  beforeEach(() => {
    prismaMock = createPrismaMock();
    repo = new TestRunRepository(prismaMock as unknown as PrismaService);
  });

  it('list applies branch filter and pagination', async () => {
    const mockItems = [
      {
        id: 'tr-1',
        commitSha: 'abc123',
        branch: 'main',
        suite: 'UNIT' as const,
        passed: 10,
        failed: 0,
        skipped: 0,
        durationMs: 5000,
        coverageLines: null,
        coverageBranches: null,
        createdAt: new Date('2026-06-30T00:00:00Z'),
        deletedAt: null,
      },
    ];
    prismaMock.testRun.findMany.mockResolvedValue(mockItems);
    prismaMock.testRun.count.mockResolvedValue(1);

    const result = await repo.list({ branch: 'main', page: 1, pageSize: 10 });

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(prismaMock.testRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ branch: 'main' }),
      }),
    );
  });

  it('findById returns null for soft-deleted records', async () => {
    prismaMock.testRun.findFirst.mockResolvedValue(null);

    const result = await repo.findById('tr-deleted');

    expect(result).toBeNull();
    expect(prismaMock.testRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      }),
    );
  });
});
