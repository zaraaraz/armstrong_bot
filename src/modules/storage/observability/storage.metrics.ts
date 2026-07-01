import { Injectable } from '@nestjs/common';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  type Registry as PromRegistry,
} from 'prom-client';

/**
 * Prometheus metrics for the Storage module. Uses a dedicated registry so the
 * module is self-contained and testable; `registry` can be merged into a global
 * one by the Metrics module (item 16) when it lands.
 */
@Injectable()
export class StorageMetrics {
  readonly registry: PromRegistry = new Registry();

  private readonly objectsTotal = new Counter({
    name: 'storage_objects_total',
    help: 'Total storage object operations by namespace and result.',
    labelNames: ['namespace', 'result'] as const,
    registers: [this.registry],
  });

  private readonly putBytes = new Histogram({
    name: 'storage_put_bytes',
    help: 'Size in bytes of objects accepted by put, by namespace.',
    labelNames: ['namespace'] as const,
    buckets: [
      1024, 16384, 65536, 262144, 1048576, 5242880, 26214400, 104857600,
      524288000,
    ],
    registers: [this.registry],
  });

  private readonly usedBytes = new Gauge({
    name: 'storage_used_bytes',
    help: 'Current total bytes stored across all guilds.',
    registers: [this.registry],
  });

  recordStore(namespace: string, deduped: boolean, size: number): void {
    this.objectsTotal.inc({
      namespace,
      result: deduped ? 'deduped' : 'stored',
    });
    this.putBytes.observe({ namespace }, size);
  }

  recordDelete(namespace: string): void {
    this.objectsTotal.inc({ namespace, result: 'deleted' });
  }

  setUsedBytes(value: number): void {
    this.usedBytes.set(value);
  }

  async snapshot(): Promise<string> {
    return this.registry.metrics();
  }
}
