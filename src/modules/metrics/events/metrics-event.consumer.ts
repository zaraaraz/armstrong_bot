import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventBus, type Subscription } from '../../../core/events/event-bus';
import type { EventEnvelope } from '../../../core/events/envelope/event-envelope';
import type { EventName } from '../../../core/events/registry/event-map';
import { MetricsService } from '../application/metrics.service.contract';
import { ThresholdEvaluatorService } from '../application/threshold-evaluator.service';
import { MetricName } from '../domain/metric-name.enum';
import { METRICS_HANDLER_PREFIX } from '../metrics.constants';
import { ConsumedEvents } from './metrics.events';

const SHARD_STATE: Record<string, number> = {
  disconnected: 0,
  idle: 1,
  reconnecting: 2,
  ready: 3,
};

/**
 * Translates domain events on the bus into metric register mutations. Every
 * handler is synchronous and fire-and-forget: recording a metric never awaits
 * and never throws back onto the bus (the facade swallows bad input). It never
 * calls another module's service — it only reads the typed event payloads.
 */
@Injectable()
export class MetricsEventConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly subs: Subscription[] = [];

  constructor(
    private readonly bus: EventBus,
    private readonly metrics: MetricsService,
    private readonly thresholds: ThresholdEvaluatorService,
  ) {}

  onModuleInit(): void {
    this.on(ConsumedEvents.CommandExecuted, (env) => {
      const p = env.payload as {
        module: string;
        command: string;
        durationMs: number;
        success: boolean;
      };
      const status = p.success ? 'success' : 'error';
      this.metrics.incCounter(MetricName.CommandsTotal, 1, {
        module: p.module,
        command: p.command,
        status,
      });
      this.metrics.observeHistogram(
        MetricName.CommandDurationSeconds,
        p.durationMs / 1000,
        { module: p.module, command: p.command, status },
      );
    });

    this.on(ConsumedEvents.GatewayHeartbeat, (env) => {
      const p = env.payload as {
        shardId: number;
        latencyMs: number;
        status: string;
      };
      const shard = String(p.shardId);
      this.metrics.observeHistogram(
        MetricName.GatewayLatencySeconds,
        p.latencyMs / 1000,
        { shard },
      );
      this.metrics.setGauge(
        MetricName.GatewayShardState,
        SHARD_STATE[p.status] ?? 0,
        { shard },
      );
      void this.thresholds.evaluate(
        MetricName.GatewayLatencySeconds,
        p.latencyMs / 1000,
        null,
      );
    });

    this.on(ConsumedEvents.GatewayReconnect, (env) => {
      const p = env.payload as { shardId: number };
      this.metrics.incCounter(MetricName.GatewayReconnectsTotal, 1, {
        shard: String(p.shardId),
      });
    });

    this.on(ConsumedEvents.DiscordRateLimit, (env) => {
      const p = env.payload as { global: boolean };
      this.metrics.incCounter(MetricName.DiscordRateLimitTotal, 1, {
        global: p.global ? 'true' : 'false',
      });
    });

    this.on(ConsumedEvents.CacheAccess, (env) => {
      const p = env.payload as { result: string };
      this.metrics.incCounter(MetricName.CacheOpsTotal, 1, {
        result: p.result,
      });
    });

    this.on(ConsumedEvents.ModuleEvent, (env) => {
      const p = env.payload as { module: string };
      this.metrics.incCounter(MetricName.ModuleEventsTotal, 1, {
        module: p.module,
      });
    });

    // Pre-existing platform events (owned by other units) — read, never call.
    this.on(ConsumedEvents.ApiRequestCompleted, (env) => {
      const p = env.payload as {
        method: string;
        path: string;
        status: number;
        durationMs: number;
      };
      const labels = {
        method: p.method,
        route: this.routeTemplate(p.path),
        status_class: `${Math.floor(p.status / 100)}xx`,
      };
      this.metrics.incCounter(MetricName.HttpRequestsTotal, 1, labels);
      this.metrics.observeHistogram(
        MetricName.HttpRequestDurationSeconds,
        p.durationMs / 1000,
        labels,
      );
    });

    for (const name of [
      ConsumedEvents.SchedulerJobCompleted,
      ConsumedEvents.SchedulerJobFailed,
      ConsumedEvents.SchedulerJobDeadLettered,
    ] as const) {
      this.on(name, (env) => this.recordJob(env));
    }
  }

  onModuleDestroy(): void {
    for (const sub of this.subs) sub.unsubscribe();
    this.subs.length = 0;
  }

  private recordJob(env: EventEnvelope): void {
    const p = env.payload as {
      kind?: string;
      status?: string;
    };
    const queue = p.kind ?? 'unknown';
    const state = this.jobState(env.name, p.status);
    this.metrics.incCounter(MetricName.JobsTotal, 1, { queue, state });
  }

  private jobState(eventName: string, status?: string): string {
    if (eventName.endsWith('dead_lettered')) return 'dead_lettered';
    if (eventName.endsWith('failed')) return 'failed';
    if (eventName.endsWith('completed')) return 'completed';
    return status ?? 'unknown';
  }

  /**
   * Collapse a concrete request path into a low-cardinality template so IDs
   * never become label values (e.g. /api/v1/guilds/123 -> /api/v1/guilds/:id).
   */
  private routeTemplate(path: string): string {
    return path
      .split('?')[0]
      .split('/')
      .map((seg) =>
        /^[0-9]+$/.test(seg) || /^[0-9a-f]{8,}$/i.test(seg) ? ':id' : seg,
      )
      .join('/');
  }

  private on(name: string, handler: (env: EventEnvelope) => void): void {
    const sub = this.bus.subscribe(name as EventName, (env) => handler(env), {
      handlerId: `${METRICS_HANDLER_PREFIX}:${name}`,
    });
    this.subs.push(sub);
  }
}
