import { Injectable } from '@nestjs/common';
import { Prisma, type $Enums } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';
import {
  fromDbScope,
  toDbScope,
  type MetricScope,
} from '../../domain/metric-scope';
import type {
  MetricsRangeQuery,
  MetricsSnapshotView,
  PaginatedResult,
} from '../../application/metrics.service.contract';

interface MetricSnapshotRow {
  readonly id: string;
  readonly scope: string;
  readonly guildId: string | null;
  readonly capturedAt: Date;
  readonly values: unknown;
}

export interface CreateSnapshotInput {
  readonly scope: MetricScope;
  readonly guildId: string | null;
  readonly capturedAt: Date;
  readonly values: Readonly<Record<string, number>>;
}

/**
 * Repository for the historical rollup store. Prometheus is the source of truth
 * for live data; these rows back the dashboard's charts only. Rows are
 * append-only and soft-deleted by the retention sweep.
 */
@Injectable()
export class MetricsSnapshotRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get snapshots() {
    return this.prisma['metricSnapshot'];
  }

  async create(input: CreateSnapshotInput): Promise<MetricsSnapshotView> {
    const row = (await this.snapshots.create({
      data: {
        scope: toDbScope(input.scope) as $Enums.MetricScope,
        guildId: input.guildId,
        capturedAt: input.capturedAt,
        values: { ...input.values },
      },
    })) as MetricSnapshotRow;
    return this.toView(row);
  }

  async latest(
    scope: MetricScope,
    guildId: string | null,
  ): Promise<MetricsSnapshotView | null> {
    const row = (await this.snapshots.findFirst({
      where: {
        scope: toDbScope(scope) as $Enums.MetricScope,
        guildId,
        deletedAt: null,
      },
      orderBy: { capturedAt: 'desc' },
    })) as MetricSnapshotRow | null;
    return row ? this.toView(row) : null;
  }

  async range(
    query: MetricsRangeQuery,
  ): Promise<PaginatedResult<MetricsSnapshotView>> {
    const where: Prisma.MetricSnapshotWhereInput = {
      scope: toDbScope(query.scope) as $Enums.MetricScope,
      guildId: query.guildId ?? null,
      deletedAt: null,
      capturedAt: { gte: query.from, lte: query.to },
    };
    const [rows, total] = await Promise.all([
      this.snapshots.findMany({
        where,
        orderBy: { capturedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }) as Promise<MetricSnapshotRow[]>,
      this.snapshots.count({ where }),
    ]);
    return {
      items: rows.map((r) => this.toView(r)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Soft-delete rollups older than `cutoff`; returns the affected count. */
  async softDeleteOlderThan(cutoff: Date): Promise<number> {
    const result = await this.snapshots.updateMany({
      where: { capturedAt: { lt: cutoff }, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return result.count;
  }

  /** Hard-delete rows soft-deleted before `graceCutoff`; returns the count. */
  async hardDeleteSoftDeletedBefore(graceCutoff: Date): Promise<number> {
    const result = await this.snapshots.deleteMany({
      where: { deletedAt: { not: null, lt: graceCutoff } },
    });
    return result.count;
  }

  private toView(row: MetricSnapshotRow): MetricsSnapshotView {
    return {
      id: row.id,
      scope: fromDbScope(row.scope),
      guildId: row.guildId,
      capturedAt: row.capturedAt,
      values: (row.values ?? {}) as Record<string, number>,
    };
  }
}
