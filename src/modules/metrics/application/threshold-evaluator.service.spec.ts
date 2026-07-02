import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThresholdEvaluatorService } from './threshold-evaluator.service';
import type { MetricsConfigService } from '../config/metrics-config.service';
import type { MetricsThresholdRepository } from '../infrastructure/repositories/metrics-threshold.repository';
import type { MetricsEventEmitter } from '../events/metrics-event.emitter';
import type { Threshold } from '../domain/threshold';

function makeConfig(thresholds: Threshold[]): MetricsConfigService {
  return {
    global: () => ({ thresholds }),
  } as unknown as MetricsConfigService;
}

describe('ThresholdEvaluatorService', () => {
  let emitter: { emitThresholdBreached: ReturnType<typeof vi.fn> };
  let repo: { findEnabledForGuild: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    emitter = { emitThresholdBreached: vi.fn().mockResolvedValue(undefined) };
    repo = { findEnabledForGuild: vi.fn().mockResolvedValue([]) };
  });

  function build(thresholds: Threshold[]): ThresholdEvaluatorService {
    return new ThresholdEvaluatorService(
      makeConfig(thresholds),
      repo as unknown as MetricsThresholdRepository,
      emitter as unknown as MetricsEventEmitter,
    );
  }

  it('emits a breach when a global default trips', async () => {
    const svc = build([
      {
        metric: 'ghost_event_loop_lag_seconds',
        comparator: 'gt',
        value: 0.2,
        severity: 'critical',
      },
    ]);
    await svc.evaluate('ghost_event_loop_lag_seconds', 0.3, null);
    expect(emitter.emitThresholdBreached).toHaveBeenCalledTimes(1);
    const payload = emitter.emitThresholdBreached.mock.calls[0][0];
    expect(payload.severity).toBe('critical');
    expect(payload.comparator).toBe('gt');
    expect(payload.value).toBe(0.3);
    expect(payload.scope).toBe('system');
  });

  it('does not emit when the value is within bounds', async () => {
    const svc = build([
      {
        metric: 'ghost_event_loop_lag_seconds',
        comparator: 'gt',
        value: 0.2,
        severity: 'critical',
      },
    ]);
    await svc.evaluate('ghost_event_loop_lag_seconds', 0.1, null);
    expect(emitter.emitThresholdBreached).not.toHaveBeenCalled();
  });

  it('lets an enabled guild override replace the default for that metric', async () => {
    repo.findEnabledForGuild.mockResolvedValue([
      {
        metric: 'ghost_event_loop_lag_seconds',
        comparator: 'gt',
        value: 0.5,
        severity: 'warning',
        guildScoped: true,
      },
    ]);
    const svc = build([
      {
        metric: 'ghost_event_loop_lag_seconds',
        comparator: 'gt',
        value: 0.2,
        severity: 'critical',
      },
    ]);
    // 0.3 breaches the default (0.2) but NOT the override (0.5)
    await svc.evaluate('ghost_event_loop_lag_seconds', 0.3, 'guild-1');
    expect(emitter.emitThresholdBreached).not.toHaveBeenCalled();
  });

  it('allEffective marks source as default vs override', async () => {
    repo.findEnabledForGuild.mockResolvedValue([
      {
        metric: 'ghost_queue_dlq_depth',
        comparator: 'gt',
        value: 5,
        severity: 'warning',
        guildScoped: true,
      },
    ]);
    const svc = build([
      {
        metric: 'ghost_event_loop_lag_seconds',
        comparator: 'gt',
        value: 0.2,
        severity: 'critical',
      },
      {
        metric: 'ghost_queue_dlq_depth',
        comparator: 'gt',
        value: 0,
        severity: 'warning',
      },
    ]);
    const eff = await svc.allEffective('guild-1');
    const dlq = eff.find((t) => t.metric === 'ghost_queue_dlq_depth');
    const lag = eff.find((t) => t.metric === 'ghost_event_loop_lag_seconds');
    expect(dlq?.source).toBe('override');
    expect(dlq?.value).toBe(5);
    expect(lag?.source).toBe('default');
  });

  it('swallows repository errors instead of throwing to the caller', async () => {
    repo.findEnabledForGuild.mockRejectedValue(new Error('db down'));
    const svc = build([
      {
        metric: 'ghost_event_loop_lag_seconds',
        comparator: 'gt',
        value: 0.2,
        severity: 'critical',
      },
    ]);
    await expect(
      svc.evaluate('ghost_event_loop_lag_seconds', 0.3, 'guild-1'),
    ).resolves.toBeUndefined();
    expect(emitter.emitThresholdBreached).not.toHaveBeenCalled();
  });
});
