# Core

> ## Claude Instructions
> - This is the foundation layer. Everything else depends on it. Do NOT introduce module-specific
>   logic here — Core is generic infrastructure only.
> - Never modify another module. Do not change architecture decisions from `00-project.md`.
> - Keep backwards compatibility. Create Prisma migrations. Generate tests and docs.
> - Generate DTOs. Use Repository Pattern. Use the Event Bus. Use Dependency Injection.
> - No `any`. Keep methods small (<50 lines where reasonable). Follow existing naming.
> - Create indexes for searchable fields. Support pagination, caching, translations, dashboard.
> - The `BaseModule` contract defined here is law: every feature module under `src/modules/*`
>   MUST extend it and expose ONLY its public API. Modules talk via the Event Bus or published
>   contracts — never by importing another module's internal services.
> - Lifecycle ordering matters: schema/registry first, then services, then events, then commands.

---

## 1. Purpose

The Core layer is the runtime backbone of Ghost Bot. It owns the composition root of the
application: it bootstraps the NestJS process, constructs the dependency-injection container,
discovers and registers feature modules through a uniform `ModuleManifest`/`BaseModule` contract,
wires the Necord (Discord) client, exposes liveness/readiness health checks, and orchestrates the
full lifecycle from cold start to graceful shutdown.

Core deliberately contains **no business logic**. It provides the seams (Event Bus abstraction, DI
conventions, module registry, lifecycle hooks) that every feature module plugs into. If a behaviour
is specific to tickets, FiveM, moderation, etc., it does **not** belong here.

Core guarantees three properties for the rest of the system:

1. **Deterministic startup** — modules initialise in a known, dependency-respecting order.
2. **Isolation** — modules never reach into each other; they only see Core abstractions and their
   own internals.
3. **Clean shutdown** — in-flight work drains, connections close in reverse dependency order, and
   the process exits with a meaningful code.

---

## 2. Goals

- Provide a single, typed application factory (`createApp()`) usable by the HTTP server, the worker
  process, and tests, with environment-driven feature toggles.
- Define the `BaseModule` abstract class and `ModuleManifest` interface that every module under
  `src/modules/*` implements — making module shape uniform and statically checkable.
- Implement a `ModuleRegistry` that records every loaded module, its manifest, declared permission
  claims, emitted/consumed events, and health contributors.
- Expose a transport-agnostic `EventBus` abstraction (in-process + Redis fan-out via the Cache/Queue
  layers) so modules communicate without direct references.
- Wire the Necord client once, centrally, and surface its ready/disconnect state to health checks.
- Implement lifecycle hooks (`onModuleInit`, `onApplicationBootstrap`, `onApplicationShutdown`) with
  explicit ordering and per-module isolation (one module failing init must not crash the kernel
  silently — it must be reported and, where configured, fail fast).
- Provide `/health` (liveness) and `/ready` (readiness) endpoints aggregating module + dependency
  health.
- Implement graceful shutdown: stop accepting work, drain queues/HTTP, disconnect Discord, close
  DB/Redis, flush logs, exit.
- Enforce DI conventions: constructor injection, token-based providers for cross-cutting concerns,
  no service locators, no circular dependencies.

---

## 3. Architecture

Core sits beneath every module and above the runtime. It is the **composition root**: the only
place allowed to know about all modules at once. Modules know only Core, never each other.

```
                         ┌──────────────────────────────┐
                         │         Process Entry         │
                         │  src/main.ts / src/worker.ts  │
                         └───────────────┬──────────────┘
                                         │ createApp(options)
                         ┌───────────────▼──────────────┐
                         │        CoreModule (DI root)   │
                         │  Kernel · Registry · EventBus │
                         │  Necord wiring · Health · Cfg │
                         └───┬──────────┬─────────┬──────┘
                             │          │         │
        ┌────────────────────▼──┐  ┌────▼─────┐  ┌▼───────────────────┐
        │   Feature Modules     │  │  Shared  │  │  Cross-cutting CORE │
        │ src/modules/* extend  │  │ src/shared│  │ cache · db · queue │
        │     BaseModule        │  │           │  │ permissions · i18n │
        └───────────────────────┘  └──────────┘  └────────────────────┘
```

Layer flow is preserved exactly as in `00-project.md`:
`Controller -> Application Service -> Domain Service (when needed) -> Repository -> Database`.
Core provides the kernel that hosts these; it never bypasses the flow.

Key collaborators:

- **Kernel (`AppKernel`)** — orchestrates lifecycle phases and delegates to the registry.
- **ModuleRegistry** — the authoritative catalogue of loaded modules and their manifests.
- **EventBus** — abstraction over in-process emitter + Redis pub/sub (provided by the Cache layer);
  modules never touch Redis directly.
- **NecordLifecycleService** — owns the Discord client connection state.
- **HealthService** — aggregates `HealthContributor`s registered by Core systems and modules.
- **ConfigService** — resolves config with priority `ENV -> Database -> Defaults`, Zod-validated.

---

## 4. Folder Structure

```
src/core/
├── core.module.ts                      # Root DI module; imports cross-cutting core systems
├── kernel/
│   ├── app-kernel.ts                   # Lifecycle orchestrator (init/bootstrap/shutdown)
│   ├── app-factory.ts                  # createApp(options): NestApplication factory
│   ├── lifecycle.types.ts              # LifecyclePhase enum, hook contracts
│   └── shutdown.service.ts             # Graceful shutdown coordinator (signals, drain order)
├── module-system/
│   ├── base.module.ts                  # abstract BaseModule (the module contract)
│   ├── module-manifest.ts              # ModuleManifest interface + builder helpers
│   ├── module-registry.ts              # ModuleRegistry (catalogue + lookups)
│   ├── module-loader.ts                # Discovers + registers modules at bootstrap
│   └── module.decorators.ts            # @GhostModule() decorator (manifest metadata)
├── events/
│   ├── event-bus.ts                    # abstract EventBus + DomainEvent base type
│   ├── in-process-event-bus.ts         # Local synchronous/async emitter impl
│   ├── distributed-event-bus.ts        # Redis fan-out impl (via Cache layer pub/sub)
│   ├── event-envelope.ts               # Envelope: id, name, guildId, payload, meta, traceId
│   └── event-bus.module.ts             # DI wiring; picks impl by config
├── discord/
│   ├── necord.config.ts                # Necord/Discord intents, partials, token resolution
│   ├── necord-lifecycle.service.ts     # Ready/disconnect tracking, exposes health
│   └── discord-client.provider.ts      # Provides typed Client; guild-aware helpers
├── health/
│   ├── health.controller.ts            # GET /health, GET /ready
│   ├── health.service.ts               # Aggregates HealthContributors
│   ├── health-contributor.ts           # HealthContributor interface
│   └── indicators/
│       ├── discord.indicator.ts
│       ├── database.indicator.ts
│       ├── redis.indicator.ts
│       └── queue.indicator.ts
├── di/
│   ├── tokens.ts                       # Injection tokens (Symbol-based) for core abstractions
│   └── providers.ts                    # Provider factory helpers
└── index.ts                            # Public Core API barrel (what modules may import)
```

---

## 5. Public Interfaces

The following are the load-bearing contracts Core exposes. All are strict; no `any`.

```typescript
// src/core/module-system/module-manifest.ts

/** Static, declarative description of a module — known before instantiation. */
export interface ModuleManifest {
  /** Unique, kebab-case module id, e.g. "tickets", "fivem". */
  readonly id: string;
  /** Human-readable name for dashboards/logs. */
  readonly name: string;
  /** Semantic version of the module contract. */
  readonly version: string;
  /** Other module ids that must initialise before this one. */
  readonly dependsOn: readonly string[];
  /** Permission claims this module defines (e.g. "tickets.create", "fivem.*"). */
  readonly permissions: readonly string[];
  /** Event names this module emits. */
  readonly emits: readonly string[];
  /** Event names this module consumes. */
  readonly consumes: readonly string[];
  /** i18n namespaces this module owns. */
  readonly i18nNamespaces: readonly string[];
  /** Whether the module is guild-scoped (default true) or global. */
  readonly guildScoped: boolean;
}
```

```typescript
// src/core/module-system/base.module.ts
import type { ModuleManifest } from './module-manifest';
import type { HealthContributor } from '../health/health-contributor';
import type { LifecycleContext } from '../kernel/lifecycle.types';

/**
 * The contract EVERY feature module under src/modules/* MUST extend.
 * Core only ever interacts with modules through this surface.
 */
export abstract class BaseModule {
  /** Declarative manifest; must be a pure constant. */
  abstract readonly manifest: ModuleManifest;

  /** Called once after DI graph is constructed; register listeners, warm caches. */
  abstract onRegister(ctx: LifecycleContext): Promise<void>;

  /** Called after ALL modules registered; safe to use other modules' public APIs. */
  onBootstrap?(ctx: LifecycleContext): Promise<void>;

  /** Called on shutdown in reverse registration order; release resources. */
  onShutdown?(ctx: LifecycleContext): Promise<void>;

  /** Optional health contributor merged into /health and /ready. */
  healthContributor?(): HealthContributor;
}
```

```typescript
// src/core/kernel/lifecycle.types.ts
import type { EventBus } from '../events/event-bus';
import type { ModuleRegistry } from '../module-system/module-registry';
import type { Logger } from 'pino';

export enum LifecyclePhase {
  Constructed = 'constructed',
  Registered = 'registered',
  Bootstrapped = 'bootstrapped',
  Running = 'running',
  ShuttingDown = 'shutting_down',
  Stopped = 'stopped',
}

/** Handed to every lifecycle hook; gives modules typed access to Core seams. */
export interface LifecycleContext {
  readonly eventBus: EventBus;
  readonly registry: ModuleRegistry;
  readonly logger: Logger;
  readonly phase: LifecyclePhase;
}
```

```typescript
// src/core/events/event-bus.ts

/** Base shape for every domain event flowing through the bus. */
export interface DomainEvent<TPayload = unknown> {
  readonly name: string;
  /** Guild scope; null for global events only. */
  readonly guildId: string | null;
  readonly payload: TPayload;
  /** Set by the bus: correlation/trace id, timestamp, source module. */
  readonly meta: EventMeta;
}

export interface EventMeta {
  readonly eventId: string;
  readonly traceId: string;
  readonly occurredAt: string; // ISO-8601
  readonly source: string; // module id
}

export type EventHandler<TPayload> = (
  event: DomainEvent<TPayload>,
) => Promise<void> | void;

export interface Unsubscribe {
  (): void;
}

/** Transport-agnostic event bus. Modules depend on THIS, never on Redis. */
export abstract class EventBus {
  abstract emit<TPayload>(
    name: string,
    payload: TPayload,
    options: { guildId: string | null; source: string },
  ): Promise<void>;

  abstract on<TPayload>(name: string, handler: EventHandler<TPayload>): Unsubscribe;

  abstract once<TPayload>(name: string, handler: EventHandler<TPayload>): Unsubscribe;
}
```

```typescript
// src/core/module-system/module-registry.ts
import type { BaseModule } from './base.module';
import type { ModuleManifest } from './module-manifest';

export interface RegisteredModule {
  readonly instance: BaseModule;
  readonly manifest: ModuleManifest;
  readonly registeredAt: Date;
}

export abstract class ModuleRegistry {
  abstract register(module: BaseModule): void;
  abstract get(id: string): RegisteredModule | undefined;
  abstract all(): readonly RegisteredModule[];
  /** Topologically ordered by manifest.dependsOn. Throws on cycle. */
  abstract resolveInitOrder(): readonly RegisteredModule[];
  abstract allPermissionClaims(): readonly string[];
}
```

```typescript
// src/core/health/health-contributor.ts
export type HealthState = 'up' | 'down' | 'degraded';

export interface HealthCheckResult {
  readonly state: HealthState;
  readonly detail?: Readonly<Record<string, string | number | boolean>>;
}

export interface HealthContributor {
  readonly name: string;
  check(): Promise<HealthCheckResult>;
}
```

---

## 6. Events

Core defines kernel-level lifecycle events. Feature-domain events are owned by their modules; Core
only provides the bus and emits its own operational events.

**Emitted by Core:**

| Event name | Payload | When |
| --- | --- | --- |
| `core.module.registered` | `{ moduleId: string; version: string }` | After a module's `onRegister` succeeds |
| `core.bootstrap.completed` | `{ moduleCount: number; durationMs: number }` | All modules bootstrapped |
| `core.shutdown.started` | `{ reason: string; signal?: string }` | Shutdown initiated |
| `core.discord.ready` | `{ shardCount: number; guildCount: number }` | Necord client ready |
| `core.discord.disconnected` | `{ code: number; willReconnect: boolean }` | Discord connection dropped |
| `core.health.degraded` | `{ contributor: string; detail: HealthCheckResult }` | A contributor flips off `up` |

**Consumed by Core:** none from feature modules (Core must not depend on module events). Core only
listens internally to its own Necord client signals which it republishes as the events above.

```typescript
// Example payload contract for a Core event
export interface DiscordReadyPayload {
  readonly shardCount: number;
  readonly guildCount: number;
}
```

All events carry the standard `EventMeta` (eventId, traceId, occurredAt, source=`core`).

---

## 7. Dependencies

Core depends only on cross-cutting CORE systems and the runtime — **never** on a feature module.

| Core system | How Core uses it |
| --- | --- |
| **Config** | `ConfigService` resolves `ENV -> Database -> Defaults`, Zod-validated; Core reads token, intents, feature flags, shutdown timeouts. |
| **Cache** | The `DistributedEventBus` uses the Cache layer's Redis pub/sub; Core never opens its own Redis client. |
| **Events** | Core *owns* the `EventBus` abstraction itself; modules consume it. |
| **Database** | Core reads `Module` registry state via a repository; never touches Prisma directly outside repositories. |
| **Queue** | `ShutdownService` asks BullMQ to pause/drain workers; Core does not enqueue domain jobs. |
| **Permissions** | Core collects each module's declared claims from manifests and hands them to the Permissions system for registration. |
| **Logging (Pino)** | Core creates the root logger and child loggers per module. |
| **i18n** | Core registers each module's declared `i18nNamespaces`. |

Core depends on **no** `src/modules/*` package. This is enforced by an ESLint import-boundary rule.

---

## 8. Configuration

Core configuration is global (not guild-scoped) — it governs the process itself. Guild-scoped
settings belong to feature modules. All values validated with Zod; priority `ENV -> Database ->
Defaults`.

```typescript
// src/core/kernel/core.config.ts
import { z } from 'zod';

export const coreConfigSchema = z.object({
  // Discord
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_DEV_GUILD_ID: z.string().optional(),

  // Lifecycle
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  BOOTSTRAP_FAIL_FAST: z.coerce.boolean().default(true),

  // Health
  HEALTH_READY_GRACE_MS: z.coerce.number().int().nonnegative().default(5_000),

  // Event bus
  EVENT_BUS_DRIVER: z.enum(['in-process', 'distributed']).default('distributed'),

  // Runtime
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HTTP_PORT: z.coerce.number().int().positive().default(3000),
});

export type CoreConfig = z.infer<typeof coreConfigSchema>;
```

| Setting | Scope | Default | Notes |
| --- | --- | --- | --- |
| `EVENT_BUS_DRIVER` | global | `distributed` | `in-process` for single-instance/tests |
| `SHUTDOWN_TIMEOUT_MS` | global | `15000` | Hard cap before forced exit |
| `BOOTSTRAP_FAIL_FAST` | global | `true` | If false, failed module is skipped + reported |
| `HEALTH_READY_GRACE_MS` | global | `5000` | `/ready` returns 503 until grace elapses post-bootstrap |

---

## 9. Database

Core owns one small registry/audit model so module load state survives restarts and feeds the
dashboard. Feature data lives in the modules. Soft-delete is **not** used for the registry (records
are upserted, not deleted), but lifecycle transitions are append-only in `ModuleLifecycleEvent`.

```prisma
// prisma/schema.prisma (Core additions)

model ModuleRegistration {
  id            String   @id @default(cuid())
  moduleId      String   @unique          // matches ModuleManifest.id
  name          String
  version       String
  enabled       Boolean  @default(true)
  guildScoped   Boolean  @default(true)
  permissions   Json                      // string[] of claims
  emits         Json                      // string[]
  consumes      Json                      // string[]
  lastBootAt    DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  lifecycle     ModuleLifecycleEvent[]

  @@index([enabled])
  @@index([moduleId])
}

model ModuleLifecycleEvent {
  id             String              @id @default(cuid())
  registrationId String
  phase          String              // LifecyclePhase value
  detail         String?
  traceId        String
  occurredAt     DateTime            @default(now())

  registration   ModuleRegistration  @relation(fields: [registrationId], references: [id], onDelete: Cascade)

  @@index([registrationId])
  @@index([phase])
  @@index([occurredAt])
}
```

- `ModuleRegistration` is upserted on each `onRegister` (idempotent by `moduleId`).
- `ModuleLifecycleEvent` is append-only audit; queried by the dashboard with pagination + caching.
- All reads/writes go through a `ModuleRegistrationRepository` — Core code never calls Prisma directly.

---

## 10. API

Core exposes only operational endpoints. They are unauthenticated probes (kept free of internal
detail) plus an authenticated introspection endpoint for the dashboard.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/health` | none | Liveness. Returns 200 while the process is alive. |
| `GET` | `/ready` | none | Readiness. 200 only when all critical contributors are `up` and grace elapsed; else 503. |
| `GET` | `/api/core/modules` | dashboard JWT | Lists registered modules + manifests (paginated). |

```typescript
// src/core/health/dto/health-response.dto.ts
export class HealthResponseDto {
  status!: 'ok' | 'degraded' | 'error';
  contributors!: ReadonlyArray<{
    name: string;
    state: 'up' | 'down' | 'degraded';
    detail?: Record<string, string | number | boolean>;
  }>;
  uptimeSeconds!: number;
}

// src/core/module-system/dto/module-list.dto.ts
export class ModuleListItemDto {
  moduleId!: string;
  name!: string;
  version!: string;
  enabled!: boolean;
  guildScoped!: boolean;
  permissions!: string[];
  emits!: string[];
  consumes!: string[];
  lastBootAt!: string | null;
}

export class ModuleListQueryDto {
  page: number = 1;
  pageSize: number = 25;
  enabledOnly?: boolean;
}
```

Swagger: `/health` and `/ready` are tagged `core/health` and documented as probes (note: returns
503 with no body detail when not ready, to avoid leaking internals to external probers). `/api/core/modules`
is tagged `core/modules` with paginated response schema.

---

## 11. Permissions

Core defines a small set of operational claims. Feature claims come from each module's manifest;
Core *aggregates and registers* them but does not own them.

| Claim | Grants |
| --- | --- |
| `core.modules.read` | View the module registry in the dashboard / via `/api/core/modules`. |
| `core.health.read` | View detailed health (the unauthenticated probes stay minimal). |
| `core.lifecycle.audit` | Read `ModuleLifecycleEvent` history. |

Core registers all module-declared claims (including wildcards like `tickets.*`, `fivem.restart`)
with the Permissions system at bootstrap by reading every `manifest.permissions`. Duplicate or
conflicting claim definitions across modules are detected here and fail bootstrap (or are logged as
`core.health.degraded` if `BOOTSTRAP_FAIL_FAST=false`).

---

## 12. Logging

Core creates the **root Pino logger** and hands each module a child logger bound to
`{ module: manifest.id }`. Trace ids (OpenTelemetry) propagate through `EventMeta.traceId`.

| Category | Examples |
| --- | --- |
| `core.lifecycle` | phase transitions, per-module init duration, init failures |
| `core.module` | registration, manifest validation results, claim aggregation |
| `core.discord` | client ready, reconnect, shard events, disconnect codes |
| `core.health` | contributor state changes, readiness flips |
| `core.shutdown` | signal received, drain progress, forced-exit warnings |

Audit hooks: every lifecycle transition writes a `ModuleLifecycleEvent` (append-only) and emits a
log line at `info`. Init failures log at `error` with the module id, stack, and trace id — but never
leak secrets (token is redacted by a Pino serializer). Health degradation emits
`core.health.degraded` and logs at `warn`.

---

## 13. Testing

Core is the most heavily tested layer because every module relies on its guarantees.

- **Unit (Vitest)**
  - `ModuleRegistry.resolveInitOrder()` — topological sort correctness; throws on cycles; respects
    `dependsOn`.
  - `EventBus` — `emit`/`on`/`once`/unsubscribe semantics; envelope/meta population; in-process vs
    distributed driver selection.
  - `coreConfigSchema` — valid/invalid env parsing, defaults, `ENV -> DB -> Defaults` precedence.
  - `HealthService` — aggregation across contributors; `degraded` vs `down` rollup rules.
  - `ShutdownService` — drain ordering (reverse of init), timeout/forced-exit path.
- **Integration**
  - Boot a real `CoreModule` with two fake modules (A depends on B); assert init order, lifecycle
    events persisted, claims aggregated, registry populated.
  - `/health` returns 200 always-alive; `/ready` returns 503 during grace then 200.
  - Necord lifecycle: mock client ready/disconnect → assert `core.discord.*` events emitted.
- **e2e (Playwright/Supertest)**
  - Probe endpoints behave correctly behind the HTTP server.
  - Dashboard `/api/core/modules` pagination + auth.
- **Coverage targets**: Core ≥ 90% line/branch — it is foundational.

---

## 14. Dashboard Integration

The dashboard surfaces Core's operational view (gated by `core.modules.read` /
`core.lifecycle.audit`):

- **Modules panel** — table of registered modules (id, name, version, enabled, guildScoped,
  emits/consumes counts, last boot time). Paginated, cached, translated.
- **Lifecycle timeline** — per-module `ModuleLifecycleEvent` history with phase badges and trace ids.
- **Health widget** — live `/health` and `/ready` status with per-contributor state and detail.
- **Discord status** — shard count, guild count, last ready/disconnect from `core.discord.*` events.
- **Enable/disable toggle** — flips `ModuleRegistration.enabled` (takes effect on next boot; emits an
  audit event). The toggle calls the Application Service, never Prisma.

---

## 15. Future Extensions

- **Hot module reload** — `onShutdown` + `onRegister` re-run for a single module without full restart.
- **Per-shard kernels** — run dedicated kernel instances per Discord shard for very large fleets.
- **Plugin sandbox** — load `src/plugins/*` (third-party) through a restricted `BaseModule` variant
  with capability-scoped `LifecycleContext`.
- **Distributed readiness gossip** — cross-instance readiness aggregation via the Cache layer.
- **Manifest-driven dependency injection** — auto-wire declared dependencies from manifest metadata.
- **Outbox pattern** — transactional event publishing tied to DB commits for at-least-once delivery.

---

## 16. Tasks for Claude

Execute in order; each phase ends with a focused commit on a `feature/core/*` branch.

1. **Schema** — Add `ModuleRegistration` + `ModuleLifecycleEvent` to `prisma/schema.prisma`; create
   migration; generate client; add `ModuleRegistrationRepository` (Repository Pattern, no Prisma
   leakage).
2. **Config** — Implement `coreConfigSchema` + `CoreConfigService` with `ENV -> DB -> Defaults`
   resolution and Zod validation; redact secrets.
3. **Module system** — Implement `ModuleManifest`, `@GhostModule()` decorator, abstract `BaseModule`,
   `ModuleRegistry` (with topo sort + cycle detection), and `ModuleLoader`.
4. **Event Bus** — Implement abstract `EventBus`, `InProcessEventBus`, `DistributedEventBus` (via
   Cache pub/sub), envelope/meta population, driver selection by config.
5. **Kernel & lifecycle** — Implement `AppKernel` (phases), `app-factory.ts` `createApp()`,
   `LifecycleContext`, per-module isolation + fail-fast handling, lifecycle audit writes.
6. **Discord wiring** — Implement `necord.config.ts`, `discord-client.provider.ts`,
   `NecordLifecycleService`; republish ready/disconnect as `core.discord.*` events.
7. **Health** — Implement `HealthContributor`, `HealthService`, indicators (discord/db/redis/queue),
   `HealthController` (`/health`, `/ready` with grace).
8. **API** — Implement `/api/core/modules` controller + Application Service + DTOs + Swagger; enforce
   `core.modules.read`.
9. **Permissions/i18n registration** — Aggregate manifest claims + namespaces at bootstrap; register
   with Permissions and i18n; detect duplicates.
10. **Shutdown** — Implement `ShutdownService`: signal handlers, drain order (HTTP → Discord → queues
    → cache → db), timeout/forced exit, `core.shutdown.*` events.
11. **Tests** — Unit + integration + e2e per section 13; reach ≥90% coverage.
12. **Docs** — Update module-author guide describing the `BaseModule` contract and lifecycle hooks.

---

## 17. Acceptance Criteria

- [ ] `createApp()` boots HTTP, worker, and test profiles from the same factory.
- [ ] Every fake test module extending `BaseModule` is discovered, registered, and recorded in
      `ModuleRegistration`.
- [ ] `ModuleRegistry.resolveInitOrder()` returns a valid topological order and throws on cycles.
- [ ] Module init runs in dependency order; `onBootstrap` runs only after all `onRegister` complete.
- [ ] A failing module honours `BOOTSTRAP_FAIL_FAST`: aborts boot when `true`, is skipped + reported
      when `false`.
- [ ] `EventBus.emit/on/once/unsubscribe` work for both `in-process` and `distributed` drivers; every
      event carries populated `EventMeta` (eventId, traceId, occurredAt, source).
- [ ] Necord client connects; `core.discord.ready`/`core.discord.disconnected` are emitted and feed
      health.
- [ ] `GET /health` returns 200 while alive; `GET /ready` returns 503 during grace / when a critical
      contributor is `down`, and 200 otherwise.
- [ ] All module permission claims (including wildcards) are registered with the Permissions system;
      duplicates are detected.
- [ ] Graceful shutdown drains in reverse order within `SHUTDOWN_TIMEOUT_MS`, then forces exit with a
      logged warning.
- [ ] No Core file imports anything under `src/modules/*` (enforced by ESLint boundary rule).
- [ ] No `any`; TypeScript strict passes.

---

## 18. Definition of Done

- [ ] All Acceptance Criteria checked.
- [ ] Prisma migration created and applied; `prisma generate` run; repository in place.
- [ ] Unit + integration + e2e tests pass; Core coverage ≥ 90%.
- [ ] ESLint + Prettier clean; import-boundary rule for Core verified; Husky/Commitlint pass.
- [ ] Swagger/OpenAPI updated for `/health`, `/ready`, `/api/core/modules`.
- [ ] Pino logging categories implemented; token redaction verified; OpenTelemetry trace ids
      propagate through `EventMeta`.
- [ ] Module-author documentation for `BaseModule`/lifecycle written.
- [ ] Conventional Commits used; branch `feature/core/*`; no direct commits to `main`; PR opened
      against `develop` with description and checklist.
