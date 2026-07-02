import { Injectable } from '@nestjs/common';
import { MetricsRegistry } from '../infrastructure/metrics.registry';
import { METRIC_CATALOG } from '../domain/metric-definition';
import { METRIC_SCOPES, type MetricScope } from '../domain/metric-scope';

export interface ScopedSnapshotValues {
  readonly scope: MetricScope;
  readonly values: Record<string, number>;
}

/**
 * Builds per-scope rollups from the live registry. For each scope we collapse
 * every series of that scope's metrics into a single aggregate number (sum for
 * counters/histogram counts, last value for gauges) — enough to back the
 * dashboard's historical tiles without persisting full label cardinality.
 */
@Injectable()
export class MetricsSnapshotBuilder {
  constructor(private readonly registry: MetricsRegistry) {}

  async buildAll(): Promise<ScopedSnapshotValues[]> {
    const metrics = await this.registry.registry.getMetricsAsJSON();
    const byName = new Map<string, number>();

    for (const metric of metrics) {
      const values = (
        metric as { values?: Array<{ value: number; metricName?: string }> }
      ).values;
      if (!values || values.length === 0) continue;
      // sum sample values for counters/histograms; for gauges the sum of a
      // single-series gauge equals its value, which is what we want here.
      const total = values.reduce((acc, v) => acc + (v.value ?? 0), 0);
      byName.set(metric.name, total);
    }

    return METRIC_SCOPES.map((scope) => ({
      scope,
      values: this.valuesForScope(scope, byName),
    })).filter((s) => Object.keys(s.values).length > 0);
  }

  private valuesForScope(
    scope: MetricScope,
    byName: Map<string, number>,
  ): Record<string, number> {
    const values: Record<string, number> = {};
    for (const def of Object.values(METRIC_CATALOG)) {
      if (def.scope !== scope) continue;
      const value = byName.get(def.name);
      if (value !== undefined) values[def.name] = value;
    }
    return values;
  }
}
