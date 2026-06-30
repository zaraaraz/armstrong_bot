import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import type { TestSuite, Prisma } from '@prisma/client';

export type Decimal = Prisma.Decimal;

export interface TestRunRecord {
  id: string;
  commitSha: string;
  branch: string;
  suite: TestSuite;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  coverageLines: Decimal | null;
  coverageBranches: Decimal | null;
  createdAt: Date;
  deletedAt: Date | null;
}

export interface ListTestRunsQuery {
  branch?: string;
  suite?: TestSuite;
  page: number;
  pageSize: number;
}

@Injectable()
export class TestRunRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: ListTestRunsQuery,
  ): Promise<{ items: TestRunRecord[]; total: number }> {
    const where = {
      deletedAt: null,
      ...(query.branch ? { branch: query.branch } : {}),
      ...(query.suite ? { suite: query.suite } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.testRun.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.testRun.count({ where }),
    ]);

    return { items, total };
  }

  async findById(id: string): Promise<TestRunRecord | null> {
    return this.prisma.testRun.findFirst({ where: { id, deletedAt: null } });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.testRun.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
