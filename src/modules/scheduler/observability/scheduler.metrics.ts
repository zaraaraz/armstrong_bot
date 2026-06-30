import { Injectable } from '@nestjs/common';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  type Registry as PromRegistry,
} from 'prom-client';

/**
 * Prometheus metrics for the Scheduler. Uses a dedicated registry so the module
 * is self-contained and testable; `registry` can be merged into a global one by
 * the Metrics module (item 16) when it lands.
 */
@Injectable()
export class SchedulerMetrics {
  readonly registry: PromRegistry = new Registry();

  private readonly jobsTotal = new Counter({
    name: 'scheduler_jobs_total',
    help: 'Total scheduler job executions by kind and terminal status.',
    labelNames: ['kind', 'status'] as const,
    registers: [this.registry],
  });

  private readonly runDuration = new Histogram({
    name: 'scheduler_run_duration_ms',
    help: 'Scheduler job execution duration in milliseconds.',
    labelNames: ['kind'] as const,
    buckets: [5, 25, 100, 250, 1000, 5000, 30000, 120000],
    registers: [this.registry],
  });

  private readonly queueDepth = new Gauge({
    name: 'scheduler_queue_depth',
    help: 'Current number of waiting + delayed jobs in the scheduler queue.',
    registers: [this.registry],
  });

  private readonly dlqSize = new Gauge({
    name: 'scheduler_dlq_size',
    help: 'Current number of dead-lettered scheduler jobs.',
    registers: [this.registry],
  });

  private readonly reconcileDrift = new Counter({
    name: 'scheduler_reconcile_drift_total',
    help: 'Total drift corrections applied by the reconciler.',
    labelNames: ['type'] as const,
    registers: [this.registry],
  });

  recordRun(kind: string, status: string, durationMs: number): void {
    this.jobsTotal.inc({ kind, status });
    this.runDuration.observe({ kind }, durationMs);
  }

  setQueueDepth(value: number): void {
    this.queueDepth.set(value);
  }

  setDlqSize(value: number): void {
    this.dlqSize.set(value);
  }

  recordDrift(type: 'added' | 'removed' | 'corrected', count = 1): void {
    this.reconcileDrift.inc({ type }, count);
  }

  async snapshot(): Promise<string> {
    return this.registry.metrics();
  }
}
