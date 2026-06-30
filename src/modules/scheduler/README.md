# Scheduler Module

> Spec: [`docs/modules/scheduler.md`](../../../docs/modules/scheduler.md) · Roadmap item 13 (Phase 4).

The single, central facility for **time-based execution** across Ghost Bot — a
thin domain layer over BullMQ. It owns cron/recurring jobs, delayed one-shots,
fixed-interval jobs, cleanup routines and maintenance windows, and exposes a
strict typed **public scheduling contract**. Other modules schedule work
*through this module* and never touch BullMQ/Redis directly.

## Public API (the only importable surface)

Everything below is re-exported from [`index.ts`](./index.ts). Nothing else is
public — repositories, the queue wrapper, the worker and the reconciler are
internal.

```ts
import {
  SchedulerService,        // inject this to schedule work
  JobRegistry,             // register a handler per JobKind at bootstrap
  JobKind,
  type JobHandler,
  type JobExecutionContext,
  type ScheduledJobRef,
  SchedulerEvents,         // lifecycle event names on the core Event Bus
} from '../scheduler';
```

### 1. Register a handler (bootstrap)

```ts
@Injectable()
export class RemindersBootstrap implements OnApplicationBootstrap {
  constructor(private readonly registry: JobRegistry) {}

  onApplicationBootstrap() {
    this.registry.register<ReminderPayload>({
      kind: JobKind.Reminder,
      parse: (raw) => reminderSchema.parse(raw), // Zod — never trust the row
      handle: async (payload, ctx) => {
        // idempotent for the same (ctx.jobId, idempotencyKey)
        await this.send(payload, ctx.guildId);
      },
    });
  }
}
```

### 2. Schedule work

```ts
// One-shot (absolute time OR delay — exactly one)
await scheduler.scheduleOnce({
  guildId: 'g1',
  kind: JobKind.Reminder,
  payload: { channelId, text },
  runAt: new Date(Date.now() + 60_000),
  idempotencyKey: `reminder:${reminderId}`, // re-scheduling replaces the pending job
});

// Recurring (cron OR everyMs — exactly one; idempotencyKey REQUIRED)
await scheduler.scheduleRecurring({
  guildId: null,                 // null => global/system job
  kind: JobKind.Backup,
  payload: {},
  cron: '0 3 * * *',
  timezone: 'Europe/Lisbon',
  idempotencyKey: 'nightly-backup',
});
```

### 3. Control (also exposed over REST)

`cancel` · `pause` · `resume` · `triggerNow` · `get` — all guild-scoped.

## Guarantees

- **Durable** — every schedule is persisted in MySQL (`schedules` / `schedule_runs`)
  and **re-hydrated into BullMQ on boot** by the reconciler, so schedules survive
  restarts.
- **At-least-once + idempotent** — handlers must be idempotent for a given
  `(jobId, idempotencyKey)`.
- **Retries / backoff / DLQ** — exhausted jobs emit `scheduler.job.dead_lettered`.
- **Maintenance windows** — deferrable jobs landing inside an open window are
  pushed to the window end; non-deferrable jobs still run.
- **Multi-guild isolation** — every row is `guildId`-scoped; `guild.deleted`
  cascade soft-deletes a guild's schedules and tears down their BullMQ entries.
- **Observability** — Prometheus metrics, OpenTelemetry `scheduler.run` /
  `scheduler.reconcile` spans, structured Pino logs and audit entries per run and
  control action.

## REST API

Under `/api/v1/scheduler`, gated by `scheduler.*` permission claims and scoped to
the caller's guild:

| Method | Path | Claim |
|---|---|---|
| GET | `/jobs` (`?kind&status&page&pageSize`) | `scheduler.view` |
| GET | `/jobs/:id` | `scheduler.view` |
| GET | `/jobs/:id/runs` | `scheduler.view` |
| POST | `/jobs/:id/pause` · `/resume` | `scheduler.pause` |
| POST | `/jobs/:id/trigger` | `scheduler.trigger` |
| DELETE | `/jobs/:id` | `scheduler.cancel` |
| GET | `/health` | `scheduler.view` |

## Layout

```
config/          Zod config (global + guild) + ENV→DB→defaults resolver
domain/          pure logic: domain-service, registry, VOs, cron util, entities
infrastructure/  ScheduleRepository (only Prisma consumer), SchedulerQueue, Worker
application/      SchedulerService (contract + impl), reconciler, maintenance, cleanup
observability/   metrics (Prometheus), tracing (OTel), audit
api/             SchedulerController + DTOs
events/          scheduler.events.ts (names + payload type)
locales/         pt/ en/ scheduler.json
```

## Notes & deferrals

- The **Queue layer** the spec references doesn't yet exist as a separate core
  system, so `SchedulerQueue` is the module-private BullMQ wrapper — still the
  only sanctioned scheduling primitive; consumers never see it.
- **Audit** (item 15) and **Metrics/OTel** (item 16) modules aren't built yet.
  `SchedulerAuditService`, `SchedulerMetrics` and `SchedulerTracing` are
  self-contained adapters (Pino audit, a private Prometheus registry, no-op OTel
  until an exporter is registered) that the future modules can absorb without
  changing callers.
- The migration `20260630170000_add_scheduler` was hand-authored (DB was offline);
  run `prisma migrate deploy` when MySQL is up.
- Dashboard e2e specs live in `src/dashboard/e2e/` and are skipped until the
  Playwright harness + seeded backend are provisioned (deferred since Phase 2).
```
