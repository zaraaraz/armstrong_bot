import { beforeEach, describe, expect, it } from 'vitest';
import { MetricsSnapshotBuilder } from './metrics-snapshot.builder';
import { MetricsServiceImpl } from './metrics.service';
import { MetricsRegistry } from '../infrastructure/metrics.registry';
import { MetricName } from '../domain/metric-name.enum';

describe('MetricsSnapshotBuilder', () => {
  let registry: MetricsRegistry;
  let service: MetricsServiceImpl;
  let builder: MetricsSnapshotBuilder;

  beforeEach(() => {
    registry = new MetricsRegistry();
    service = new MetricsServiceImpl(registry);
    builder = new MetricsSnapshotBuilder(registry);
  });

  it('groups recorded metrics into their scopes', async () => {
    service.incCounter(MetricName.CommandsTotal, 3, {
      module: 'm',
      command: 'c',
      status: 'success',
    });
    service.setGauge(MetricName.QueueDepth, 4, { queue: 'q' });

    const scopes = await builder.buildAll();
    const commands = scopes.find((s) => s.scope === 'commands');
    const queue = scopes.find((s) => s.scope === 'queue');

    expect(commands?.values[MetricName.CommandsTotal]).toBe(3);
    expect(queue?.values[MetricName.QueueDepth]).toBe(4);
  });

  it('omits scopes with no recorded data', async () => {
    service.incCounter(MetricName.CommandsTotal, 1, {
      module: 'm',
      command: 'c',
      status: 'success',
    });
    const scopes = await builder.buildAll();
    // gateway has nothing recorded -> should not appear
    expect(scopes.find((s) => s.scope === 'gateway')).toBeUndefined();
  });

  it('sums across label series for a counter', async () => {
    service.incCounter(MetricName.CommandsTotal, 2, {
      module: 'a',
      command: 'x',
      status: 'success',
    });
    service.incCounter(MetricName.CommandsTotal, 5, {
      module: 'b',
      command: 'y',
      status: 'error',
    });
    const scopes = await builder.buildAll();
    const commands = scopes.find((s) => s.scope === 'commands');
    expect(commands?.values[MetricName.CommandsTotal]).toBe(7);
  });
});
