# Metrics Module

> Spec: [docs/modules/metrics.md](../../../docs/modules/metrics.md) — roadmap item 16 (Phase 4).

The observability backbone. It instruments the whole platform, exposes a
hardened Prometheus exporter, wires OpenTelemetry tracing, evaluates alerting
thresholds, and persists low-frequency snapshots for the dashboard's historical
charts. It never blocks the hot path and never leaks high-cardinality or
sensitive data.

## Public API

```ts
import {
  MetricsService, // recording facade (inject anywhere)
  MetricsSnapshotService, // read-side rollups (dashboard)
  MetricName, // canonical metric names — no magic strings
  MetricsEvents, // emitted event names
  MetricsClaims, // metrics.view / metrics.manage / metrics.scrape
  createPrismaMetricsExtension, // opt-in query-timing extension
  type MetricLabels,
  type MetricScope,
} from '../metrics';
```

Everything else (registry, collectors, repositories, queue, worker, guard) is
module-private. `MetricsService` is the ONLY sanctioned way to record — no other
code should import `prom-client` directly.

### Recording (never awaits, never throws on the hot path)

```ts
constructor(private readonly metrics: MetricsService) {}

this.metrics.incCounter(MetricName.CommandsTotal, 1, {
  module: 'levels', command: 'rank', status: 'success',
});
const stop = this.metrics.startTimer(MetricName.CommandDurationSeconds, { module, command, status });
// ... do work ...
stop();
```

Label keys are a **closed set** per metric (see `domain/metric-definition.ts`).
Any stray/forbidden label key (user id, guild id, raw path, free text) is
dropped by the facade and rejected structurally at registration — cardinality
safety is enforced, not merely advised.

## How metrics are derived

```
Domain events on the Event Bus          (never a direct service call)
  api.request.completed ─┐
  scheduler.job.* ───────┤
  command.executed ──────┤─▶ MetricsEventConsumer ─▶ MetricsService.record(...)
  gateway.heartbeat ─────┤                              │
  cache.access ──────────┘                              ▼
                                             shared prom-client Registry
  collectDefaultMetrics() + collect() pull callbacks ───┘  (CPU/RSS/loop-lag/cache)
                                                          │
                          GET /metrics (guarded) ◀────────┘  aggregated exposition
```

`MetricsRegistry.render()` merges this module's registry with prom-client's
default registry (and any attached module-private registries) so a single scrape
returns every family.

## Endpoints

| Method + Path                                 | Access                              | Notes                                        |
| --------------------------------------------- | ----------------------------------- | -------------------------------------------- |
| `GET /metrics`                                | bearer token **or** CIDR allow-list | Excluded from Swagger; degrades gracefully.  |
| `GET /api/v1/metrics/snapshots/:scope/latest` | `metrics.view`                      | Latest rollup (cached).                      |
| `GET /api/v1/metrics/snapshots/:scope`        | `metrics.view`                      | Time-range, paginated.                       |
| `GET /api/v1/metrics/thresholds`              | `metrics.view`                      | Effective thresholds (defaults + overrides). |
| `PUT /api/v1/metrics/thresholds/:metric`      | `metrics.manage`                    | Guild-scoped override.                       |

## Events

Emits `metrics.threshold.breached` (per tripped threshold) and
`metrics.snapshot.created` (per persisted rollup). Consumes the source events
listed above — see `events/metrics.events.ts` and
`core/events/registry/payloads/metrics.payloads.ts`.

## Tracing

`tracing.ts` bootstraps the OpenTelemetry Node SDK (OTLP HTTP exporter,
auto-instrumentations, config-driven sampler). It is started from
`src/instrument.ts` — the **first import in `main.ts`** — so instrumented
libraries are patched before they load. No-op when disabled in config.

## Snapshots & retention

A recurring BullMQ job (`metrics.snapshot`) captures per-scope global rollups on
the configured cron and prunes them in two stages (soft-delete past
`retentionDays`, hard-delete past a grace window). Prometheus remains the source
of truth for live data; the DB holds rollups only.

## Configuration

ENV → DB → Zod defaults (`config/metrics.config.ts`). Key vars:
`METRICS_ENABLED`, `METRICS_ENDPOINT_BEARER_TOKEN`,
`METRICS_ENDPOINT_ALLOWLIST_CIDRS`, `METRICS_COLLECT_INTERVAL_MS`,
`METRICS_TRACING_OTLP_ENDPOINT`, `METRICS_TRACING_SAMPLE_RATIO`,
`METRICS_SNAPSHOT_CRON`, `METRICS_SNAPSHOT_RETENTION_DAYS`.

## Prisma query timing (opt-in)

`createPrismaMetricsExtension(metrics)` returns a passive `$extends` query hook
recording `ghost_db_query_duration_seconds{model,action}`. Apply it at client
construction to enable DB timing without touching the database core.

## Grafana

Dashboards + Prometheus alert rules ship under
[`infra/grafana/`](../../../infra/grafana/).
