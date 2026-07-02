import { Injectable } from '@nestjs/common';
import { type $Enums } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';
import {
  fromDbComparator,
  fromDbSeverity,
  toDbComparator,
  toDbSeverity,
  type Threshold,
  type ThresholdComparator,
  type ThresholdSeverity,
} from '../../domain/threshold';

interface ThresholdOverrideRow {
  readonly id: string;
  readonly guildId: string;
  readonly metric: string;
  readonly comparator: string;
  readonly value: number;
  readonly severity: string;
  readonly enabled: boolean;
}

export interface UpsertThresholdInput {
  readonly guildId: string;
  readonly metric: string;
  readonly comparator: ThresholdComparator;
  readonly value: number;
  readonly severity: ThresholdSeverity;
  readonly enabled: boolean;
}

/** Persists per-guild threshold overrides (soft-deletable). */
@Injectable()
export class MetricsThresholdRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get overrides() {
    return this.prisma['metricThresholdOverride'];
  }

  /** Enabled overrides for a guild, as domain thresholds. */
  async findEnabledForGuild(guildId: string): Promise<Threshold[]> {
    const rows = (await this.overrides.findMany({
      where: { guildId, enabled: true, deletedAt: null },
    })) as ThresholdOverrideRow[];
    return rows.map((r) => this.toThreshold(r));
  }

  async upsert(input: UpsertThresholdInput): Promise<Threshold> {
    const row = (await this.overrides.upsert({
      where: {
        guildId_metric: { guildId: input.guildId, metric: input.metric },
      },
      create: {
        guildId: input.guildId,
        metric: input.metric,
        comparator: toDbComparator(input.comparator) as $Enums.MetricComparator,
        value: input.value,
        severity: toDbSeverity(input.severity) as $Enums.MetricSeverity,
        enabled: input.enabled,
      },
      update: {
        comparator: toDbComparator(input.comparator) as $Enums.MetricComparator,
        value: input.value,
        severity: toDbSeverity(input.severity) as $Enums.MetricSeverity,
        enabled: input.enabled,
        deletedAt: null,
      },
    })) as ThresholdOverrideRow;
    return this.toThreshold(row);
  }

  async findForGuild(
    guildId: string,
    metric: string,
  ): Promise<Threshold | null> {
    const row = (await this.overrides.findFirst({
      where: { guildId, metric, deletedAt: null },
    })) as ThresholdOverrideRow | null;
    return row ? this.toThreshold(row) : null;
  }

  async softDelete(guildId: string, metric: string): Promise<void> {
    await this.overrides.updateMany({
      where: { guildId, metric, deletedAt: null },
      data: { deletedAt: new Date(), enabled: false },
    });
  }

  private toThreshold(row: ThresholdOverrideRow): Threshold {
    return {
      metric: row.metric,
      comparator: fromDbComparator(row.comparator),
      value: row.value,
      severity: fromDbSeverity(row.severity),
      guildScoped: true,
    };
  }
}
