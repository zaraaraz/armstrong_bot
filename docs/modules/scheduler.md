# Scheduler Module

> ## Claude Instructions
> - Never modify another module. Do not change architecture decisions from `00-project.md`.
> - This module is a **thin domain layer over BullMQ**. It NEVER lets other modules touch BullMQ/Redis directly — it exposes a typed public scheduling contract. Honour the Cache and Queue layering rules.
> - Keep backwards compatibility. Create Prisma migrations. Generate tests and docs.
> - Generate DTOs. Use Repository Pattern. Use the Event Bus. Use Dependency Injection.
> - No `any`. Keep methods small (<50 lines where reasonable). Follow existing naming.
> - Create indexes for searchable fields. Support pagination, caching, translations, dashboard.
> - Everything is guild-aware unless explicitly a global/system job. Validate every payload with Zod.
> - Other modules consume the `SchedulerService` public API or react to scheduler events — they MUST NOT enqueue into BullMQ themselves.

---

## 1. Purpose

The Scheduler Module is the single, central facility for **time-based execution** across Ghost Bot. It owns cron (recurring) jobs, delayed (one-shot) jobs, fixed-interval jobs, cleanup routines, and maintenance windows. It is a **thin domain layer over BullMQ**: it normalises scheduling semantics, persists job definitions for durability and observability, enforces multi-guild isolation, and exposes a strict, typed **public scheduling contract** that other modules consume.

Concretely, modules such as **Reminders** (fire a reminder at `t`), **Giveaways** (end a giveaway at `t`), and **Backups** (nightly cron) register handlers and schedule jobs *through this module* instead of reaching into BullMQ. The Scheduler guarantees: durable persistence of schedules, replay after restart, idempotent execution, retries/DLQ via the Queue layer, and full observability (metrics, traces, audit).

The Scheduler does **not** know what a reminder or a giveaway *is*. It only knows *job kinds*, *handlers*, *schedules*, and *payloads*. Domain meaning lives in the consuming modules.

## 2. Goals

- Provide one typed API to **schedule once**, **schedule delayed**, **schedule recurring (cron/interval)**, and **cancel** jobs — guild-aware by default.
- Persist every job definition in MySQL (via Prisma) so schedules survive restarts and are inspectable.
- Re-hydrate / reconcile durable schedules into BullMQ on boot (the **JobRegistry** + **reconciler**).
- Guarantee **idempotent**, **at-least-once** execution with retries, backoff, and DLQ routing.
- Support **maintenance windows** that pause/defer non-critical jobs without losing them.
- Provide first-class **observability**: Prometheus metrics, OpenTelemetry spans, structured Pino logs, and an audit trail.
- Expose dashboard read/control endpoints (list, inspect, pause, resume, trigger-now, cancel).
- Never leak BullMQ/Redis details to consumers; never let a module bypass the contract.

## 3. Architecture

The module follows the strict layer flow from the contract:

```
Consumer module ──(public contract)──► SchedulerService (Application)
                                              │
                                              ▼
                                   SchedulerDomainService  (window/idempotency/policy rules)
                                              │
                              ┌───────────────┼─────────────────┐
                              ▼               ▼                 ▼
                        ScheduleRepository  Queue layer     JobRegistry
                        (Prisma/MySQL)      (BullMQ wrap)    (handler map)
```

Key components:

- **`SchedulerService`** — the public application service. The only thing consumers depend on. Validates input with Zod, writes the durable record via the repository, then enqueues through the Queue layer.
- **`SchedulerDomainService`** — pure domain logic: maintenance-window resolution, next-run computation, idempotency-key derivation, retry policy selection. No I/O.
- **`JobRegistry`** — process-local map of `jobKind -> JobHandler`. Modules register handlers at bootstrap. Used by the worker to dispatch executions.
- **`SchedulerWorker`** — the BullMQ worker (wrapped by the Queue layer) that pulls jobs, resolves the handler from the registry, runs it inside a trace span, records the run, and emits events.
- **`ScheduleReconciler`** — on boot and on a heartbeat, diffs DB schedule definitions against BullMQ repeatable jobs and converges them (add missing, remove orphaned, fix drifted cron).
- **`ScheduleRepository`** — the only class that touches Prisma for scheduler tables.

Consumers communicate via the **Event Bus** for fire-and-forget reactions, but the canonical way to *schedule* is the public API. The Scheduler never imports another module's internals.

## 4. Folder Structure

```
src/modules/scheduler/
├── scheduler.module.ts
├── index.ts                          # PUBLIC API barrel (only exported surface)
├── application/
│   ├── scheduler.service.ts          # public SchedulerService
│   ├── schedule.reconciler.ts        # boot + heartbeat reconciliation
│   └── dto/
│       ├── schedule-once.dto.ts
│       ├── schedule-recurring.dto.ts
│       ├── cancel-job.dto.ts
│       └── job-query.dto.ts
├── domain/
│   ├── scheduler.domain-service.ts   # windows, idempotency, next-run, policy
│   ├── job-registry.ts               # jobKind -> handler map
│   ├── job-handler.interface.ts      # JobHandler<TPayload>
│   ├── job-kind.enum.ts
│   ├── schedule.entity.ts
│   └── maintenance-window.vo.ts
├── infrastructure/
│   ├── scheduler.worker.ts           # BullMQ worker wrapper
│   ├── schedule.repository.ts        # ScheduleRepository (Prisma)
│   └── queue.tokens.ts               # SCHEDULER_QUEUE token
├── api/
│   ├── scheduler.controller.ts       # REST (dashboard/admin)
│   └── dto/                          # response DTOs
├── config/
│   └── scheduler.config.ts           # Zod schema + defaults
├── events/
│   └── scheduler.events.ts           # event name constants + payload types
└── locales/
    ├── pt/scheduler.json
    └── en/scheduler.json
```

## 5. Public Interfaces

These are the only types other modules may import (re-exported from `index.ts`). Everything else is internal.

```ts
// domain/job-kind.enum.ts
export enum JobKind {
  Reminder = 'reminder',
  GiveawayEnd = 'giveaway.end',
  Backup = 'backup',
  Cleanup = 'cleanup',
  Maintenance = 'maintenance',
  Custom = 'custom',
}

// domain/job-handler.interface.ts
export interface JobExecutionContext {
  readonly jobId: string;
  readonly jobKind: JobKind;
  readonly guildId: string | null; // null => global/system job
  readonly attempt: number;
  readonly scheduledFor: Date;
  readonly traceId: string;
}

export interface JobHandler<TPayload = unknown> {
  readonly kind: JobKind | string;
  /** Validate the raw payload (Zod) and return a typed payload. */
  parse(raw: unknown): TPayload;
  /** Execute. Must be idempotent for the same (jobId, idempotencyKey). */
  handle(payload: TPayload, ctx: JobExecutionContext): Promise<void>;
}
```

```ts
// application/scheduler.service.ts  (PUBLIC CONTRACT)
export interface ScheduleOnceInput<TPayload = unknown> {
  guildId: string | null;
  kind: JobKind | string;
  payload: TPayload;
  /** Absolute time OR a delay; exactly one must be provided. */
  runAt?: Date;
  delayMs?: number;
  /** De-dupe key. Re-scheduling with the same key replaces the pending job. */
  idempotencyKey?: string;
  /** Whether this job may be deferred by a maintenance window. Default true. */
  deferrableInMaintenance?: boolean;
}

export interface ScheduleRecurringInput<TPayload = unknown> {
  guildId: string | null;
  kind: JobKind | string;
  payload: TPayload;
  /** Standard cron expression (5/6 field). Mutually exclusive with everyMs. */
  cron?: string;
  everyMs?: number;
  /** IANA timezone for cron evaluation. Defaults to guild tz or 'UTC'. */
  timezone?: string;
  idempotencyKey: string; // required for recurring (acts as a stable id)
  deferrableInMaintenance?: boolean;
}

export interface ScheduledJobRef {
  readonly id: string;
  readonly kind: string;
  readonly guildId: string | null;
  readonly status: ScheduleStatus;
  readonly nextRunAt: Date | null;
}

export type ScheduleStatus =
  | 'pending'
  | 'active'      // recurring + registered in BullMQ
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'failed';

export abstract class SchedulerService {
  abstract scheduleOnce<T>(input: ScheduleOnceInput<T>): Promise<ScheduledJobRef>;
  abstract scheduleRecurring<T>(input: ScheduleRecurringInput<T>): Promise<ScheduledJobRef>;
  abstract cancel(jobId: string, guildId: string | null): Promise<boolean>;
  abstract pause(jobId: string, guildId: string | null): Promise<boolean>;
  abstract resume(jobId: string, guildId: string | null): Promise<boolean>;
  abstract triggerNow(jobId: string, guildId: string | null): Promise<void>;
  abstract get(jobId: string, guildId: string | null): Promise<ScheduledJobRef | null>;
}
```

```ts
// domain/job-registry.ts
export abstract class JobRegistry {
  abstract register<T>(handler: JobHandler<T>): void;
  abstract resolve(kind: JobKind | string): JobHandler | undefined;
  abstract list(): ReadonlyArray<string>;
}
```

## 6. Events

The Scheduler is event-driven for *observation*; scheduling itself is via the API. Events are published on the core Event Bus with namespaced names defined in `events/scheduler.events.ts`.

**Emitted:**

```ts
export const SchedulerEvents = {
  Scheduled: 'scheduler.job.scheduled',
  Started: 'scheduler.job.started',
  Completed: 'scheduler.job.completed',
  Failed: 'scheduler.job.failed',
  Retried: 'scheduler.job.retried',
  DeadLettered: 'scheduler.job.dead_lettered',
  Cancelled: 'scheduler.job.cancelled',
  Deferred: 'scheduler.job.deferred', // pushed past a maintenance window
} as const;

export interface JobLifecyclePayload {
  jobId: string;
  kind: string;
  guildId: string | null;
  status: ScheduleStatus;
  attempt: number;
  scheduledFor: string; // ISO
  occurredAt: string;   // ISO
  traceId: string;
  error?: { code: string; message: string };
}
```

**Consumed:**

- `maintenance.window.opened` / `maintenance.window.closed` (from the core/system maintenance source) — triggers deferral and resume sweeps.
- `guild.deleted` — cascade-cancels all jobs for that guild (soft-delete schedules).

Consuming modules (Reminders, Giveaways, Backups) typically subscribe to `scheduler.job.failed` / `scheduler.job.dead_lettered` for their own domain alerting, but the **payload is delivered to their registered `JobHandler.handle`** on success — they do not poll events to run work.

## 7. Dependencies

Relies ONLY on CORE systems — never on other modules directly:

| Core system | Use |
|-------------|-----|
| **Queue (BullMQ wrapper)** | All actual enqueue/process; repeatable jobs, delays, retries, DLQ. The Scheduler is the *only* sanctioned consumer-facing wrapper around scheduling semantics. |
| **Events (Event Bus)** | Emit lifecycle events; consume maintenance + guild-deletion events. |
| **Database (Prisma)** | Durable `Schedule` + `ScheduleRun` records via `ScheduleRepository`. |
| **Cache (memory + Redis layer)** | Cache the active job registry view, dashboard listings, and maintenance-window state (namespaced keys, TTL). Never touches Redis directly. |
| **Permissions** | Authorise dashboard/admin control actions via wildcard claims. |
| **Config** | ENV -> DB -> defaults, Zod-validated (`SchedulerConfig`). |
| **i18n** | Translate user-facing status/error strings for dashboard + commands. |
| **Logging (Pino) + Telemetry (OTel)** | Structured logs and spans for every execution. |

## 8. Configuration

Priority: ENV -> Database (guild-scoped) -> Defaults. Validated with Zod.

```ts
// config/scheduler.config.ts
import { z } from 'zod';

export const schedulerGlobalConfigSchema = z.object({
  concurrency: z.number().int().min(1).max(100).default(8),
  defaultMaxAttempts: z.number().int().min(1).max(20).default(5),
  defaultBackoffMs: z.number().int().min(100).default(5_000),
  backoffStrategy: z.enum(['fixed', 'exponential']).default('exponential'),
  reconcileIntervalMs: z.number().int().min(5_000).default(60_000),
  deadLetterQueue: z.string().default('scheduler:dlq'),
  runRetentionDays: z.number().int().min(1).max(365).default(30),
});

export const schedulerGuildConfigSchema = z.object({
  timezone: z.string().default('UTC'),
  maintenanceWindows: z
    .array(
      z.object({
        cron: z.string(),          // start, e.g. '0 3 * * *'
        durationMinutes: z.number().int().min(1).max(1440),
        deferNonCritical: z.boolean().default(true),
      }),
    )
    .default([]),
  cleanupEnabled: z.boolean().default(true),
});

export type SchedulerGlobalConfig = z.infer<typeof schedulerGlobalConfigSchema>;
export type SchedulerGuildConfig = z.infer<typeof schedulerGuildConfigSchema>;
```

## 9. Database

Prisma models. Soft-delete via `deletedAt`. All multi-guild rows are indexed by `guildId`.

```prisma
enum ScheduleStatus {
  pending
  active
  paused
  completed
  cancelled
  failed
}

enum ScheduleType {
  once
  recurring
}

model Schedule {
  id              String          @id @default(cuid())
  guildId         String?                                  // null => global/system
  kind            String                                   // JobKind value
  type            ScheduleType
  status          ScheduleStatus  @default(pending)
  payload         Json
  idempotencyKey  String?
  cron            String?
  everyMs         Int?
  timezone        String          @default("UTC")
  nextRunAt       DateTime?
  lastRunAt       DateTime?
  deferrable      Boolean         @default(true)
  maxAttempts     Int             @default(5)
  bullJobId       String?                                  // link to BullMQ job/repeat key
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
  deletedAt       DateTime?

  runs            ScheduleRun[]

  @@index([guildId, status])
  @@index([kind, status])
  @@index([nextRunAt])
  @@unique([guildId, kind, idempotencyKey])
  @@map("schedules")
}

model ScheduleRun {
  id           String        @id @default(cuid())
  scheduleId   String
  schedule     Schedule      @relation(fields: [scheduleId], references: [id], onDelete: Cascade)
  guildId      String?
  attempt      Int           @default(1)
  status       ScheduleStatus
  startedAt    DateTime      @default(now())
  finishedAt   DateTime?
  durationMs   Int?
  error        String?
  traceId      String?

  @@index([scheduleId, startedAt])
  @@index([guildId, status])
  @@map("schedule_runs")
}
```

Notes: `@@unique([guildId, kind, idempotencyKey])` enforces dedup. `Schedule.deletedAt` soft-deletes; the reconciler ignores soft-deleted rows and tears down their BullMQ entries. `ScheduleRun` rows older than `runRetentionDays` are purged by the built-in cleanup job.

## 10. API

REST under `/api/v1/scheduler`. All control endpoints require permissions (Section 11). Swagger/OpenAPI annotations on every DTO. Listing supports pagination (`page`, `pageSize`) and filtering.

| Method | Path | Body / Query | Description |
|--------|------|--------------|-------------|
| GET | `/scheduler/jobs` | `?guildId&kind&status&page&pageSize` | Paginated list of schedules. |
| GET | `/scheduler/jobs/:id` | — | Job detail + recent runs. |
| GET | `/scheduler/jobs/:id/runs` | `?page&pageSize` | Paginated run history. |
| POST | `/scheduler/jobs/:id/pause` | — | Pause an active recurring job. |
| POST | `/scheduler/jobs/:id/resume` | — | Resume a paused job. |
| POST | `/scheduler/jobs/:id/trigger` | — | Trigger an execution now. |
| DELETE | `/scheduler/jobs/:id` | — | Cancel (soft-delete) a job. |
| GET | `/scheduler/health` | — | Queue depth, DLQ size, last reconcile, worker status. |

```ts
// api/dto/job-response.dto.ts
export class JobResponseDto {
  id!: string;
  kind!: string;
  guildId!: string | null;
  type!: 'once' | 'recurring';
  status!: ScheduleStatus;
  cron?: string;
  nextRunAt!: string | null;
  lastRunAt!: string | null;
  createdAt!: string;
}

export class PaginatedJobsDto {
  items!: JobResponseDto[];
  page!: number;
  pageSize!: number;
  total!: number;
}
```

No WebSocket surface in v1 — dashboard polls `/scheduler/health` and listing endpoints. (See Future Extensions for live updates.)

## 11. Permissions

Wildcard claims namespaced under `scheduler.*`:

| Claim | Grants |
|-------|--------|
| `scheduler.*` | All scheduler actions. |
| `scheduler.view` | Read jobs, runs, health. |
| `scheduler.pause` | Pause/resume jobs. |
| `scheduler.trigger` | Manually trigger a job now. |
| `scheduler.cancel` | Cancel/delete jobs. |
| `scheduler.config` | Edit guild scheduler config (timezone, maintenance windows). |

Scheduling *itself* is a programmatic, module-to-module capability via `SchedulerService` and is not a user-facing claim — there is no slash command to create arbitrary jobs. Control actions on the dashboard map to the claims above and are guild-scoped (a guild admin can only act on their own guild's jobs; global/system jobs require a platform-level `scheduler.*`).

## 12. Logging

Structured Pino logs with category `scheduler`. Sub-categories: `scheduler.schedule`, `scheduler.run`, `scheduler.reconcile`, `scheduler.maintenance`.

Logged per execution: `jobId`, `kind`, `guildId`, `attempt`, `durationMs`, `status`, `traceId`. Errors are categorised through the unified error system (never leak internals to users).

Audit hooks: every control action (pause/resume/cancel/trigger/config-change) writes an audit entry via the core audit facility with actor, guild, target jobId, and before/after status.

OpenTelemetry: each run is a span `scheduler.run` with attributes mirroring the log fields; reconciliation is span `scheduler.reconcile`. Prometheus metrics: `scheduler_jobs_total{kind,status}`, `scheduler_run_duration_ms` (histogram), `scheduler_queue_depth`, `scheduler_dlq_size`, `scheduler_reconcile_drift_total`.

## 13. Testing

Vitest (unit/integration) + Playwright (dashboard e2e).

- **Unit** — `SchedulerDomainService`: next-run computation for cron/interval, timezone handling, maintenance-window deferral math, idempotency-key derivation. `JobRegistry` register/resolve. Zod schema validation (invalid cron, both `runAt` and `delayMs`, etc.).
- **Integration** — `SchedulerService` against a test MySQL + in-memory/ioredis-mock BullMQ: schedule once -> persisted -> enqueued -> handler invoked exactly once; recurring re-hydration on reconcile; cancel removes BullMQ entry and soft-deletes; retry -> DLQ path; idempotent re-schedule replaces pending job.
- **Reconciler** — DB/BullMQ drift scenarios (orphan repeat job removed, missing repeat job re-added, cron drift corrected).
- **e2e** — dashboard list/pause/resume/trigger/cancel honour permission claims and guild scoping.

Coverage must include: at-least-once + idempotency, retry/backoff/DLQ, maintenance deferral, multi-guild isolation, soft-delete cascade on `guild.deleted`.

## 14. Dashboard Integration

The dashboard exposes a **Scheduler** panel (guild-scoped, plus a platform view for global jobs):

- Jobs table: kind, type, status, next run, last run, with filters and pagination (backed by `GET /scheduler/jobs`).
- Job detail drawer: payload preview (redacted/safe), recent runs with duration and error, action buttons (pause/resume/trigger/cancel) gated by claims.
- Health widget: queue depth, DLQ size, last reconcile time, worker up/down (from `/scheduler/health`).
- Config editor for guild settings: timezone and maintenance windows (`scheduler.config`).
- All labels and statuses are translated (PT primary, EN secondary) via the i18n namespace `scheduler`.

## 15. Future Extensions

- Live dashboard updates via WebSocket (push lifecycle events).
- Per-kind rate limiting and priority lanes.
- Calendar/RRULE scheduling beyond cron (e.g. "last business day of month").
- Distributed-lock-based singleton jobs across multiple worker replicas (beyond BullMQ defaults).
- Job dependency graphs (run B after A completes) and saga/workflow chaining.
- Self-serve job templates for guild admins behind a new claim.

## 16. Tasks for Claude

1. **Phase 1 — Schema**: Add `Schedule`, `ScheduleRun`, enums to `schema.prisma`; create migration. Add indexes and the unique dedup constraint.
2. **Phase 2 — Config**: Implement `SchedulerConfig` Zod schemas (global + guild) with ENV->DB->defaults wiring.
3. **Phase 3 — Repository**: Implement `ScheduleRepository` (the only Prisma consumer) with pagination + soft-delete.
4. **Phase 4 — Domain**: Implement `SchedulerDomainService` (next-run, windows, idempotency, policy), `JobRegistry`, `JobHandler` interface, `JobKind` enum, value objects.
5. **Phase 5 — Application**: Implement `SchedulerService` (public contract) and wire the Queue layer; emit lifecycle events.
6. **Phase 6 — Worker & Reconciler**: Implement `SchedulerWorker` (handler dispatch, retries, DLQ, traces) and `ScheduleReconciler` (boot + heartbeat convergence).
7. **Phase 7 — Maintenance & Cleanup**: Implement maintenance-window deferral (consume maintenance events) and the built-in `cleanup` job (purge old `ScheduleRun`).
8. **Phase 8 — API**: Implement `SchedulerController` + DTOs + Swagger; enforce permission claims and guild scoping.
9. **Phase 9 — Dashboard**: Wire panel, detail drawer, health widget, config editor; i18n PT/EN.
10. **Phase 10 — Tests**: Unit + integration + reconciler + e2e per Section 13.
11. **Phase 11 — Docs**: Update module README and the public-API barrel `index.ts` documentation.

## 17. Acceptance Criteria

- A module can `scheduleOnce` and `scheduleRecurring` through `SchedulerService` only; no module imports BullMQ/Redis.
- Scheduled jobs are persisted in MySQL and survive a process restart (reconciler re-hydrates them).
- Execution is at-least-once and idempotent for a given `(jobId, idempotencyKey)`.
- Retries follow configured backoff; exhausted jobs land in the DLQ and emit `scheduler.job.dead_lettered`.
- Maintenance windows defer deferrable jobs and they run afterward; non-deferrable jobs still run.
- Cancel/pause/resume/trigger work via API, respect permission claims, and are guild-scoped.
- `guild.deleted` cascades to soft-delete and tears down BullMQ entries.
- Metrics, traces, logs, and audit entries are produced for every run and control action.
- Dashboard lists, filters (paginated), and controls jobs with translated labels.

## 18. Definition of Done

- All 11 phases complete; Prisma migration created and applied.
- `SchedulerService`, `JobRegistry`, `JobHandler`, `JobKind`, and event/DTO types exported via `index.ts`; no internal leakage.
- Unit + integration + reconciler + e2e tests pass; coverage includes idempotency, retry/DLQ, maintenance, multi-guild isolation.
- No `any`; ESLint/Prettier clean; Husky/Commitlint pass.
- Swagger documents all endpoints; i18n PT + EN strings present.
- Prometheus metrics and OTel spans verified; audit hooks firing.
- Docs written; Conventional Commits used; PR opened against `develop` (no direct commit to `main`).
