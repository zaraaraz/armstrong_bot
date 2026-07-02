/** BullMQ queue name owned exclusively by the Metrics module. */
export const METRICS_QUEUE = 'metrics.snapshot';

/** BullMQ job names on {@link METRICS_QUEUE}. */
export const METRICS_SNAPSHOT_JOB = 'snapshot';
export const METRICS_RETENTION_JOB = 'retention';

/** handlerId prefix used when subscribing to the core Event Bus. */
export const METRICS_HANDLER_PREFIX = 'metrics';

/** Cache key parts under CacheNamespace.Generic. */
export const METRICS_CACHE_PREFIX = 'metrics';

/** Claims defined by this module (wildcard-compatible: metrics.*). */
export const MetricsClaims = {
  View: 'metrics.view',
  Manage: 'metrics.manage',
  Scrape: 'metrics.scrape',
} as const;

export type MetricsClaim = (typeof MetricsClaims)[keyof typeof MetricsClaims];

/** Content-type Prometheus expects for the text exposition format. */
export const PROMETHEUS_CONTENT_TYPE =
  'text/plain; version=0.0.4; charset=utf-8';
