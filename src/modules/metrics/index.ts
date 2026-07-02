// Module class
export { MetricsModule } from './metrics.module';

// Public recording + read facades (abstract tokens bound in metrics.module.ts)
export {
  MetricsService,
  MetricsSnapshotService,
} from './application/metrics.service.contract';
export type {
  MetricLabels,
  MetricsSnapshotView,
  MetricsRangeQuery,
  PaginatedResult,
} from './application/metrics.service.contract';

// Canonical metric names + scope (no magic strings for callers)
export { MetricName } from './domain/metric-name.enum';
export type { MetricScope } from './domain/metric-scope';

// Prisma query-timing extension factory (opt-in wiring at client construction)
export { createPrismaMetricsExtension } from './infrastructure/prisma-metrics.extension';

// Event names & payload types
export { MetricsEvents, type MetricsEventName } from './events/metrics.events';
export type {
  MetricThresholdBreachedPayload,
  MetricSnapshotCreatedPayload,
} from '../../core/events/registry/payloads/metrics.payloads';

// Claims (for guards in other surfaces, e.g. the dashboard BFF)
export { MetricsClaims } from './metrics.constants';
