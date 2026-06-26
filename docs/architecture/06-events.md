# Event Bus

> ## Claude Instructions
> - Never modify another module. Do not change architecture decisions from `00-project.md`. The Event Bus is a CORE system under `src/core/events` — treat it as foundational infrastructure that every module depends on but that depends on no module.
> - Keep backwards compatibility. The typed event map is append-only: never rename or repurpose an existing event key without a migration plan and a deprecation window.
> - Create Prisma migrations for the `EventLog` and `EventDeadLetter` models. Generate tests and docs.
> - Generate DTOs for every API endpoint. Use the Repository Pattern for all event persistence. Use Dependency Injection everywhere. Never let a module touch Prisma, Redis, or BullMQ directly — those go through the Repository, Cache, and Queue layers respectively.
> - No `any`. Every event payload is described by a strict interface registered in the typed event map. Keep methods small (<50 lines where reasonable). Follow existing naming.
> - Create indexes for searchable fields (`eventName`, `guildId`, `correlationId`, `status`). Support pagination, caching, translations (for user-facing error surfaces), and dashboard.
> - Discord gateway events from Necord MUST be bridged into the bus, never consumed directly by feature modules.

---

## 1. Purpose

The Event Bus is Ghost Bot's internal, strongly-typed, event-driven backbone. It is the **only** sanctioned channel through which independent modules communicate. A module never imports another module's internal services; instead it publishes a typed event and any number of subscribers react to it.

The Event Bus solves four problems at once:

1. **Decoupling** — `tickets` can react to a `moderation.ban.executed` event without ever importing the `moderation` module.
2. **Type safety** — every event has a compile-time-checked payload contract through a central typed event map. There is no stringly-typed `emit('something', anyPayload)`.
3. **Durability** — events can run **synchronously** (in-process, awaited, transactional-ish) or **asynchronously** (BullMQ-backed, retried, dead-lettered, replayable).
4. **Observability** — every published event is wrapped in an `EventEnvelope<T>` carrying correlation/causation IDs, timestamps, guild scope, and an actor, enabling tracing, audit, and replay.

This document defines the `EventBus` abstraction, the `EventEnvelope<T>` shape, the typed `GhostEventMap`, the naming convention (`module.entity.action`), idempotency and replay semantics, dead-lettering, and the Necord Discord-gateway bridge.

## 2. Goals

- **One bus, two transports.** A single `EventBus.publish()` API that routes to a synchronous in-process dispatcher or an asynchronous BullMQ-backed dispatcher based on per-event policy.
- **Compile-time payload safety.** `EventBus.publish('moderation.ban.executed', payload)` must fail to compile if `payload` does not match the registered contract. Subscribers receive a fully-typed `EventEnvelope<GhostEventMap['moderation.ban.executed']>`.
- **Guild-aware by default.** Every envelope carries a `guildId` (or is explicitly flagged `global`). Subscribers can filter by guild.
- **Idempotent consumption.** Async handlers can be made idempotent via a deduplication key so retries and replays never double-apply side effects.
- **Replay & dead-letter.** Failed async events land in a DLQ; operators can inspect, replay, or discard them. Persisted events can be replayed into the bus for recovery or backfill.
- **Necord bridge.** Raw Discord gateway events (`guildMemberAdd`, `messageDelete`, `interactionCreate`, …) are normalised into `discord.*` bus events so modules never bind to the gateway directly.
- **Zero module-to-module imports.** Enforced by the architecture; the bus is the seam.

## 3. Architecture

The Event Bus sits in CORE and is consumed by all modules. It honours the strict layer flow: a Controller or Application Service calls `EventBus.publish()`; subscribers are Application Services (or dedicated event handlers) which then call Domain Services and Repositories.

```
                         ┌─────────────────────────────────────────────┐
   Discord Gateway       │                  EventBus                    │
   (Necord)              │                                              │
      │                  │   publish<K>(name, payload, opts): envelope  │
      ▼                  │   subscribe<K>(name, handler): Subscription  │
 ┌──────────────┐  bridge│                                              │
 │ DiscordBridge│───────▶│  ┌──────────────┐    ┌────────────────────┐  │
 └──────────────┘        │  │ SyncDispatch │    │   AsyncDispatch    │  │
                         │  │ (in-process) │    │  (BullMQ producer) │  │
 Modules ───publish─────▶│  └──────┬───────┘    └─────────┬──────────┘  │
 (App Services)          │         │                      │             │
                         └─────────┼──────────────────────┼─────────────┘
                                   │                       │
                          synchronous handlers      ┌──────▼───────┐
                          (awaited, ordered)        │  BullMQ queue │
                                                    │  ghost.events │
                                                    └──────┬────────┘
                                                           │ worker
                                                    ┌──────▼───────┐
                                                    │ AsyncHandlers│──▶ retries ──▶ DLQ
                                                    └──────┬───────┘
                                                           │
                              ┌────────────────────────────▼──────────────┐
                              │ EventLogRepository / DeadLetterRepository  │ (Prisma)
                              └────────────────────────────────────────────┘
```

**Sync vs Async policy.** Each event key declares a `delivery` policy in the registry:

- `sync` — handlers run in-process within the publisher's call stack, awaited in registration order. Used for low-latency, in-transaction reactions (e.g. cache invalidation, validation hooks). Failures propagate to the publisher.
- `async` — the envelope is enqueued to BullMQ (`ghost.events` queue) and handled by a worker with retries/backoff and DLQ. Used for side-effects that may be slow, externally-dependent, or must survive a crash (e.g. send a webhook, write an audit row, notify another module).
- `both` — sync fan-out for in-process subscribers **and** enqueue for durable subscribers. Used for high-value domain events.

**Persistence.** Async (and `both`) events are persisted via `EventLogRepository` before enqueue, giving an at-least-once durable log usable for replay and audit.

## 4. Folder Structure

```
src/core/events/
├── event-bus.module.ts            # NestJS module wiring DI (global module)
├── event-bus.ts                   # EventBus abstract class (public interface)
├── event-bus.service.ts           # Concrete implementation
├── dispatchers/
│   ├── sync.dispatcher.ts         # In-process synchronous fan-out
│   └── async.dispatcher.ts        # BullMQ producer + worker registration
├── envelope/
│   ├── event-envelope.ts          # EventEnvelope<T> + factory
│   └── correlation.context.ts     # AsyncLocalStorage correlation/causation context
├── registry/
│   ├── event-map.ts               # GhostEventMap (the typed event map)
│   ├── event-names.ts             # EventName union + naming helpers
│   ├── event-policy.ts            # Per-event delivery/idempotency policy table
│   └── payloads/                  # One file per module's payload contracts
│       ├── discord.payloads.ts
│       ├── moderation.payloads.ts
│       ├── tickets.payloads.ts
│       └── ...
├── discord/
│   ├── discord-bridge.service.ts  # Necord gateway -> bus normalisation
│   └── discord-gateway.map.ts     # Maps gateway event -> discord.* key
├── idempotency/
│   └── idempotency.guard.ts       # Dedup via Cache layer
├── replay/
│   └── event-replay.service.ts    # Replays persisted events into the bus
├── repositories/
│   ├── event-log.repository.ts        # abstract
│   ├── event-log.prisma.repository.ts # only file touching Prisma here
│   ├── dead-letter.repository.ts
│   └── dead-letter.prisma.repository.ts
├── workers/
│   └── events.processor.ts        # BullMQ @Processor for ghost.events
├── handlers/
│   └── event-handler.decorator.ts # @OnEvent('module.entity.action')
└── dto/
    ├── event-log.dto.ts
    ├── dead-letter.dto.ts
    ├── replay-request.dto.ts
    └── list-events-query.dto.ts
```

## 5. Public Interfaces

```typescript
// envelope/event-envelope.ts
import type { EventName, GhostEventMap } from '../registry/event-map';

/** Who/what triggered the event. */
export interface EventActor {
  readonly type: 'user' | 'system' | 'discord' | 'job' | 'api';
  /** Discord user id, system component name, or job id. */
  readonly id: string;
  readonly username?: string;
}

/**
 * The strongly-typed wrapper around every event flowing through the bus.
 * T is the payload type pulled from GhostEventMap for the given key.
 */
export interface EventEnvelope<K extends EventName = EventName> {
  /** UUID v4 unique to this envelope. */
  readonly id: string;
  /** The event name, e.g. "moderation.ban.executed". */
  readonly name: K;
  /** Typed payload contract for this event. */
  readonly payload: GhostEventMap[K];
  /** Guild scope. null => global event (not guild-bound). */
  readonly guildId: string | null;
  /** Actor that caused this event. */
  readonly actor: EventActor;
  /** ISO-8601 creation time. */
  readonly occurredAt: string;
  /** Correlation id shared across a causal chain (for tracing). */
  readonly correlationId: string;
  /** Id of the envelope that directly caused this one, if any. */
  readonly causationId: string | null;
  /** Schema version of the payload contract; default 1. */
  readonly version: number;
  /** Optional dedup key for idempotent async handling. */
  readonly idempotencyKey?: string;
  /** Arbitrary, non-PII trace metadata (OpenTelemetry span ids, etc.). */
  readonly meta?: Readonly<Record<string, string | number | boolean>>;
}
```

```typescript
// event-bus.ts
import type { EventName, GhostEventMap } from './registry/event-map';
import type { EventEnvelope, EventActor } from './envelope/event-envelope';

export interface PublishOptions {
  readonly guildId?: string | null;
  readonly actor?: EventActor;
  readonly correlationId?: string;
  readonly causationId?: string | null;
  readonly idempotencyKey?: string;
  readonly version?: number;
  readonly meta?: Readonly<Record<string, string | number | boolean>>;
  /** Override the registry delivery policy for this single publish. */
  readonly deliveryOverride?: 'sync' | 'async' | 'both';
}

export type EventHandler<K extends EventName> = (
  envelope: EventEnvelope<K>,
) => void | Promise<void>;

export interface Subscription {
  /** Stable handler id (module-qualified, e.g. "tickets:onBan"). */
  readonly handlerId: string;
  unsubscribe(): void;
}

export interface SubscribeOptions {
  /** Unique within (eventName); used as the BullMQ consumer group / dedup. */
  readonly handlerId: string;
  /** Only receive events for this guild. Omit for all guilds. */
  readonly guildId?: string;
  /** Force this subscriber onto the async transport even if event is sync. */
  readonly durable?: boolean;
}

/**
 * The CORE Event Bus. The single seam through which modules communicate.
 * Modules MUST depend on this abstract class, never on a concrete impl.
 */
export abstract class EventBus {
  /** Publish a typed event. Returns the created envelope. */
  abstract publish<K extends EventName>(
    name: K,
    payload: GhostEventMap[K],
    options?: PublishOptions,
  ): Promise<EventEnvelope<K>>;

  /** Subscribe a handler to a typed event. */
  abstract subscribe<K extends EventName>(
    name: K,
    handler: EventHandler<K>,
    options: SubscribeOptions,
  ): Subscription;

  /** Publish many events sharing one correlation id, in order. */
  abstract publishBatch(
    events: ReadonlyArray<{
      readonly name: EventName;
      readonly payload: GhostEventMap[EventName];
      readonly options?: PublishOptions;
    }>,
  ): Promise<ReadonlyArray<EventEnvelope>>;
}
```

```typescript
// registry/event-map.ts
import type { DiscordEventPayloads } from './payloads/discord.payloads';
import type { ModerationEventPayloads } from './payloads/moderation.payloads';
import type { TicketEventPayloads } from './payloads/tickets.payloads';

/**
 * THE typed event map. Append-only. Each key is "module.entity.action".
 * The union of all keys is the EventName type used everywhere.
 */
export interface GhostEventMap
  extends DiscordEventPayloads,
    ModerationEventPayloads,
    TicketEventPayloads {}

export type EventName = keyof GhostEventMap & string;
```

```typescript
// registry/payloads/moderation.payloads.ts
export interface ModerationBanExecutedPayload {
  readonly caseId: string;
  readonly targetUserId: string;
  readonly moderatorUserId: string;
  readonly reason: string | null;
  readonly deleteMessageSeconds: number;
  readonly expiresAt: string | null; // null => permanent
}

export interface ModerationWarnIssuedPayload {
  readonly caseId: string;
  readonly targetUserId: string;
  readonly moderatorUserId: string;
  readonly reason: string;
  readonly points: number;
}

export interface ModerationEventPayloads {
  'moderation.ban.executed': ModerationBanExecutedPayload;
  'moderation.warn.issued': ModerationWarnIssuedPayload;
}
```

```typescript
// registry/payloads/discord.payloads.ts
export interface DiscordMemberJoinedPayload {
  readonly userId: string;
  readonly username: string;
  readonly joinedAt: string;
  readonly isBot: boolean;
}

export interface DiscordMessageDeletedPayload {
  readonly messageId: string;
  readonly channelId: string;
  readonly authorId: string | null;
  readonly contentHash: string | null; // never store raw content here
}

export interface DiscordEventPayloads {
  'discord.member.joined': DiscordMemberJoinedPayload;
  'discord.message.deleted': DiscordMessageDeletedPayload;
}
```

```typescript
// handlers/event-handler.decorator.ts
import type { EventName } from '../registry/event-map';

/**
 * Declarative subscription. Applied to a method of an Application Service.
 * The bootstrap scans these and registers them with the EventBus.
 */
export function OnEvent<K extends EventName>(
  name: K,
  options?: { readonly handlerId?: string; readonly durable?: boolean },
): MethodDecorator {
  return Reflect.metadata('ghost:on-event', { name, options });
}
```

## 6. Events

The Event Bus **defines no domain events of its own**; it is the carrier. It does, however, emit a small set of meta/observability events and consumes the entire bus surface.

**Emitted (meta events — registered in `GhostEventMap` under `events.*`):**

```typescript
export interface EventsEventPayloads {
  'events.handler.failed': {
    readonly envelopeId: string;
    readonly eventName: string;
    readonly handlerId: string;
    readonly attempt: number;
    readonly errorCode: string;
    readonly willRetry: boolean;
  };
  'events.deadletter.created': {
    readonly deadLetterId: string;
    readonly envelopeId: string;
    readonly eventName: string;
    readonly handlerId: string;
    readonly attempts: number;
  };
  'events.replay.completed': {
    readonly replayId: string;
    readonly count: number;
    readonly requestedBy: string;
  };
}
```

**Consumed:** every event in `GhostEventMap` flows through the bus; the Discord bridge additionally **produces** all `discord.*` events from the Necord gateway. The async dispatcher's worker consumes envelopes off the `ghost.events` BullMQ queue.

**Payload shape on the wire:** always an `EventEnvelope<K>` (see §5). Async transport serialises the envelope to JSON as the BullMQ job data; the worker rehydrates and re-validates it before dispatch.

## 7. Dependencies

The Event Bus relies only on CORE systems — never on a feature module.

| CORE system | Usage |
|-------------|-------|
| **Queue (BullMQ)** | Async/`both` events are enqueued to the `ghost.events` queue. Retries, backoff, and DLQ are queue-level features. The bus uses the Queue layer wrapper, never `bullmq` directly in handlers. |
| **Cache (memory + Redis)** | Idempotency dedup keys are stored via the Cache layer under the `events:idem` namespace with TTL. No direct Redis access. |
| **Database (Prisma via Repository)** | `EventLogRepository` and `DeadLetterRepository` persist envelopes and DLQ entries. Only `*.prisma.repository.ts` files touch Prisma. |
| **Config** | Delivery policy defaults, retry counts, TTLs, and replay caps are Zod-validated config (ENV -> DB -> defaults). |
| **Permissions** | The replay/DLQ API endpoints are gated by `events.*` claims. |
| **Logging (Pino) + OpenTelemetry** | Every publish/dispatch is logged and traced; `correlationId` maps to a trace. |
| **Necord** | Source of raw Discord gateway events for the bridge (CORE-level, not a module). |

Modules depend on the Event Bus; the Event Bus depends on no module. This keeps the dependency graph acyclic.

## 8. Configuration

Guild-scoped and global settings, all Zod-validated, following ENV -> Database -> Defaults priority.

```typescript
import { z } from 'zod';

/** Global (bot-wide) Event Bus config. */
export const eventBusGlobalConfigSchema = z.object({
  queueName: z.string().default('ghost.events'),
  defaultDelivery: z.enum(['sync', 'async', 'both']).default('async'),
  async: z.object({
    attempts: z.number().int().min(1).max(20).default(5),
    backoffType: z.enum(['fixed', 'exponential']).default('exponential'),
    backoffDelayMs: z.number().int().min(100).default(2_000),
    removeOnCompleteCount: z.number().int().min(0).default(1_000),
  }),
  idempotency: z.object({
    enabled: z.boolean().default(true),
    ttlSeconds: z.number().int().min(60).default(86_400), // 24h
    namespace: z.string().default('events:idem'),
  }),
  persistence: z.object({
    /** Persist async/both events to EventLog for replay/audit. */
    enabled: z.boolean().default(true),
    /** Soft-delete log rows older than N days (job-driven). */
    retentionDays: z.number().int().min(1).default(30),
  }),
  replay: z.object({
    maxBatch: z.number().int().min(1).max(10_000).default(500),
  }),
});

/** Per-guild overrides (a guild may opt specific events into durable delivery). */
export const eventBusGuildConfigSchema = z.object({
  guildId: z.string(),
  forceDurableEvents: z.array(z.string()).default([]),
  mutedEvents: z.array(z.string()).default([]), // bridge events to drop for this guild
});

export type EventBusGlobalConfig = z.infer<typeof eventBusGlobalConfigSchema>;
export type EventBusGuildConfig = z.infer<typeof eventBusGuildConfigSchema>;
```

The per-event **delivery/idempotency policy** lives in code (it is a contract, not runtime config), but guilds may force events into durable mode via `forceDurableEvents` or suppress noisy bridge events via `mutedEvents`.

## 9. Database

Two Prisma models. Both use soft-delete (`deletedAt`) so audit history is never hard-removed by routine retention jobs.

```prisma
model EventLog {
  id             String    @id @default(uuid())
  envelopeId     String    @unique
  eventName      String
  guildId        String?
  actorType      String
  actorId        String
  payload        Json
  correlationId  String
  causationId    String?
  version        Int       @default(1)
  delivery       String    // sync | async | both
  status         String    @default("published") // published | dispatched | failed
  occurredAt     DateTime
  createdAt      DateTime  @default(now())
  deletedAt      DateTime?

  deadLetters    EventDeadLetter[]

  @@index([eventName])
  @@index([guildId])
  @@index([correlationId])
  @@index([status])
  @@index([occurredAt])
  @@map("event_logs")
}

model EventDeadLetter {
  id            String    @id @default(uuid())
  envelopeId    String
  eventName     String
  guildId       String?
  handlerId     String
  payload       Json
  attempts      Int
  lastError     String    @db.Text
  errorCode     String
  status        String    @default("pending") // pending | replayed | discarded
  createdAt     DateTime  @default(now())
  replayedAt    DateTime?
  deletedAt     DateTime?

  eventLog      EventLog? @relation(fields: [envelopeId], references: [envelopeId])

  @@index([eventName])
  @@index([handlerId])
  @@index([status])
  @@index([guildId])
  @@map("event_dead_letters")
}
```

Notes:
- `payload` is stored as `Json`; never store raw Discord message content — only hashes/ids (see `DiscordMessageDeletedPayload.contentHash`).
- `envelopeId` is unique on `EventLog` to enforce idempotent persistence.
- DLQ rows keep the full envelope payload so they can be replayed without the original `EventLog` row.

## 10. API

All endpoints live under `src/core/events` exposed via the `api` layer, documented with Swagger, gated by `events.*` permissions. Controllers call an Application Service only — never Prisma.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/events/logs` | Paginated, filterable event log. |
| `GET` | `/api/v1/events/logs/:envelopeId` | Single envelope detail. |
| `GET` | `/api/v1/events/dead-letters` | Paginated DLQ listing. |
| `POST` | `/api/v1/events/dead-letters/:id/replay` | Replay one DLQ entry into the bus. |
| `POST` | `/api/v1/events/dead-letters/:id/discard` | Discard (soft-delete) a DLQ entry. |
| `POST` | `/api/v1/events/replay` | Replay persisted events by filter (bounded by `replay.maxBatch`). |

```typescript
// dto/list-events-query.dto.ts
import { z } from 'zod';

export const listEventsQuerySchema = z.object({
  eventName: z.string().optional(),
  guildId: z.string().optional(),
  correlationId: z.string().optional(),
  status: z.enum(['published', 'dispatched', 'failed']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListEventsQueryDto = z.infer<typeof listEventsQuerySchema>;

// dto/replay-request.dto.ts
export const replayRequestSchema = z.object({
  eventName: z.string().optional(),
  guildId: z.string().optional(),
  correlationId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(10_000).default(500),
});
export type ReplayRequestDto = z.infer<typeof replayRequestSchema>;

// dto/dead-letter.dto.ts
export interface DeadLetterResponseDto {
  readonly id: string;
  readonly envelopeId: string;
  readonly eventName: string;
  readonly guildId: string | null;
  readonly handlerId: string;
  readonly attempts: number;
  readonly errorCode: string;
  readonly status: 'pending' | 'replayed' | 'discarded';
  readonly createdAt: string;
}
```

Swagger notes: tag `Events`, all responses use the unified error envelope, pagination via `page`/`pageSize` with `X-Total-Count`. WS: a read-only `/ws/events` stream (guild-scoped, permission-gated) pushes new `EventLog` rows to the dashboard for live tailing.

## 11. Permissions

Wildcard-capable claims defined by this unit:

| Claim | Grants |
|-------|--------|
| `events.*` | All event-bus admin capabilities. |
| `events.logs.read` | View the event log and envelope detail. |
| `events.deadletters.read` | View the DLQ. |
| `events.deadletters.replay` | Replay a DLQ entry. |
| `events.deadletters.discard` | Discard a DLQ entry. |
| `events.replay.execute` | Bulk replay persisted events. |
| `events.stream.subscribe` | Subscribe to the `/ws/events` live tail. |

These are guild-aware: a claim may be scoped to a single guild or granted globally. Replay and discard are high-impact and should be restricted to bot-operator groups.

## 12. Logging

Pino structured logs, category `core.events`. Every log line carries `correlationId`, `causationId`, `eventName`, `guildId`, and `envelopeId` for traceability.

- **publish** (`debug`): event accepted, transport chosen.
- **dispatch.sync** (`debug`): each sync handler start/finish with duration.
- **dispatch.async.enqueued** (`info`): envelope enqueued, job id.
- **handler.failed** (`warn`): handler threw; attempt N of M; emits `events.handler.failed`.
- **deadletter.created** (`error`): retries exhausted; emits `events.deadletter.created`.
- **replay** (`info`): replay started/completed with count and `requestedBy`.

**Audit hooks:** replay, discard, and any `events.deadletters.*` action write to the central audit log (actor, target DLQ id, before/after status). Idempotency hits are logged at `debug` to avoid noise. OpenTelemetry spans wrap publish and each async handler; `correlationId` is the trace id.

## 13. Testing

Vitest for unit/integration; Playwright for dashboard e2e.

- **Unit**
  - `EventEnvelope` factory: ids, timestamps, correlation/causation propagation via `AsyncLocalStorage`.
  - Type-level tests (`tsd`/`expectTypeError`) proving `publish('moderation.ban.executed', wrongPayload)` does **not** compile.
  - Sync dispatcher ordering and failure propagation.
  - Idempotency guard: second delivery of the same `idempotencyKey` is skipped.
  - Naming validator: rejects keys not matching `module.entity.action`.
- **Integration**
  - Async path end-to-end against a real Redis/BullMQ: publish -> enqueue -> worker -> handler -> `EventLog.status = dispatched`.
  - Retry then DLQ: a handler that always throws produces an `EventDeadLetter` after `attempts`.
  - Replay: a DLQ entry replayed re-enters the bus and reaches the handler.
  - Discord bridge: a mocked `guildMemberAdd` emits `discord.member.joined` with the correct payload.
- **e2e (dashboard)**: log listing filters, DLQ replay button, live WS tail receives a newly published event.

Coverage gate: ≥90% lines for `src/core/events`. Every event in `GhostEventMap` must have at least one registered subscriber **or** be explicitly marked `fireAndForget` in the policy table (asserted by a test).

## 14. Dashboard Integration

The dashboard exposes an **Events** admin area (permission-gated):

- **Event Log** — paginated, filterable table (event name, guild, status, time range, correlation id). Row click opens the full envelope JSON viewer.
- **Correlation Trace** — given a `correlationId`, render the causal chain as a tree (parent -> children via `causationId`).
- **Dead-Letter Queue** — list pending DLQ entries with `Replay` and `Discard` actions; bulk replay by filter.
- **Live Tail** — WS-backed stream of incoming events (guild-scoped), pausable.
- **Registry Browser** — read-only view of `GhostEventMap` keys, their delivery policy, and subscriber count, with i18n labels/descriptions per event (PT primary, EN secondary).

All labels are translated via the i18n namespaces `events.dashboard.*`.

## 15. Future Extensions

- **Schema evolution / upcasting** — version-aware payload upcasters so old persisted envelopes replay against new contracts.
- **Outbox pattern** — transactional outbox so domain DB writes and event publication are atomic (write to `EventLog` in the same transaction, relay to BullMQ asynchronously).
- **Cross-shard / multi-process fan-out** — Redis pub/sub layer so sync subscribers in other processes still receive `both`-delivery events.
- **CQRS projections** — opt-in read-model projectors that subscribe to event streams.
- **External event egress** — signed webhooks / Kafka bridge for selected `*.executed` events.
- **Per-event SLA metrics** — Prometheus histograms per event name for end-to-end latency.

## 16. Tasks for Claude

1. **Schema** — add `EventLog` and `EventDeadLetter` Prisma models; create the migration.
2. **Envelope & registry** — implement `EventEnvelope<T>`, the `AsyncLocalStorage` correlation context, `GhostEventMap`, `EventName`, the naming validator, and the `event-policy` table.
3. **Repositories** — implement `EventLogRepository` / `DeadLetterRepository` (abstract + Prisma impls) following the Repository Pattern.
4. **Bus core** — implement `EventBus` abstract class and `EventBusService` with sync + async dispatchers, idempotency guard (via Cache layer), and persistence.
5. **Queue worker** — implement the `ghost.events` BullMQ processor with retries/backoff and DLQ creation; emit `events.handler.failed` / `events.deadletter.created`.
6. **Events** — register the `events.*` meta events; wire the `@OnEvent` decorator scanner into bootstrap.
7. **Discord bridge** — implement `DiscordBridgeService` mapping Necord gateway events to `discord.*` keys; honour per-guild `mutedEvents`.
8. **Replay** — implement `EventReplayService` and the replay/discard flows.
9. **Dashboard** — Event Log, Correlation Trace, DLQ actions, Live Tail, Registry Browser; add i18n strings (PT + EN).
10. **API** — controllers + DTOs for `/events/*`; Swagger; WS `/ws/events`; permission guards.
11. **Tests** — unit (incl. type-level), integration (Redis/BullMQ), and dashboard e2e per §13.
12. **Docs** — update module READMEs and the event registry reference.

## 17. Acceptance Criteria

- [ ] `EventBus.publish('moderation.ban.executed', payload)` is fully type-checked; a wrong payload fails compilation.
- [ ] Sync events are awaited in order; a sync handler error propagates to the publisher.
- [ ] Async events are enqueued, dispatched by the worker, retried with backoff, and dead-lettered after exhausting attempts.
- [ ] An identical `idempotencyKey` within TTL is processed exactly once.
- [ ] Async/`both` events are persisted to `EventLog`; failed ones reach `EventDeadLetter`.
- [ ] A DLQ entry can be replayed via API and reaches its handler again.
- [ ] Necord `guildMemberAdd` produces `discord.member.joined` on the bus; no module binds to the gateway directly.
- [ ] No module imports another module's internal service — all cross-module flow goes through the bus.
- [ ] Replay/DLQ endpoints are gated by the correct `events.*` claims and audited.
- [ ] Dashboard shows logs, correlation traces, DLQ, and live tail in PT and EN.

## 18. Definition of Done

- [ ] All 18 sections implemented to spec; no `any` anywhere in `src/core/events`.
- [ ] Prisma migration created and applied; soft-delete honoured.
- [ ] Unit + integration + e2e tests pass; coverage ≥90% for the unit.
- [ ] ESLint/Prettier clean; Husky/Commitlint pass; Conventional Commits used.
- [ ] Swagger docs generated for all `/events/*` endpoints; i18n strings added (PT + EN).
- [ ] OpenTelemetry spans and Pino logs verified for publish + async dispatch.
- [ ] Feature branch `feature/events/event-bus` opened as a PR into `develop` (no direct commits to `main`).
- [ ] This document committed under `docs/architecture/06-events.md` and linked from the docs index.
