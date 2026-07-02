import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, type Metric } from 'prom-client';
import {
  METRIC_CATALOG,
  assertCatalogComplete,
  assertNoForbiddenLabels,
  type MetricDefinition,
} from '../domain/metric-definition';
import { MetricName } from '../domain/metric-name.enum';

/** Union of the prom-client instruments we lazily create. */
type AnyMetric = Counter<string> | Gauge<string> | Histogram<string>;

/**
 * Owns the module's shared prom-client {@link Registry} and lazily materialises
 * catalog metrics on first use. It also aggregates *external* registries — the
 * per-module private registries (audit/scheduler/storage) plus prom-client's
 * default registry — so `render()` exposes every metric family through a single
 * exporter without those modules importing this one.
 *
 * Cardinality safety is structural: a metric can only be created from its
 * {@link MetricDefinition}, whose label keys are a fixed, forbidden-key-screened
 * set. Recording with an undeclared label key throws in prom-client.
 */
@Injectable()
export class MetricsRegistry {
  readonly registry = new Registry();
  private readonly instruments = new Map<MetricName, AnyMetric>();
  private readonly external = new Set<Registry>();
  private defaultBuckets: readonly number[] = [
    0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
  ];

  constructor() {
    // Fail fast at construction if the catalog is inconsistent or unsafe.
    assertCatalogComplete();
    assertNoForbiddenLabels();
  }

  /** Set the default histogram buckets (from config) before first use. */
  setDefaultBuckets(buckets: readonly number[]): void {
    if (buckets.length > 0) this.defaultBuckets = [...buckets];
  }

  /**
   * Register an external registry to be merged into the exposition output.
   * Idempotent. Used to fold in the default registry and any module-private
   * registries so a single `/metrics` scrape returns everything.
   */
  attach(registry: Registry): void {
    this.external.add(registry);
  }

  /** Lazily create (once) and return the counter for `name`. */
  counter(name: MetricName): Counter<string> {
    return this.resolve(name, 'counter') as Counter<string>;
  }

  gauge(name: MetricName): Gauge<string> {
    return this.resolve(name, 'gauge') as Gauge<string>;
  }

  histogram(name: MetricName): Histogram<string> {
    return this.resolve(name, 'histogram') as Histogram<string>;
  }

  /** Render this registry merged with all attached external registries. */
  async render(): Promise<string> {
    const merged = Registry.merge([this.registry, ...this.external]);
    return merged.metrics();
  }

  /**
   * Register a raw pre-built metric (used by collectors whose value comes from
   * a `collect` callback rather than facade calls).
   */
  registerRaw(metric: Metric): void {
    this.registry.registerMetric(metric);
  }

  private resolve(
    name: MetricName,
    expected: MetricDefinition['type'],
  ): AnyMetric {
    const existing = this.instruments.get(name);
    if (existing) return existing;

    const def = METRIC_CATALOG[name];
    if (def.type !== expected) {
      throw new Error(`metric ${name} is a ${def.type}, not a ${expected}`);
    }
    const instrument = this.build(def);
    this.instruments.set(name, instrument);
    return instrument;
  }

  private build(def: MetricDefinition): AnyMetric {
    const labelNames = [...def.labelNames];
    switch (def.type) {
      case 'counter':
        return new Counter({
          name: def.name,
          help: def.help,
          labelNames,
          registers: [this.registry],
        });
      case 'gauge':
        return new Gauge({
          name: def.name,
          help: def.help,
          labelNames,
          registers: [this.registry],
        });
      case 'histogram':
        return new Histogram({
          name: def.name,
          help: def.help,
          labelNames,
          buckets: [...(def.buckets ?? this.defaultBuckets)],
          registers: [this.registry],
        });
      default: {
        const exhaustive: never = def.type;
        return exhaustive;
      }
    }
  }
}
