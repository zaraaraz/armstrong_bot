import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';

/**
 * Module-private Prometheus registry (same pattern as scheduler/storage);
 * the Metrics module (roadmap item 16) will absorb these registries into a
 * single exporter without changing callers.
 */
@Injectable()
export class AuditMetrics {
  readonly registry = new Registry();

  private readonly ingested = new Counter({
    name: 'audit_ingest_total',
    help: 'Audit ingest outcomes (persisted, deduped, skipped, dropped, failed).',
    labelNames: ['result'] as const,
    registers: [this.registry],
  });

  private readonly persistDuration = new Histogram({
    name: 'audit_persist_duration_ms',
    help: 'Time to chain-hash and persist one audit entry.',
    buckets: [1, 5, 25, 100, 250, 1000, 5000],
    registers: [this.registry],
  });

  private readonly verifications = new Counter({
    name: 'audit_chain_verify_total',
    help: 'Chain verification runs by result (valid, broken).',
    labelNames: ['result'] as const,
    registers: [this.registry],
  });

  private readonly exports = new Counter({
    name: 'audit_export_total',
    help: 'Audit exports by format.',
    labelNames: ['format'] as const,
    registers: [this.registry],
  });

  private readonly retentionPruned = new Counter({
    name: 'audit_retention_pruned_total',
    help: 'Entries pruned by the retention job after verified archival.',
    registers: [this.registry],
  });

  private readonly queueDepth = new Gauge({
    name: 'audit_queue_depth',
    help: 'Waiting + delayed jobs in the audit.ingest queue.',
    registers: [this.registry],
  });

  recordIngest(
    result: 'persisted' | 'deduped' | 'skipped' | 'dropped' | 'failed',
  ): void {
    this.ingested.inc({ result });
  }

  observePersist(durationMs: number): void {
    this.persistDuration.observe(durationMs);
  }

  recordVerification(valid: boolean): void {
    this.verifications.inc({ result: valid ? 'valid' : 'broken' });
  }

  recordExport(format: string): void {
    this.exports.inc({ format });
  }

  recordPruned(count: number): void {
    this.retentionPruned.inc(count);
  }

  setQueueDepth(value: number): void {
    this.queueDepth.set(value);
  }

  async snapshot(): Promise<string> {
    return this.registry.metrics();
  }
}
