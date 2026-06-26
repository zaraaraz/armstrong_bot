# Metrics Module

> ## Claude Instructions
> - Never modify another module. Do not change architecture decisions from `00-project.md`.
> - Keep backwards compatibility. Create Prisma migrations. Generate tests and docs.
> - Generate DTOs. Use the Repository Pattern. Use the Event Bus. Use Dependency Injection.
> - No `any`. Keep methods small (<50 lines where reasonable). Follow existing naming.
> - Create indexes for searchable fields. Support pagination, caching, translations, dashboard.
> - This module is an **observability backbone**: it MUST never block the hot path. All metric
>   recording is synchronous in-memory register updates (Prometheus client) and async fire-and-forget
>   for any persisted snapshots. Never `await` a metric write inside a command handler.
> - The `/metrics` HTTP endpoint is a **separate, internal-only** route guarded by an allow-list /
>   bearer token. It is NOT part of the public Swagger API surface and MUST NOT leak guild data labels
>   with high cardinality (no raw user IDs, no message contents).
> - Consume domain events to derive metrics; do NOT call other modules' services directly.

---

## 1. Purpose

The **Metrics Module** is Ghost Bot's observability core. It instruments the entire platform and
exposes a Prometheus-compatible exporter plus OpenTelemetry tracing wiring so operators can answer:

- Is the process healthy? (CPU, RAM, event-loop lag, GC, handles)
- Is Discord healthy? (gateway latency, shard state, reconnects, rate-limit hits)
- Is the API healthy? (request rate, latency histograms, error rate, status codes)
- Are the data stores healthy? (Prisma/MySQL query latency, pool saturation, Redis ops, cache hit ratio)
- Is the background system healthy? (BullMQ queue depth, job durations, failures, DLQ size)
- How are features used? (slash-command invocations, per-module activity, per-guild activity)

It does this without becoming a bottleneck and without leaking high-cardinality or sensitive data.

## 2. Goals

1. Expose a hardened `GET /metrics` endpoint in Prometheus text exposition format.
2. Provide a typed, injectable `MetricsService` so any layer can record counters/gauges/histograms
   through a stable facade (never importing `prom-client` directly outside this module).
3. Auto-instrument cross-cutting concerns via NestJS interceptors/middleware:
   HTTP requests, command execution, repository/query timing, job lifecycle, cache access.
4. Wire OpenTelemetry tracing (OTLP exporter) so spans correlate with metric spikes and with Pino logs
   (shared `trace_id`).
5. Provide alerting hooks: emit `metrics.threshold.breached` events when registered thresholds trip,
   and expose Prometheus-friendly recording/alert rule guidance.
6. Persist periodic **snapshots** (low-frequency, aggregated) for the dashboard's historical charts —
   Prometheus is the source of truth for live data; the DB holds rollups only.
7. Ship described Grafana dashboards (panels + PromQL) as project artifacts.
8. Be fully guild-aware where it matters (command/module usage carry a low-cardinality `guild` label)
   while keeping infra metrics global.

## 3. Architecture

The module follows the strict layer flow and never touches Prisma or Redis outside its repository/cache.

```
                         ┌──────────────────────────────────────────┐
   Discord / HTTP / Jobs │  Interceptors & Middleware (auto-capture)  │
   ──────────────────────┤  HttpMetricsInterceptor                    │
                         │  CommandMetricsInterceptor (Necord)        │
                         │  QueryTimingExtension (Prisma $extends)    │
                         │  JobMetricsListener (BullMQ events)        │
                         └───────────────────┬────────────────────────┘
                                             │ record(...)
                                  ┌──────────▼───────────┐
                                  │     MetricsService    │  (Application facade)
                                  │  counter/gauge/histo  │
                                  └─────┬───────────┬─────┘
            registers metrics in        │           │   reads core systems
                                  ┌──────▼─────┐  ┌──▼──────────────────────┐
                                  │ MetricsReg │  │ SystemCollectorService   │
                                  │ (prom-     │  │ (CPU/RAM/loop lag, pool, │
                                  │  client)   │  │  cache stats, queue depth)│
                                  └──────┬─────┘  └──────────┬───────────────┘
                                         │                   │ pull every N s
                       GET /metrics ─────┘                   │
                                                  consumes core events (EventBus)
                                                             │
                                  ┌──────────────────────────▼──────────────┐
                                  │ ThresholdEvaluatorService                │
                                  │  -> emits metrics.threshold.breached     │
                                  └──────────────────────────────────────────┘
                                  ┌──────────────────────────────────────────┐
                                  │ SnapshotJob (BullMQ recurring)           │
                                  │  -> MetricsSnapshotRepository (Prisma)   │
                                  └──────────────────────────────────────────┘
```

- **`MetricsService`** is the only public surface for recording. It lazily registers metric definitions
  on first use against a single shared `Registry`.
- **`SystemCollectorService`** runs a Prometheus `collectDefaultMetrics()` plus custom collectors that
  pull pool/cache/queue stats on scrape (using prom-client gauge `collect` callbacks).
- **OpenTelemetry** is bootstrapped at process start (`tracing.ts`) before NestJS, registering the OTLP
  trace exporter and HTTP/Prisma/Redis/ioredis auto-instrumentations.
- **Snapshots** are written by a recurring BullMQ job, not on the hot path.

## 4. Folder Structure

```
src/modules/metrics/
├── metrics.module.ts
├── index.ts                          # public API barrel (ONLY exported surface)
├── application/
│   ├── metrics.service.ts            # facade: counter/gauge/histogram/timer
│   ├── system-collector.service.ts   # CPU/RAM/loop-lag/pool/cache/queue collectors
│   ├── threshold-evaluator.service.ts# alert hooks -> emits breach events
│   └── metrics-snapshot.service.ts   # builds + persists rollups
├── domain/
│   ├── metric-definition.ts          # MetricDefinition value objects + catalog
│   ├── threshold.ts                  # Threshold value object
│   └── metric-name.enum.ts           # canonical metric names (no magic strings)
├── infra/
│   ├── metrics.registry.ts           # prom-client Registry provider
│   ├── prisma-metrics.extension.ts   # $extends query timing
│   └── repositories/
│       └── metrics-snapshot.repository.ts
├── interceptors/
│   ├── http-metrics.interceptor.ts
│   └── command-metrics.interceptor.ts
├── listeners/
│   └── job-metrics.listener.ts       # BullMQ queue events
├── api/
│   ├── metrics.controller.ts         # GET /metrics (internal, guarded)
│   └── metrics-admin.controller.ts   # dashboard read endpoints (Swagger)
├── jobs/
│   └── metrics-snapshot.job.ts       # recurring snapshot processor
├── config/
│   └── metrics.config.ts             # Zod schema + defaults
├── dto/
│   ├── metrics-query.dto.ts
│   └── metrics-snapshot.dto.ts
└── tracing.ts                        # OpenTelemetry bootstrap (imported in main bootstrap)
```

## 5. Public Interfaces

The module exposes only the following through `index.ts`. Everything else is internal.

```typescript
/** Canonical, low-cardinality label sets. No user IDs, no free text. */
export interface MetricLabels {
  readonly [label: string]: string | number;
}

/** Stable facade injected anywhere recording is needed. */
export abstract class MetricsService {
  /** Increment a counter (monotonic). Auto-registers on first call. */
  abstract incCounter(name: MetricName, value?: number, labels?: MetricLabels): void;

  /** Set an arbitrary gauge value. */
  abstract setGauge(name: MetricName, value: number, labels?: MetricLabels): void;

  /** Observe a value into a histogram (e.g. latency in seconds). */
  abstract observeHistogram(name: MetricName, value: number, labels?: MetricLabels): void;

  /**
   * Start a timer; the returned function stops it and observes the elapsed
   * seconds into the named histogram. Safe to ignore the return value.
   */
  abstract startTimer(name: MetricName, labels?: MetricLabels): (extraLabels?: MetricLabels) => number;

  /** Render the full registry in Prometheus exposition format. */
  abstract render(): Promise<string>;

  /** Content type header value for the exposition format. */
  abstract get contentType(): string;
}

/** Read-side facade for the dashboard (historical rollups). */
export abstract class MetricsSnapshotService {
  abstract latest(scope: MetricScope): Promise<MetricsSnapshotView | null>;
  abstract range(query: MetricsRangeQuery): Promise<PaginatedResult<MetricsSnapshotView>>;
}

export interface MetricsRangeQuery {
  readonly scope: MetricScope;
  readonly guildId?: string | null; // null = global
  readonly from: Date;
  readonly to: Date;
  readonly page: number;
  readonly pageSize: number;
}

export type MetricScope = 'system' | 'gateway' | 'api' | 'database' | 'cache' | 'queue' | 'commands';

export interface PaginatedResult<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}
```

```typescript
/** Canonical metric names — single source of truth, no magic strings. */
export enum MetricName {
  // System / process
  ProcessCpuSeconds = 'ghost_process_cpu_seconds_total',
  ProcessResidentMemoryBytes = 'ghost_process_resident_memory_bytes',
  EventLoopLagSeconds = 'ghost_event_loop_lag_seconds',
  // Gateway / Discord
  GatewayLatencySeconds = 'ghost_gateway_latency_seconds',
  GatewayShardState = 'ghost_gateway_shard_state',
  GatewayReconnectsTotal = 'ghost_gateway_reconnects_total',
  DiscordRateLimitTotal = 'ghost_discord_rate_limit_total',
  // API
  HttpRequestDurationSeconds = 'ghost_http_request_duration_seconds',
  HttpRequestsTotal = 'ghost_http_requests_total',
  // Database
  DbQueryDurationSeconds = 'ghost_db_query_duration_seconds',
  DbPoolConnections = 'ghost_db_pool_connections',
  // Cache
  CacheOpsTotal = 'ghost_cache_ops_total',
  CacheHitRatio = 'ghost_cache_hit_ratio',
  // Queue / jobs
  JobDurationSeconds = 'ghost_job_duration_seconds',
  JobsTotal = 'ghost_jobs_total',
  QueueDepth = 'ghost_queue_depth',
  QueueDlqDepth = 'ghost_queue_dlq_depth',
  // Commands / modules
  CommandDurationSeconds = 'ghost_command_duration_seconds',
  CommandsTotal = 'ghost_commands_total',
  ModuleEventsTotal = 'ghost_module_events_total',
}
```

```typescript
export interface MetricsSnapshotView {
  readonly id: string;
  readonly scope: MetricScope;
  readonly guildId: string | null;
  readonly capturedAt: Date;
  readonly values: Readonly<Record<string, number>>;
}
```

## 6. Events

This module **consumes** core/domain events to derive metrics and **emits** alerting events.
All payloads are typed; no `any`.

**Consumed** (via the Event Bus — never direct service calls):

```typescript
export interface CommandExecutedEvent {
  readonly module: string;
  readonly command: string;
  readonly guildId: string | null;
  readonly durationMs: number;
  readonly success: boolean;
}

export interface GatewayHeartbeatEvent {
  readonly shardId: number;
  readonly latencyMs: number;
  readonly status: 'ready' | 'reconnecting' | 'idle' | 'disconnected';
}

export interface JobLifecycleEvent {
  readonly queue: string;
  readonly jobName: string;
  readonly state: 'completed' | 'failed' | 'stalled';
  readonly durationMs: number;
}
```

| Event | Direction | Action |
| --- | --- | --- |
| `command.executed` | consume | `incCounter(CommandsTotal)` + `observeHistogram(CommandDurationSeconds)` |
| `gateway.heartbeat` | consume | `observeHistogram(GatewayLatencySeconds)` + `setGauge(GatewayShardState)` |
| `gateway.reconnect` | consume | `incCounter(GatewayReconnectsTotal)` |
| `job.lifecycle` | consume | `incCounter(JobsTotal)` + `observeHistogram(JobDurationSeconds)` |
| `cache.access` | consume | `incCounter(CacheOpsTotal{result})` |
| `module.event` | consume | `incCounter(ModuleEventsTotal)` |

**Emitted**:

```typescript
export interface MetricThresholdBreachedEvent {
  readonly metric: MetricName;
  readonly scope: MetricScope;
  readonly value: number;
  readonly threshold: number;
  readonly comparator: 'gt' | 'lt' | 'gte' | 'lte';
  readonly severity: 'warning' | 'critical';
  readonly guildId: string | null;
  readonly observedAt: Date;
}
```

| Event | Direction | Payload |
| --- | --- | --- |
| `metrics.threshold.breached` | emit | `MetricThresholdBreachedEvent` (consumed by a notifications module via bus) |
| `metrics.snapshot.created` | emit | `{ snapshotId: string; scope: MetricScope; capturedAt: Date }` |

## 7. Dependencies

Relies ONLY on CORE systems, never other modules directly.

| Core system | Usage |
| --- | --- |
| **Events** (Event Bus) | Subscribe to domain events to derive metrics; emit breach/snapshot events. |
| **Cache** | Read cache stats for the `CacheHitRatio` gauge; cache the latest snapshot view (namespaced `metrics:snapshot:*`, short TTL). Never touches Redis directly. |
| **Database** (Prisma via Repository) | Persist + read `MetricSnapshot` rollups only. Query timing extension lives here but is a passive observer. |
| **Queue** (BullMQ) | Recurring snapshot job; reads queue/DLQ depth via the queue service's introspection API. |
| **Permissions** | Guards the admin read endpoints (`metrics.view`) and config writes (`metrics.manage`). |
| **Config** | ENV -> DB -> Defaults priority, Zod-validated. |
| **Logging** (Pino) | Structured logs for scrape errors, threshold breaches, snapshot failures; shares `trace_id` with OTEL. |

## 8. Configuration

Guild-scoped config covers per-guild threshold overrides; everything else is global. All Zod-validated.

```typescript
import { z } from 'zod';

export const metricsConfigSchema = z.object({
  // GLOBAL
  enabled: z.boolean().default(true),
  endpointPath: z.string().startsWith('/').default('/metrics'),
  endpointBearerToken: z.string().min(16).optional(), // if unset, allow-list only
  endpointAllowlistCidrs: z.array(z.string()).default(['127.0.0.1/32', '::1/128']),
  defaultMetricsEnabled: z.boolean().default(true),     // prom-client collectDefaultMetrics
  collectIntervalMs: z.number().int().min(1000).default(10_000),
  histogramBucketsSeconds: z.array(z.number().positive())
    .default([0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]),
  // Tracing
  tracing: z.object({
    enabled: z.boolean().default(true),
    otlpEndpoint: z.string().url().default('http://localhost:4318/v1/traces'),
    sampleRatio: z.number().min(0).max(1).default(0.1),
    serviceName: z.string().default('ghost-bot'),
  }),
  // Snapshots
  snapshot: z.object({
    enabled: z.boolean().default(true),
    cron: z.string().default('*/1 * * * *'),  // every minute
    retentionDays: z.number().int().min(1).default(30),
  }),
  // Alerting thresholds (global defaults; guild overrides allowed)
  thresholds: z.array(z.object({
    metric: z.string(),
    comparator: z.enum(['gt', 'lt', 'gte', 'lte']),
    value: z.number(),
    severity: z.enum(['warning', 'critical']).default('warning'),
  })).default([
    { metric: 'ghost_event_loop_lag_seconds', comparator: 'gt', value: 0.2, severity: 'critical' },
    { metric: 'ghost_queue_dlq_depth', comparator: 'gt', value: 0, severity: 'warning' },
  ]),
});

export type MetricsConfig = z.infer<typeof metricsConfigSchema>;
```

Config priority is resolved by the Config core: `ENV` (e.g. `METRICS_ENDPOINT_BEARER_TOKEN`) overrides
DB-stored guild/global settings, which override the Zod defaults above.

## 9. Database

Prisma holds **rollups only** — Prometheus is the live source of truth. Snapshots are append-only with a
soft-delete flag for retention pruning audit trails. Values are stored as JSON for flexibility per scope.

```prisma
model MetricSnapshot {
  id         String       @id @default(cuid())
  scope      MetricScope
  guildId    String?      // null = global; references Guild when set
  guild      Guild?       @relation(fields: [guildId], references: [id], onDelete: Cascade)
  capturedAt DateTime     @default(now())
  values     Json         // Record<string, number>, validated before write
  createdAt  DateTime     @default(now())
  deletedAt  DateTime?    // soft delete for retention pruning

  @@index([scope, capturedAt])
  @@index([guildId, scope, capturedAt])
  @@index([deletedAt])
  @@map("metric_snapshots")
}

model MetricThresholdOverride {
  id         String       @id @default(cuid())
  guildId    String
  guild      Guild        @relation(fields: [guildId], references: [id], onDelete: Cascade)
  metric     String
  comparator MetricComparator
  value      Float
  severity   MetricSeverity @default(warning)
  enabled    Boolean      @default(true)
  createdAt  DateTime     @default(now())
  updatedAt  DateTime     @updatedAt
  deletedAt  DateTime?

  @@unique([guildId, metric])
  @@index([guildId, enabled])
  @@map("metric_threshold_overrides")
}

enum MetricScope {
  system
  gateway
  api
  database
  cache
  queue
  commands
}

enum MetricComparator { gt lt gte lte }
enum MetricSeverity   { warning critical }
```

Notes: snapshots are pruned (soft-deleted, then hard-deleted after a grace window) by the snapshot job
honoring `snapshot.retentionDays`. Indexes target the dashboard's primary access pattern
(scope + time range, optionally per guild).

## 10. API

Two controllers. The scrape endpoint is **internal and excluded from Swagger**; the admin endpoints are
documented and permission-guarded.

```typescript
// GET /metrics  — Prometheus exposition (NOT in Swagger; guarded by bearer + CIDR allow-list)
@Controller()
@ApiExcludeController()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('metrics')
  @UseGuards(MetricsScrapeGuard) // bearer token + CIDR allow-list
  async scrape(@Res() res: Response): Promise<void> {
    res.setHeader('Content-Type', this.metrics.contentType);
    res.send(await this.metrics.render());
  }
}
```

Admin/dashboard read API (Swagger-documented, under `/api/v1/metrics`):

| Method + Path | DTO | Permission | Notes |
| --- | --- | --- | --- |
| `GET /api/v1/metrics/snapshots/:scope/latest` | -> `MetricsSnapshotDto` | `metrics.view` | Latest rollup; cached. |
| `GET /api/v1/metrics/snapshots/:scope` | `MetricsQueryDto` -> `PaginatedResult<MetricsSnapshotDto>` | `metrics.view` | Time-range, paginated. |
| `GET /api/v1/metrics/thresholds` | -> `ThresholdDto[]` | `metrics.view` | Effective thresholds (defaults + overrides). |
| `PUT /api/v1/metrics/thresholds/:metric` | `UpsertThresholdDto` | `metrics.manage` | Guild-scoped override. |

```typescript
export class MetricsQueryDto {
  @ApiPropertyOptional({ description: 'Guild ID; omit for global scope' })
  @IsOptional() @IsString()
  readonly guildId?: string;

  @ApiProperty({ type: String, format: 'date-time' })
  @IsISO8601()
  readonly from!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  @IsISO8601()
  readonly to!: string;

  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1)
  readonly page: number = 1;

  @ApiPropertyOptional({ default: 50 }) @IsOptional() @IsInt() @Min(1) @Max(200)
  readonly pageSize: number = 50;
}

export class MetricsSnapshotDto {
  @ApiProperty() readonly id!: string;
  @ApiProperty({ enum: ['system','gateway','api','database','cache','queue','commands'] })
  readonly scope!: MetricScope;
  @ApiProperty({ nullable: true }) readonly guildId!: string | null;
  @ApiProperty() readonly capturedAt!: string;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } })
  readonly values!: Record<string, number>;
}
```

## 11. Permissions

Wildcard-compatible claims defined by this module (`metrics.*`):

| Claim | Grants |
| --- | --- |
| `metrics.view` | Read snapshots, latest values, and effective thresholds in the dashboard. |
| `metrics.manage` | Create/update/delete guild threshold overrides; toggle module config. |
| `metrics.scrape` | (Service principal) Access the `/metrics` endpoint via bearer identity. |

Discord-role and group inheritance applies as per the core Permissions system. The `/metrics` HTTP
endpoint additionally requires the CIDR allow-list / bearer guard regardless of claims.

## 12. Logging

Structured Pino logs, categorised, sharing `trace_id` with OpenTelemetry spans:

- `metrics.scrape` — debug: scrape served, byte size, render duration; warn on guard rejection (with source IP).
- `metrics.collector` — error: a custom collector threw (e.g. pool stats unavailable); never crashes scrape.
- `metrics.threshold` — warn/error: breach detected, includes metric, value, threshold, severity, guildId.
- `metrics.snapshot` — info: snapshot persisted (count of series); error: snapshot write failed.
- `metrics.tracing` — info: OTLP exporter init/shutdown.

**Audit hooks**: threshold override create/update/delete writes to the central audit log
(`actor`, `guildId`, `metric`, `before`, `after`). No metric values or labels containing user-identifying
data are ever logged.

## 13. Testing

- **Unit** (Vitest): `MetricsService` registers each `MetricName` with the correct type/buckets/labels;
  `startTimer` observes elapsed seconds; `ThresholdEvaluatorService` emits the correct event per
  comparator/severity; config Zod schema accepts defaults and rejects bad input; snapshot value validation.
- **Integration**: event-bus consumers translate `command.executed`/`gateway.heartbeat`/`job.lifecycle`
  into the right register mutations; `MetricsSnapshotRepository` round-trips a snapshot with soft delete;
  retention pruning respects `retentionDays`.
- **E2E** (Playwright/HTTP): `GET /metrics` returns `200` + `text/plain; version=0.0.4` and contains
  expected metric families; guard returns `401/403` without bearer or off allow-list; admin endpoints
  enforce `metrics.view`/`metrics.manage`; pagination bounds enforced.
- **Coverage musts**: no metric uses an unbounded/high-cardinality label; `/metrics` never throws even if
  a collector fails (degrades gracefully); recording never `await`s on the hot path.

## 14. Dashboard Integration

The dashboard exposes a **Metrics / Observability** section:

- Live tiles (CPU, RAM, event-loop lag, gateway latency, error rate) fed by the admin snapshot API.
- Historical charts per scope with time-range + guild filter (server-side paginated).
- Threshold manager UI: list effective thresholds, edit guild overrides (`metrics.manage`).
- Embedded/linked **Grafana** dashboards (described in section 15) for deep-dive PromQL.
- Breach feed: recent `metrics.threshold.breached` events surfaced via the notifications stream.

## 15. Future Extensions

- Exemplars linking histogram buckets to trace IDs (Prometheus + Tempo correlation).
- Per-guild Prometheus remote-write tenancy for large multi-tenant deployments.
- Anomaly detection job (z-score on snapshots) emitting predictive alerts.
- SLO/error-budget tracking with burn-rate alerts.
- Pluggable exporters (StatsD, OTLP metrics) behind the same `MetricsService` facade.

**Described Grafana dashboards** (shipped as JSON artifacts under `infra/grafana/`):

1. **Process & Runtime** — CPU (`rate(ghost_process_cpu_seconds_total[5m])`), RSS, event-loop lag p99,
   GC pauses, handles.
2. **Discord Gateway** — shard state heatmap, latency p50/p95/p99
   (`histogram_quantile(0.95, rate(ghost_gateway_latency_seconds_bucket[5m]))`), reconnects, rate-limit hits.
3. **API** — RPS by status, latency percentiles, error ratio (`5xx / total`).
4. **Data Stores** — `ghost_db_query_duration_seconds` percentiles, pool saturation, cache hit ratio,
   Redis ops rate.
5. **Queues & Jobs** — `ghost_queue_depth`, DLQ depth, job duration percentiles, failure rate.
6. **Feature Usage** — top commands (`topk(10, rate(ghost_commands_total[1h]))`), per-module activity.

## 16. Tasks for Claude

1. **Phase 1 — Schema**: add `MetricSnapshot`, `MetricThresholdOverride`, and enums to Prisma; create
   migration; add relations on `Guild`.
2. **Phase 2 — Infra/Registry**: implement `metrics.registry.ts` (shared `Registry`), `MetricName` enum,
   `MetricDefinition` catalog, and `MetricsService` facade with lazy registration + buckets from config.
3. **Phase 3 — Collectors**: `SystemCollectorService` (default metrics + pool/cache/queue collect callbacks);
   `PrismaMetricsExtension` query timing.
4. **Phase 4 — Events**: bus listeners for `command.executed`, `gateway.heartbeat`, `gateway.reconnect`,
   `job.lifecycle`, `cache.access`, `module.event`.
5. **Phase 5 — Threshold/Alerting**: `ThresholdEvaluatorService` evaluating defaults + guild overrides,
   emitting `metrics.threshold.breached`.
6. **Phase 6 — Tracing**: `tracing.ts` OTEL bootstrap (OTLP exporter, HTTP/Prisma/ioredis instrumentations,
   sampler from config) wired before NestJS init.
7. **Phase 7 — Interceptors**: `HttpMetricsInterceptor`, `CommandMetricsInterceptor`.
8. **Phase 8 — Snapshots**: recurring BullMQ `metrics-snapshot.job.ts` + repository + retention pruning;
   emit `metrics.snapshot.created`.
9. **Phase 9 — API**: `MetricsController` (`/metrics` guarded, excluded from Swagger) and
   `MetricsAdminController` (snapshots + thresholds, Swagger, permission guards) + DTOs.
10. **Phase 10 — Dashboard**: expose snapshot/threshold endpoints + Grafana JSON artifacts.
11. **Phase 11 — Tests**: unit/integration/e2e per section 13.
12. **Phase 12 — Docs**: update module README and `infra/grafana/` panel docs; OpenAPI regeneration.

## 17. Acceptance Criteria

- [ ] `GET /metrics` returns Prometheus exposition format with all metric families from `MetricName`.
- [ ] Endpoint rejects requests without valid bearer / off the CIDR allow-list (`401/403`) and is absent
      from Swagger.
- [ ] Recording any metric never blocks or `await`s on the command/HTTP hot path.
- [ ] No metric carries a high-cardinality label (verified by test scanning label keys).
- [ ] Threshold breaches emit `metrics.threshold.breached` with correct severity/comparator.
- [ ] OTEL traces export to the configured OTLP endpoint and share `trace_id` with Pino logs.
- [ ] Snapshots persist on schedule, are guild-aware, and prune per `retentionDays`.
- [ ] Admin endpoints enforce `metrics.view`/`metrics.manage` and support pagination + caching.
- [ ] A collector failure degrades gracefully — scrape still returns `200`.

## 18. Definition of Done

- [ ] All Vitest unit + integration suites and Playwright e2e pass in CI (GitHub Actions).
- [ ] Prisma migration created, reviewed, and applied; schema generates with no drift.
- [ ] ESLint/Prettier clean; no `any`; Commitlint-valid Conventional Commits.
- [ ] Module exposes only its public API via `index.ts`; imports no other module's internals.
- [ ] Config validated by Zod with documented ENV overrides.
- [ ] Swagger/OpenAPI regenerated for admin endpoints; `/metrics` excluded.
- [ ] Grafana dashboard JSON committed under `infra/grafana/` and referenced in docs.
- [ ] Docs (this file + README) updated; PR opened against `develop` (no direct commits to `main`).
