import { Injectable, Logger } from '@nestjs/common';
import { MetricName } from '../domain/metric-name.enum';
import { METRIC_CATALOG } from '../domain/metric-definition';
import { MetricsRegistry } from '../infrastructure/metrics.registry';
import { PROMETHEUS_CONTENT_TYPE } from '../metrics.constants';
import { MetricsService, type MetricLabels } from './metrics.service.contract';

/**
 * Concrete {@link MetricsService}. Every method is a synchronous register
 * mutation guarded so a bad call (unknown label, NaN) is logged and dropped
 * rather than thrown — recording must never break the caller's hot path.
 */
@Injectable()
export class MetricsServiceImpl extends MetricsService {
  private readonly logger = new Logger('metrics.service');

  constructor(private readonly registry: MetricsRegistry) {
    super();
  }

  incCounter(name: MetricName, value = 1, labels?: MetricLabels): void {
    this.safe(name, () => {
      const counter = this.registry.counter(name);
      if (labels) counter.inc(this.pick(name, labels), value);
      else counter.inc(value);
    });
  }

  setGauge(name: MetricName, value: number, labels?: MetricLabels): void {
    if (!Number.isFinite(value)) return;
    this.safe(name, () => {
      const gauge = this.registry.gauge(name);
      if (labels) gauge.set(this.pick(name, labels), value);
      else gauge.set(value);
    });
  }

  observeHistogram(
    name: MetricName,
    value: number,
    labels?: MetricLabels,
  ): void {
    if (!Number.isFinite(value)) return;
    this.safe(name, () => {
      const histogram = this.registry.histogram(name);
      if (labels) histogram.observe(this.pick(name, labels), value);
      else histogram.observe(value);
    });
  }

  startTimer(
    name: MetricName,
    labels?: MetricLabels,
  ): (extraLabels?: MetricLabels) => number {
    const start = process.hrtime.bigint();
    return (extraLabels?: MetricLabels): number => {
      const elapsedSeconds =
        Number(process.hrtime.bigint() - start) / 1_000_000_000;
      const merged = { ...(labels ?? {}), ...(extraLabels ?? {}) };
      this.observeHistogram(
        name,
        elapsedSeconds,
        Object.keys(merged).length > 0 ? merged : undefined,
      );
      return elapsedSeconds;
    };
  }

  render(): Promise<string> {
    return this.registry.render();
  }

  get contentType(): string {
    return PROMETHEUS_CONTENT_TYPE;
  }

  /**
   * Keep only the label keys this metric declares, coercing values to strings.
   * Drops any stray key so a caller can never widen a metric's label set (and
   * thus its cardinality) by accident.
   */
  private pick(name: MetricName, labels: MetricLabels): Record<string, string> {
    const allowed = METRIC_CATALOG[name].labelNames;
    const out: Record<string, string> = {};
    for (const key of allowed) {
      const value = labels[key];
      if (value !== undefined) out[key] = String(value);
    }
    return out;
  }

  private safe(name: MetricName, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.logger.debug(
        `dropped metric ${name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
