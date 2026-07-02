import { Injectable, Logger } from '@nestjs/common';
import { MetricsConfigService } from '../config/metrics-config.service';
import { MetricsThresholdRepository } from '../infrastructure/repositories/metrics-threshold.repository';
import { MetricsEventEmitter } from '../events/metrics-event.emitter';
import { METRIC_CATALOG } from '../domain/metric-definition';
import type { MetricScope } from '../domain/metric-scope';
import {
  isBreached,
  type EffectiveThreshold,
  type Threshold,
} from '../domain/threshold';

/**
 * Evaluates observed values against the effective threshold set (global config
 * defaults layered under enabled per-guild overrides) and emits
 * `metrics.threshold.breached` when a rule trips. Off the hot path: callers
 * fire-and-forget `void evaluate(...)`; failures are logged, never thrown back.
 */
@Injectable()
export class ThresholdEvaluatorService {
  private readonly logger = new Logger('metrics.threshold');

  constructor(
    private readonly config: MetricsConfigService,
    private readonly repo: MetricsThresholdRepository,
    private readonly emitter: MetricsEventEmitter,
  ) {}

  /** Effective thresholds for a metric: guild override wins over global default. */
  async effectiveFor(
    metric: string,
    guildId: string | null,
  ): Promise<EffectiveThreshold[]> {
    const defaults: EffectiveThreshold[] = this.config
      .global()
      .thresholds.filter((t) => t.metric === metric)
      .map((t) => ({ ...t, source: 'default' }));

    if (guildId === null) return defaults;

    const overrides = await this.repo.findEnabledForGuild(guildId);
    const overridden = new Set(overrides.map((o) => o.metric));
    const merged: EffectiveThreshold[] = overrides
      .filter((o) => o.metric === metric)
      .map((o) => ({ ...o, source: 'override' }));
    // keep defaults only where no override exists for that metric
    for (const d of defaults) {
      if (!overridden.has(d.metric)) merged.push(d);
    }
    return merged;
  }

  /** All effective thresholds (every metric) for the dashboard list view. */
  async allEffective(guildId: string | null): Promise<EffectiveThreshold[]> {
    const defaults: EffectiveThreshold[] = this.config
      .global()
      .thresholds.map((t) => ({ ...t, source: 'default' }));
    if (guildId === null) return defaults;

    const overrides = await this.repo.findEnabledForGuild(guildId);
    const overriddenMetrics = new Set(overrides.map((o) => o.metric));
    const result: EffectiveThreshold[] = overrides.map((o) => ({
      ...o,
      source: 'override',
    }));
    for (const d of defaults) {
      if (!overriddenMetrics.has(d.metric)) result.push(d);
    }
    return result;
  }

  /**
   * Evaluate one observed value; emit a breach per tripped threshold. Safe to
   * call fire-and-forget from an event handler.
   */
  async evaluate(
    metric: string,
    value: number,
    guildId: string | null,
  ): Promise<void> {
    try {
      const thresholds = await this.effectiveFor(metric, guildId);
      for (const t of thresholds) {
        if (isBreached(value, t)) await this.emitBreach(t, value, guildId);
      }
    } catch (err) {
      this.logger.warn(
        `threshold evaluation failed for ${metric}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async emitBreach(
    threshold: Threshold,
    value: number,
    guildId: string | null,
  ): Promise<void> {
    const scope = this.scopeFor(threshold.metric);
    this.logger.warn(
      `threshold breached: ${threshold.metric} ${threshold.comparator} ${threshold.value} (observed ${value}, severity ${threshold.severity}, guild ${guildId ?? 'global'})`,
    );
    await this.emitter.emitThresholdBreached({
      metric: threshold.metric,
      scope,
      value,
      threshold: threshold.value,
      comparator: threshold.comparator,
      severity: threshold.severity,
      guildId,
      observedAt: new Date().toISOString(),
    });
  }

  private scopeFor(metric: string): MetricScope {
    const def = Object.values(METRIC_CATALOG).find(
      (d) => String(d.name) === metric,
    );
    return def?.scope ?? 'system';
  }
}
