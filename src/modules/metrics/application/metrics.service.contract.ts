import { MetricName } from '../domain/metric-name.enum';
import type { MetricScope } from '../domain/metric-scope';

/**
 * Canonical, low-cardinality label sets. No user IDs, no free text. The registry
 * rejects any label key not declared in the metric's catalog definition.
 */
export interface MetricLabels {
  readonly [label: string]: string | number;
}

/**
 * Stable recording facade. Inject this abstract token anywhere a metric needs
 * to be recorded — never import `prom-client` outside the Metrics module.
 *
 * All operations are synchronous in-memory register mutations: they never
 * `await`, never touch I/O, and never throw on the hot path (invalid input is
 * swallowed and logged). Safe to call from a command/HTTP handler.
 */
export abstract class MetricsService {
  abstract incCounter(
    name: MetricName,
    value?: number,
    labels?: MetricLabels,
  ): void;

  abstract setGauge(
    name: MetricName,
    value: number,
    labels?: MetricLabels,
  ): void;

  abstract observeHistogram(
    name: MetricName,
    value: number,
    labels?: MetricLabels,
  ): void;

  /**
   * Start a timer; the returned function stops it and observes the elapsed
   * seconds into the named histogram. Safe to ignore the return value.
   */
  abstract startTimer(
    name: MetricName,
    labels?: MetricLabels,
  ): (extraLabels?: MetricLabels) => number;

  /** Render the full (aggregated) registry in Prometheus exposition format. */
  abstract render(): Promise<string>;

  /** Content-type header value for the exposition format. */
  abstract get contentType(): string;
}

// ── Read-side (dashboard) contract ──────────────────────────────────────────

export interface MetricsSnapshotView {
  readonly id: string;
  readonly scope: MetricScope;
  readonly guildId: string | null;
  readonly capturedAt: Date;
  readonly values: Readonly<Record<string, number>>;
}

export interface PaginatedResult<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface MetricsRangeQuery {
  readonly scope: MetricScope;
  readonly guildId?: string | null; // null = global
  readonly from: Date;
  readonly to: Date;
  readonly page: number;
  readonly pageSize: number;
}

/** Read-side facade for the dashboard (historical rollups). */
export abstract class MetricsSnapshotService {
  abstract latest(
    scope: MetricScope,
    guildId?: string | null,
  ): Promise<MetricsSnapshotView | null>;
  abstract range(
    query: MetricsRangeQuery,
  ): Promise<PaginatedResult<MetricsSnapshotView>>;
}
