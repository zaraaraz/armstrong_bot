import { beforeEach, describe, expect, it } from 'vitest';
import { MetricsServiceImpl } from './metrics.service';
import { MetricsRegistry } from '../infrastructure/metrics.registry';
import { MetricName } from '../domain/metric-name.enum';

describe('MetricsServiceImpl', () => {
  let registry: MetricsRegistry;
  let service: MetricsServiceImpl;

  beforeEach(() => {
    registry = new MetricsRegistry();
    service = new MetricsServiceImpl(registry);
  });

  it('registers and increments a counter, visible in exposition', async () => {
    service.incCounter(MetricName.CommandsTotal, 1, {
      module: 'levels',
      command: 'rank',
      status: 'success',
    });
    const out = await service.render();
    expect(out).toContain('ghost_commands_total');
    expect(out).toContain('module="levels"');
    expect(out).toContain('command="rank"');
  });

  it('sets a gauge value', async () => {
    service.setGauge(MetricName.QueueDepth, 7, { queue: 'audit.ingest' });
    const out = await service.render();
    expect(out).toMatch(/ghost_queue_depth\{queue="audit\.ingest"\}\s+7/);
  });

  it('startTimer observes elapsed seconds into a histogram', async () => {
    const stop = service.startTimer(MetricName.CommandDurationSeconds, {
      module: 'm',
      command: 'c',
      status: 'success',
    });
    const elapsed = stop();
    expect(elapsed).toBeGreaterThanOrEqual(0);
    const out = await service.render();
    expect(out).toContain('ghost_command_duration_seconds_bucket');
    expect(out).toContain('ghost_command_duration_seconds_count');
  });

  it('drops stray label keys instead of widening cardinality', async () => {
    service.incCounter(MetricName.ModuleEventsTotal, 1, {
      module: 'levels',
      // not declared on this metric — must be silently dropped
      user_id: '123456',
    });
    const out = await service.render();
    expect(out).toContain('ghost_module_events_total');
    expect(out).not.toContain('user_id');
  });

  it('never throws on NaN/Infinity input', () => {
    expect(() =>
      service.setGauge(MetricName.CacheHitRatio, Number.NaN),
    ).not.toThrow();
    expect(() =>
      service.observeHistogram(MetricName.GatewayLatencySeconds, Infinity, {
        shard: '0',
      }),
    ).not.toThrow();
  });

  it('exposes the Prometheus content type', () => {
    expect(service.contentType).toContain('text/plain');
    expect(service.contentType).toContain('version=0.0.4');
  });

  it('throws if a metric is used with the wrong instrument type', () => {
    // CommandsTotal is a counter; asking the registry for a gauge must fail.
    expect(() => registry.gauge(MetricName.CommandsTotal)).toThrow();
  });
});
