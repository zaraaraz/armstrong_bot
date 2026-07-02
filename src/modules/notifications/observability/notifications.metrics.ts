import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import type { NotificationChannel } from '../notifications.public';

/**
 * Module-private Prometheus registry (same pattern as audit/scheduler/storage).
 * The Metrics module (item 16) can absorb this registry into its exporter via
 * its `attach()` seam without changing callers here.
 */
@Injectable()
export class NotificationsMetrics {
  readonly registry = new Registry();

  private readonly dispatched = new Counter({
    name: 'notifications_dispatched_total',
    help: 'Notifications dispatched, by channel and category.',
    labelNames: ['channel', 'category'] as const,
    registers: [this.registry],
  });

  private readonly deliveryLatency = new Histogram({
    name: 'notifications_delivery_latency_ms',
    help: 'Provider send latency in milliseconds, by channel.',
    labelNames: ['channel'] as const,
    buckets: [5, 25, 100, 250, 500, 1000, 2500, 5000, 10000],
    registers: [this.registry],
  });

  private readonly failed = new Counter({
    name: 'notifications_failed_total',
    help: 'Failed delivery attempts, by channel and coarse reason.',
    labelNames: ['channel', 'reason'] as const,
    registers: [this.registry],
  });

  private readonly dlq = new Counter({
    name: 'notifications_dlq_total',
    help: 'Deliveries dead-lettered after exhausting retries.',
    labelNames: ['channel'] as const,
    registers: [this.registry],
  });

  private readonly providerHealth = new Gauge({
    name: 'notifications_provider_health',
    help: 'Provider health probe (1 healthy, 0 unhealthy), by channel.',
    labelNames: ['channel'] as const,
    registers: [this.registry],
  });

  private readonly queueDepth = new Gauge({
    name: 'notifications_delivery_queue_depth',
    help: 'Waiting + delayed jobs in the notifications.delivery queue.',
    registers: [this.registry],
  });

  recordDispatch(channel: NotificationChannel, category: string): void {
    this.dispatched.inc({ channel, category });
  }

  observeLatency(channel: NotificationChannel, latencyMs: number): void {
    this.deliveryLatency.observe({ channel }, latencyMs);
  }

  recordFailure(channel: NotificationChannel, reason: string): void {
    this.failed.inc({ channel, reason });
  }

  recordDlq(channel: NotificationChannel): void {
    this.dlq.inc({ channel });
  }

  setProviderHealth(channel: NotificationChannel, healthy: boolean): void {
    this.providerHealth.set({ channel }, healthy ? 1 : 0);
  }

  setQueueDepth(value: number): void {
    this.queueDepth.set(value);
  }

  async snapshot(): Promise<string> {
    return this.registry.metrics();
  }
}
