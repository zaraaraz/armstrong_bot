# Analytics Module

> ## Claude Instructions
> - Never modify another module. Do not change architecture decisions from `00-project.md`.
> - Keep backwards compatibility. Create Prisma migrations. Generate tests and docs.
> - Generate DTOs. Use the Repository Pattern. Use the Event Bus. Use Dependency Injection.
> - No `any`. Keep methods small (<50 lines where reasonable). Follow existing naming.
> - Create indexes for searchable fields. Support pagination, caching, translations, dashboard.
> - This module is **read-mostly and asynchronous**. It MUST NEVER block, slow, or fail the
>   command path. All ingestion happens by consuming the Event Bus and enqueuing BullMQ jobs.
> - Never touch Redis directly — go through the Cache layer. Never import another module's
>   internal services — only consume published events and the public contract.
> - Aggregation is idempotent: re-running a rollup job for the same window MUST produce the
>   same row (upsert on the natural key). No double counting.

---

## 1. Purpose

The Analytics Module collects, aggregates, stores, and exposes **operational and behavioural
metrics** for every guild Ghost Bot serves, plus global platform metrics. It answers questions
like: which commands are used most, who the most active members are, how much voice time members
accrue, daily active users, guild growth over time, API consumption per consumer, error rates,
and command/API response times.

It is a **passive observer** of the rest of the system. It does not own business logic; it
listens to the Event Bus, buffers raw signals, and runs scheduled BullMQ aggregation jobs that
roll raw events up into compact time-series buckets. The dashboard reads those buckets to render
charts. Nothing the Analytics Module does is allowed to be on the synchronous path of a slash
command, an interaction, or an HTTP request.

## 2. Goals

- **Zero hot-path cost.** Ingestion is fire-and-forget: emit an event, return. Persisting raw
  signals happens in a background queue, never inline.
- **Guild-aware by default.** Every metric is scoped to a `guildId` unless explicitly global
  (platform-wide growth, total guild count, global API usage).
- **Time-series first.** Raw events are short-lived; the source of truth for charts is
  pre-aggregated buckets (`minute` -> `hour` -> `day` -> `month` rollups).
- **Idempotent aggregation.** Re-running any rollup window yields identical results (upsert on
  a deterministic natural key). Safe to replay after an outage.
- **Cheap reads.** Dashboard queries hit pre-aggregated, indexed, cached rows — never scan raw
  events at request time.
- **Privacy-respecting retention.** Raw events have a short TTL; aggregates are retained longer.
  Per-guild retention is configurable. User-level metrics support erasure.
- **Extensible metric catalogue.** Adding a new metric is declarative — register a metric
  descriptor, point it at an event, done.

## 3. Architecture

The module follows the strict layer flow from the contract:

```
Event Bus  ─▶ AnalyticsEventConsumer ─▶ IngestionService ─▶ RawEventRepository ─▶ DB
                                              │
                                              └─▶ BullMQ (ingest queue, batched writes)

BullMQ (rollup queue, cron) ─▶ AggregationService ─▶ MetricBucketRepository (upsert) ─▶ DB

API Controller ─▶ AnalyticsQueryService ─▶ MetricBucketRepository ─▶ DB
                          │
                          └─▶ Cache layer (namespaced, TTL) for hot dashboard queries
```

Key decisions:

- **Two queues.** `analytics-ingest` (high volume, batched, short retries) and
  `analytics-rollup` (low volume, cron-driven, recurring). Both have a DLQ.
- **Write batching.** The consumer pushes signals into a bounded in-memory buffer flushed on a
  size/time threshold into a single `analytics-ingest` job → one bulk insert. This keeps DB
  write amplification low under command storms.
- **CQRS-lite.** Reads (`AnalyticsQueryService`) and writes (`IngestionService`,
  `AggregationService`) are separated, but share the same Prisma models. No separate read store.
- **No back-pressure on producers.** If the ingest queue is saturated, the buffer drops oldest
  raw signals (configurable) and increments a `analytics_dropped_total` counter — the command
  path is never throttled.

## 4. Folder Structure

```
src/modules/analytics/
├── analytics.module.ts                 # NestJS module wiring (DI, queues)
├── index.ts                            # PUBLIC API barrel — the ONLY thing other modules may import
├── public/
│   ├── analytics.contract.ts           # Public read contract (interfaces only)
│   └── analytics.tokens.ts             # DI tokens for the public service
├── application/
│   ├── ingestion.service.ts            # buffers + enqueues raw signals
│   ├── aggregation.service.ts          # rollup logic (raw -> buckets)
│   ├── analytics-query.service.ts      # read side, cached
│   └── metric-catalog.service.ts       # registry of metric descriptors
├── domain/
│   ├── metric-descriptor.ts            # MetricDescriptor value object
│   ├── time-bucket.ts                  # bucket math (granularity, window keys)
│   └── aggregation.types.ts            # Granularity, AggregateOp, etc.
├── consumers/
│   └── analytics-event.consumer.ts     # Event Bus subscriptions
├── jobs/
│   ├── ingest.processor.ts             # BullMQ processor: bulk insert raw events
│   ├── rollup.processor.ts             # BullMQ processor: aggregate window
│   └── retention.processor.ts          # BullMQ processor: prune expired raw/aggregate rows
├── infrastructure/
│   ├── raw-event.repository.ts         # Prisma — raw event writes/reads
│   └── metric-bucket.repository.ts     # Prisma — bucket upserts/queries
├── api/
│   ├── analytics.controller.ts         # REST endpoints (Swagger)
│   └── dto/
│       ├── query-metric.dto.ts
│       ├── metric-series.dto.ts
│       ├── leaderboard.dto.ts
│       └── overview.dto.ts
├── config/
│   └── analytics.config.ts             # Zod schema + defaults (ENV -> DB -> defaults)
└── tests/
    ├── aggregation.service.spec.ts
    ├── ingestion.service.spec.ts
    ├── analytics-query.service.spec.ts
    └── rollup.e2e-spec.ts
```

## 5. Public Interfaces

The module exposes ONLY the read contract below via `index.ts`. Other modules never see the
ingestion or aggregation services.

```typescript
// public/analytics.contract.ts

/** Supported time-bucket granularities for stored aggregates. */
export type Granularity = 'minute' | 'hour' | 'day' | 'month';

/** The catalogue of metrics this module knows how to aggregate and serve. */
export type MetricKey =
  | 'command.used'
  | 'command.response_time'
  | 'user.active'
  | 'voice.time'
  | 'guild.growth'
  | 'api.usage'
  | 'api.response_time'
  | 'error.count';

/** A single point in a time-series. `t` is the bucket start (UTC, ISO-8601). */
export interface MetricPoint {
  readonly t: string;
  readonly value: number;
}

/** A fully resolved series for one metric over a window. */
export interface MetricSeries {
  readonly metric: MetricKey;
  readonly guildId: string | null; // null => global
  readonly granularity: Granularity;
  readonly points: ReadonlyArray<MetricPoint>;
}

export interface MetricQuery {
  readonly metric: MetricKey;
  readonly guildId: string | null;
  readonly from: Date;
  readonly to: Date;
  readonly granularity: Granularity;
  /** Optional dimension filter, e.g. { command: 'ban' } or { consumer: 'web' }. */
  readonly dimensions?: Readonly<Record<string, string>>;
}

export interface LeaderboardEntry {
  readonly subjectId: string; // userId, commandName, consumer, etc.
  readonly value: number;
  readonly rank: number;
}

export interface LeaderboardQuery {
  readonly metric: MetricKey;
  readonly guildId: string;
  readonly from: Date;
  readonly to: Date;
  readonly limit: number;
}

/** PUBLIC, read-only surface. The only contract other modules may depend on. */
export abstract class AnalyticsPublicService {
  abstract getSeries(query: MetricQuery): Promise<MetricSeries>;
  abstract getLeaderboard(query: LeaderboardQuery): Promise<ReadonlyArray<LeaderboardEntry>>;
  abstract getGuildOverview(guildId: string, from: Date, to: Date): Promise<GuildOverview>;
}

export interface GuildOverview {
  readonly guildId: string;
  readonly commandsUsed: number;
  readonly activeUsers: number;
  readonly voiceMinutes: number;
  readonly errorCount: number;
  readonly avgResponseMs: number;
}
```

```typescript
// domain/metric-descriptor.ts

import { Granularity, MetricKey } from '../public/analytics.contract';

export type AggregateOp = 'count' | 'sum' | 'avg' | 'distinct' | 'max';

/** Declarative mapping: an Event Bus topic -> a stored metric. */
export interface MetricDescriptor {
  readonly key: MetricKey;
  /** Event topic this metric is derived from (see Section 6). */
  readonly sourceEvent: string;
  readonly op: AggregateOp;
  /** Field on the raw payload to aggregate (ignored for `count`). */
  readonly valueField?: string;
  /** Dimensions to retain on the bucket key (e.g. ['command'], ['consumer']). */
  readonly dimensions: ReadonlyArray<string>;
  /** Whether the metric is guild-scoped or global. */
  readonly scope: 'guild' | 'global';
  /** Lowest granularity to roll up to. Higher ones derive from this. */
  readonly baseGranularity: Granularity;
}
```

## 6. Events

The module is **consume-heavy**. It subscribes to events other modules already publish; it must
not require producers to know analytics exists. All payloads carry a `guildId` (nullable for
global) and an `occurredAt` timestamp.

### Consumed (Event Bus → IngestionService)

| Topic | Payload shape | Becomes metric |
|-------|---------------|----------------|
| `command.executed` | `{ guildId, userId, command, durationMs, success, occurredAt }` | `command.used`, `command.response_time` |
| `command.failed` | `{ guildId, userId, command, errorCode, occurredAt }` | `error.count` |
| `voice.session.ended` | `{ guildId, userId, channelId, durationMs, occurredAt }` | `voice.time` |
| `user.activity` | `{ guildId, userId, kind, occurredAt }` | `user.active` (distinct users/day) |
| `guild.joined` | `{ guildId, occurredAt }` | `guild.growth` (+1) |
| `guild.left` | `{ guildId, occurredAt }` | `guild.growth` (-1) |
| `api.request.completed` | `{ guildId, consumer, route, statusCode, durationMs, occurredAt }` | `api.usage`, `api.response_time` |

```typescript
// Consumed payload contracts (mirrors of published events; analytics owns no producer side)
export interface CommandExecutedPayload {
  readonly guildId: string;
  readonly userId: string;
  readonly command: string;
  readonly durationMs: number;
  readonly success: boolean;
  readonly occurredAt: string; // ISO-8601 UTC
}

export interface VoiceSessionEndedPayload {
  readonly guildId: string;
  readonly userId: string;
  readonly channelId: string;
  readonly durationMs: number;
  readonly occurredAt: string;
}

export interface ApiRequestCompletedPayload {
  readonly guildId: string | null;
  readonly consumer: string;
  readonly route: string;
  readonly statusCode: number;
  readonly durationMs: number;
  readonly occurredAt: string;
}
```

### Emitted (Analytics → Event Bus)

| Topic | Payload | When |
|-------|---------|------|
| `analytics.rollup.completed` | `{ metric, granularity, windowStart, windowEnd, rowsWritten }` | After each successful rollup job |
| `analytics.threshold.crossed` | `{ guildId, metric, value, threshold, direction }` | When a configured alert threshold is crossed (e.g. error spike) |
| `analytics.retention.pruned` | `{ scope, rowsDeleted, olderThan }` | After a retention pass |

These are informational only; no module is required to consume them.

## 7. Dependencies

Relies exclusively on CORE systems — never on another module's internals:

- **Event Bus** — subscribes to producer events; emits rollup/threshold events.
- **Queue (BullMQ)** — `analytics-ingest`, `analytics-rollup`, `analytics-retention` queues,
  with retries and DLQ. Rollups are recurring (cron-style repeatable jobs).
- **Cache** — read-through cache for dashboard queries (overview, series, leaderboards),
  namespaced `analytics:<guildId>:<metric>:<window-hash>`, short TTL.
- **Database (Prisma + MySQL)** — raw events + aggregate buckets, accessed only through
  repositories.
- **Permissions** — guards on the read API (claims in Section 11).
- **Config** — Zod-validated settings resolved ENV → DB → defaults.
- **Logging/Tracing** — Pino + OpenTelemetry spans on jobs and queries.

It depends on **no other feature module**. It only knows event topic names and their payload
shapes, treated as a published contract.

## 8. Configuration

```typescript
// config/analytics.config.ts
import { z } from 'zod';

export const analyticsConfigSchema = z.object({
  enabled: z.boolean().default(true),

  ingest: z.object({
    bufferMaxSize: z.number().int().positive().default(500),
    bufferFlushMs: z.number().int().positive().default(2000),
    dropOldestWhenFull: z.boolean().default(true),
  }),

  rollup: z.object({
    // cron expressions for repeatable jobs, per granularity
    minuteCron: z.string().default('*/1 * * * *'),
    hourCron: z.string().default('5 * * * *'),
    dayCron: z.string().default('15 0 * * *'),
    monthCron: z.string().default('30 0 1 * *'),
  }),

  retention: z.object({
    rawEventDays: z.number().int().positive().default(14),
    minuteBucketDays: z.number().int().positive().default(30),
    hourBucketDays: z.number().int().positive().default(180),
    dayBucketDays: z.number().int().positive().default(1095),
    monthBucketMonths: z.number().int().positive().default(120),
  }),

  query: z.object({
    cacheTtlSeconds: z.number().int().nonnegative().default(60),
    maxRangeDays: z.number().int().positive().default(366),
    defaultPageSize: z.number().int().positive().default(100),
    maxPageSize: z.number().int().positive().default(1000),
  }),

  thresholds: z
    .array(
      z.object({
        metric: z.string(),
        granularity: z.enum(['minute', 'hour', 'day', 'month']),
        value: z.number(),
        direction: z.enum(['above', 'below']),
      }),
    )
    .default([]),
});

export type AnalyticsConfig = z.infer<typeof analyticsConfigSchema>;
```

Resolution order is **ENV → Database (guild-scoped overrides) → Defaults**. `enabled`,
`retention`, and `thresholds` are overridable per guild; queue/cron settings are global only.

## 9. Database

Raw events are write-optimised and short-lived. Buckets are read-optimised. All tables use
`bigint` autoincrement surrogate keys plus a deterministic natural key for idempotent upserts.

```prisma
// schema additions

model AnalyticsRawEvent {
  id          BigInt   @id @default(autoincrement())
  guildId     String?  // null => global event
  metricKey   String   // MetricKey value
  subjectId   String?  // userId / command / consumer, depending on metric
  value       Float    @default(1) // durationMs, +1/-1 for growth, etc.
  dimensions  Json     // { command: "ban" } | { consumer: "web", route: "..." }
  occurredAt  DateTime
  createdAt   DateTime @default(now())

  @@index([metricKey, occurredAt])
  @@index([guildId, metricKey, occurredAt])
  @@map("analytics_raw_event")
}

model AnalyticsMetricBucket {
  id           BigInt      @id @default(autoincrement())
  guildId      String?     // null => global bucket
  metricKey    String
  granularity  String      // 'minute' | 'hour' | 'day' | 'month'
  windowStart  DateTime    // bucket start, UTC, aligned to granularity
  dimensionKey String      @default("") // stable hash of retained dimensions, "" if none
  dimensions   Json
  // aggregate accumulators (op decides which is meaningful)
  count        BigInt      @default(0)
  sum          Float       @default(0)
  min          Float?
  max          Float?
  distinctSet  Json?       // for `distinct` ops (e.g. active users) — HLL/array, bounded
  distinct     BigInt      @default(0)

  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt

  @@unique([guildId, metricKey, granularity, windowStart, dimensionKey], name: "bucket_natural_key")
  @@index([metricKey, granularity, windowStart])
  @@index([guildId, metricKey, granularity, windowStart])
  @@map("analytics_metric_bucket")
}

model AnalyticsGuildSettings {
  guildId       String   @id
  enabled       Boolean  @default(true)
  retention     Json     // partial AnalyticsConfig.retention override
  thresholds    Json     // threshold overrides
  updatedAt     DateTime @updatedAt

  @@map("analytics_guild_settings")
}
```

Notes:
- **No soft-delete** on raw events or buckets — they are *deleted* by the retention job (true
  prune is the whole point of bounded storage). `AnalyticsGuildSettings` is config and is never
  hard-deleted; toggling `enabled=false` is the soft equivalent.
- `avg` is derived at read time as `sum / count`; never stored.
- `distinct` (active users) uses a bounded set with promotion to count; the `bucket_natural_key`
  unique constraint guarantees idempotent upserts.

## 10. API

All endpoints are under `/api/v1/analytics`, Swagger-tagged `Analytics`, guarded by claims
(Section 11), and guild-scoped via path param. Reads only — there is no public write endpoint.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/analytics/:guildId/overview` | KPI summary (`GuildOverview`) for a window |
| GET | `/api/v1/analytics/:guildId/series` | Time-series for one metric |
| GET | `/api/v1/analytics/:guildId/leaderboard` | Top-N by metric (users / commands) |
| GET | `/api/v1/analytics/global/series` | Global series (e.g. guild growth, API usage) — admin only |

```typescript
// api/dto/query-metric.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsISO8601, IsOptional, IsObject } from 'class-validator';
import { Granularity, MetricKey } from '../../public/analytics.contract';

export class QueryMetricDto {
  @ApiProperty({ enum: ['command.used', 'command.response_time', 'user.active', 'voice.time', 'guild.growth', 'api.usage', 'api.response_time', 'error.count'] })
  @IsEnum(['command.used', 'command.response_time', 'user.active', 'voice.time', 'guild.growth', 'api.usage', 'api.response_time', 'error.count'])
  readonly metric!: MetricKey;

  @ApiProperty() @IsISO8601() readonly from!: string;
  @ApiProperty() @IsISO8601() readonly to!: string;

  @ApiProperty({ enum: ['minute', 'hour', 'day', 'month'] })
  @IsEnum(['minute', 'hour', 'day', 'month'])
  readonly granularity!: Granularity;

  @ApiProperty({ required: false, type: Object })
  @IsOptional() @IsObject()
  readonly dimensions?: Record<string, string>;
}
```

```typescript
// api/dto/metric-series.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class MetricPointDto {
  @ApiProperty() readonly t!: string;
  @ApiProperty() readonly value!: number;
}

export class MetricSeriesDto {
  @ApiProperty() readonly metric!: string;
  @ApiProperty({ nullable: true }) readonly guildId!: string | null;
  @ApiProperty() readonly granularity!: string;
  @ApiProperty({ type: [MetricPointDto] }) readonly points!: MetricPointDto[];
}
```

Validation: `to - from` must not exceed `query.maxRangeDays`; `granularity` must be coarse enough
that the resulting point count stays within bounds (reject "minute" over a 1-year range → 422).
Leaderboard and series support pagination/limits per config. No WS — charts poll on an interval.

## 11. Permissions

Wildcard-friendly claims defined by this module:

| Claim | Grants |
|-------|--------|
| `analytics.view` | Read guild overview, series, leaderboards |
| `analytics.view.users` | See user-identifying leaderboards (most active users) |
| `analytics.export` | Export raw/aggregate data (CSV/JSON) |
| `analytics.config` | Change guild analytics settings (retention, thresholds, enable) |
| `analytics.global` | Read global/platform-wide metrics (guild growth, total API usage) |
| `analytics.*` | All of the above |

`analytics.view.users` is separated so a guild can grant general analytics without exposing
per-member tracking. Global endpoints require `analytics.global` and are platform-admin only.

## 12. Logging

Pino structured logs, category `analytics`, with OpenTelemetry spans:

- **Ingestion** (`analytics.ingest`): buffer flush size, enqueue latency, dropped-signal count
  (warn when `dropOldestWhenFull` triggers).
- **Aggregation** (`analytics.rollup`): metric, granularity, window, rows scanned, rows upserted,
  duration. Errors → DLQ with full context.
- **Query** (`analytics.query`): metric, guildId, range, granularity, cache hit/miss, duration.
- **Retention** (`analytics.retention`): scope, rows deleted, cutoff date.
- **Audit hooks**: writes to `analytics.config` (settings changes) and any `analytics.export`
  call emit an audit log entry (actor, guildId, before/after for config) via the core audit sink.

No PII beyond Discord IDs is logged; payloads are never logged verbatim at info level.

## 13. Testing

- **Unit (Vitest):**
  - `TimeBucket` window alignment for every granularity (DST/UTC edge cases, month boundaries).
  - `AggregationService` per `AggregateOp`: count, sum, avg-at-read, distinct, max.
  - **Idempotency:** running the same rollup window twice yields one row, identical values.
  - `IngestionService` buffering: flush-on-size, flush-on-time, drop-oldest behaviour, no throw
    on enqueue failure (hot-path safety).
  - Query range/granularity validation rejects oversized windows.
- **Integration:** consumer → ingest queue → bulk insert → rollup → bucket → query, against a
  real MySQL + Redis test container. Cache hit/miss assertions.
- **e2e (Playwright/HTTP):** REST endpoints return correct DTOs, enforce claims (403 without
  `analytics.view`), enforce range caps (422), paginate.
- **Performance guard:** assert ingestion adds < 1ms synchronous overhead to a simulated command
  path (emit-and-return), proving non-blocking.
- Coverage target ≥ 85% on `application/` and `domain/`.

## 14. Dashboard Integration

The dashboard `Analytics` section consumes the read API and renders:

- **Overview cards:** commands used, active users, voice minutes, error count, avg response time
  (from `/overview`).
- **Time-series charts:** line/area charts per metric with a granularity + range selector
  (minute/hour/day/month), backed by `/series`. Polls on `query.cacheTtlSeconds` interval.
- **Leaderboards:** "Most active users" and "Most used commands" tables (`/leaderboard`),
  gated behind `analytics.view.users` for the user table.
- **Growth view:** guild growth and global API usage (admin, `analytics.global`).
- **Settings panel:** retention sliders, threshold rules, enable/disable (claim `analytics.config`).
- **Export button:** CSV/JSON download (claim `analytics.export`).
- All labels via i18n (PT primary, EN secondary), namespace `analytics`, with plurals and
  variable interpolation (e.g. `{count} comandos`).

## 15. Future Extensions

- **Funnels & retention cohorts** (D1/D7/D30 returning users).
- **Anomaly detection** beyond static thresholds (rolling z-score on error/response metrics).
- **Custom dashboards** — user-defined metric/widget composition saved per guild.
- **Webhook/alert delivery** for `analytics.threshold.crossed` (Discord channel, email).
- **HyperLogLog** sketches for high-cardinality distinct counts instead of bounded sets.
- **Data warehouse export** (scheduled dump to S3/ClickHouse for BI tools).
- **Prometheus bridge** exposing select aggregates as gauges for Grafana alongside infra metrics.

## 16. Tasks for Claude

1. **Phase 1 — Schema:** Add `AnalyticsRawEvent`, `AnalyticsMetricBucket`,
   `AnalyticsGuildSettings` to Prisma; create migration; add indexes and the bucket natural key.
2. **Phase 2 — Config:** Implement `analytics.config.ts` Zod schema + ENV→DB→defaults loader.
3. **Phase 3 — Domain:** `MetricDescriptor`, `TimeBucket` math, the metric catalogue
   (`MetricCatalogService`) wiring topics → descriptors.
4. **Phase 4 — Repositories:** `RawEventRepository` (bulk insert), `MetricBucketRepository`
   (idempotent upsert + range queries) using the Repository Pattern.
5. **Phase 5 — Ingestion:** `IngestionService` buffer + `analytics-ingest` BullMQ processor
   (bulk write, drop-oldest, never throw on hot path).
6. **Phase 6 — Events:** `AnalyticsEventConsumer` subscribing to all Section 6 topics.
7. **Phase 7 — Aggregation:** `AggregationService` + `rollup.processor` repeatable jobs per
   granularity; emit `analytics.rollup.completed`; threshold checks.
8. **Phase 8 — Retention:** `retention.processor` job; emit `analytics.retention.pruned`.
9. **Phase 9 — Query:** `AnalyticsQueryService` (cache-through) + `AnalyticsPublicService` impl.
10. **Phase 10 — API:** `AnalyticsController`, DTOs, Swagger, permission guards, validation.
11. **Phase 11 — Dashboard:** overview/series/leaderboard/settings/export wiring + i18n keys.
12. **Phase 12 — Tests:** unit, integration, e2e, performance guard.
13. **Phase 13 — Docs:** update module README and this spec; document metric catalogue.

## 17. Acceptance Criteria

- [ ] Emitting any Section 6 event results in raw rows after the next ingest flush, with **no**
      measurable synchronous latency added to the producer.
- [ ] Rollup jobs produce correctly aligned buckets for minute/hour/day/month.
- [ ] Re-running a rollup for the same window does **not** create duplicates or change values.
- [ ] `/overview`, `/series`, `/leaderboard` return correct, cached, paginated data.
- [ ] Endpoints enforce `analytics.*` claims; user leaderboard requires `analytics.view.users`.
- [ ] Oversized ranges are rejected (422); cache hit/miss behaves per TTL.
- [ ] Retention prunes raw events and buckets per (guild-overridable) config.
- [ ] All settings validated by Zod; per-guild overrides resolve in ENV→DB→defaults order.
- [ ] Dropping the ingest queue under load increments the drop counter but never blocks commands.
- [ ] Dashboard renders all charts with PT/EN translations.

## 18. Definition of Done

- [ ] All unit, integration, and e2e tests pass (`vitest`, `playwright`); coverage ≥ 85% on
      `application/` and `domain/`.
- [ ] Prisma migration created and applied; schema reviewed for indexes and the natural key.
- [ ] No `any`; TypeScript strict passes; ESLint/Prettier clean; Husky/Commitlint satisfied.
- [ ] Swagger/OpenAPI documents all endpoints and DTOs.
- [ ] Pino logging categories and OpenTelemetry spans present; audit hooks on config/export.
- [ ] i18n keys added for all dashboard strings (PT + EN).
- [ ] This document and the module README are up to date.
- [ ] Conventional Commits on a `feature/analytics` branch; no direct commits to `main`; PR opened
      against `develop` with green CI.
