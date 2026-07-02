import { describe, expect, it } from 'vitest';
import { resolveMetricsConfig, metricsConfigSchema } from './metrics.config';

describe('resolveMetricsConfig', () => {
  it('applies spec defaults with an empty environment', () => {
    const cfg = resolveMetricsConfig({});
    expect(cfg.enabled).toBe(true);
    expect(cfg.endpointPath).toBe('/metrics');
    expect(cfg.endpointBearerToken).toBeUndefined();
    expect(cfg.endpointAllowlistCidrs).toEqual(['127.0.0.1/32', '::1/128']);
    expect(cfg.collectIntervalMs).toBe(10_000);
    expect(cfg.histogramBucketsSeconds).toContain(0.1);
    expect(cfg.tracing.enabled).toBe(true);
    expect(cfg.tracing.sampleRatio).toBe(0.1);
    expect(cfg.snapshot.cron).toBe('*/1 * * * *');
    expect(cfg.snapshot.retentionDays).toBe(30);
    expect(cfg.thresholds).toHaveLength(2);
  });

  it('reads METRICS_* env overrides including csv and numbers', () => {
    const cfg = resolveMetricsConfig({
      METRICS_ENABLED: 'false',
      METRICS_ENDPOINT_PATH: '/internal/metrics',
      METRICS_ENDPOINT_BEARER_TOKEN: 'a-very-long-bearer-token-value',
      METRICS_ENDPOINT_ALLOWLIST_CIDRS: '10.0.0.0/8, 192.168.1.0/24',
      METRICS_COLLECT_INTERVAL_MS: '5000',
      METRICS_HISTOGRAM_BUCKETS_SECONDS: '0.1,0.5,1',
      METRICS_TRACING_SAMPLE_RATIO: '0.5',
      METRICS_SNAPSHOT_RETENTION_DAYS: '90',
    });
    expect(cfg.enabled).toBe(false);
    expect(cfg.endpointPath).toBe('/internal/metrics');
    expect(cfg.endpointBearerToken).toBe('a-very-long-bearer-token-value');
    expect(cfg.endpointAllowlistCidrs).toEqual([
      '10.0.0.0/8',
      '192.168.1.0/24',
    ]);
    expect(cfg.collectIntervalMs).toBe(5000);
    expect(cfg.histogramBucketsSeconds).toEqual([0.1, 0.5, 1]);
    expect(cfg.tracing.sampleRatio).toBe(0.5);
    expect(cfg.snapshot.retentionDays).toBe(90);
  });

  it('rejects a too-short bearer token', () => {
    expect(() =>
      resolveMetricsConfig({ METRICS_ENDPOINT_BEARER_TOKEN: 'short' }),
    ).toThrow();
  });

  it('rejects an out-of-range sample ratio', () => {
    expect(() =>
      metricsConfigSchema.parse({ tracing: { sampleRatio: 2 } }),
    ).toThrow();
  });

  it('rejects a collect interval below the floor', () => {
    expect(() =>
      resolveMetricsConfig({ METRICS_COLLECT_INTERVAL_MS: '500' }),
    ).toThrow();
  });

  it('rejects an endpoint path without a leading slash', () => {
    expect(() =>
      resolveMetricsConfig({ METRICS_ENDPOINT_PATH: 'metrics' }),
    ).toThrow();
  });
});
