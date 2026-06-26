# Logs Module

> ## Claude Instructions
> - Never modify another module. Do not change architecture decisions from `00-project.md`.
> - Keep backwards compatibility. Create Prisma migrations for every schema change. Generate tests and docs.
> - Generate DTOs. Use the Repository Pattern. Use the Event Bus. Use Dependency Injection.
> - No `any`. Keep methods small (<50 lines where reasonable). Follow existing naming conventions.
> - Create indexes for searchable fields. Support pagination, caching, translations, and the dashboard.
> - This module is a **consumer**: it listens to the Event Bus and to Discord gateway events and produces Discord log embeds. It must NOT mutate other modules' state.
> - Never touch Redis or Prisma directly outside the Cache layer / Repositories. Route every config read through the Config + Cache layers.
> - Respect ignore lists and per-category routing on EVERY emit. Never leak internals into user-facing embeds.

---

## 1. Purpose

The **Logs Module** provides configurable, per-event audit logging from a Discord guild into one or more designated Discord log channels. It captures both **Discord gateway events** (message delete/edit, voice state, role/nickname/channel changes, member join/leave, bans, timeouts) and **internal domain events** published on the Event Bus by other modules (ticket lifecycle, command usage, errors).

Each event **category** can be routed to a different channel, formatted as a rich embed, and filtered through **ignore lists** (ignored users, roles, channels, bots, command prefixes). The module is fully **guild-aware**: every configuration, route and ignore rule is scoped to a guild and validated with Zod.

The Logs Module is read-only with respect to other modules — it never mutates external state. Its single side effect is dispatching log embeds (and persisting an optional audit record).

## 2. Goals

- **G1 — Per-category routing.** Each log category (e.g. `MESSAGE_DELETE`, `VOICE`, `BANS`) maps to a configurable channel, with a guild-level default channel as fallback.
- **G2 — Enable/disable granularity.** Every category can be toggled independently per guild. A disabled category is fully short-circuited (no formatting, no dispatch, no persistence).
- **G3 — Ignore lists.** Support ignoring specific users, roles, channels, all bots, and selected command names so noisy or sensitive activity is never logged.
- **G4 — Consistent embeds.** Every category produces a typed, i18n-translated embed (PT primary, EN secondary) with a stable colour, icon, and field layout.
- **G5 — Dual ingestion.** Consume **Discord gateway events** (via Necord listeners) and **internal Event Bus events** through a single normalised pipeline.
- **G6 — Resilience.** Dispatch failures (missing channel, missing permission, deleted channel) degrade gracefully, are logged, and never crash the listener.
- **G7 — Observability.** Expose Prometheus counters for events received, dispatched, ignored, and failed, per category.
- **G8 — Dashboard manageable.** All routing, toggles and ignore lists are editable from the dashboard via the module's REST API.

## 3. Architecture

The module follows the strict layer flow from `00-project.md`:

```
Discord Gateway ─┐
                 ├─► LogIngestion (normaliser) ─► LogPolicy (enabled? ignored?) ─► LogFormatter ─► LogDispatcher ─► Discord channel
Event Bus ───────┘                                        │                                                              │
                                                          └──────────────► LogConfigService (cache-backed) ◄────────────┘
                                                                                   │
                                                          LogRepository ─► Prisma ─► MySQL (config, routes, ignore rules, audit)
REST (LogsController) ─► LogsApplicationService ─► LogConfigService / LogRepository
```

Key principles:

- **Controllers never touch Prisma.** `LogsController` calls `LogsApplicationService`, which uses `LogConfigService` and repositories.
- **Listeners are thin.** Gateway listeners (`LogGatewayListener`) and bus subscribers (`LogEventBusSubscriber`) only translate raw payloads into a normalised `NormalizedLogEvent` and hand off to `LogIngestionService`.
- **The pipeline is single-path.** Both ingestion sources converge on `LogIngestionService.ingest()` so policy, formatting and dispatch logic is written once.
- **No module coupling.** Other modules communicate only through Event Bus contracts (see §6). The Logs Module imports no other module's internal services.
- **CQRS:** Not used here — the workload is event-stream + simple CRUD. Plain Application Service + Repository is sufficient.

## 4. Folder Structure

```
src/modules/logs/
├── logs.module.ts
├── public-api/
│   ├── index.ts                       # the ONLY export surface other code may import
│   ├── logs.contract.ts               # public types (LogCategory, NormalizedLogEvent)
│   └── logs.events.ts                 # event name constants emitted/consumed
├── application/
│   ├── logs.application-service.ts    # CRUD orchestration for config/routes/ignores
│   ├── log-ingestion.service.ts       # normalised ingestion entrypoint
│   ├── log-policy.service.ts          # enabled? ignored? resolution
│   ├── log-config.service.ts          # cache-backed config reads/writes
│   └── log-dispatcher.service.ts      # builds + sends embed to channel
├── domain/
│   ├── log-category.enum.ts
│   ├── log-event.factory.ts           # raw -> NormalizedLogEvent factories
│   ├── log-color.map.ts
│   └── value-objects/
│       └── ignore-rule.vo.ts
├── formatting/
│   ├── log-formatter.service.ts       # NormalizedLogEvent -> EmbedBuilder
│   └── formatters/                    # one per category
│       ├── message-delete.formatter.ts
│       ├── message-edit.formatter.ts
│       ├── voice.formatter.ts
│       ├── role-update.formatter.ts
│       ├── nickname.formatter.ts
│       ├── channel.formatter.ts
│       ├── member.formatter.ts
│       ├── ban.formatter.ts
│       ├── timeout.formatter.ts
│       ├── ticket.formatter.ts
│       ├── command-usage.formatter.ts
│       └── error.formatter.ts
├── infrastructure/
│   ├── log-gateway.listener.ts        # Necord @On() Discord events
│   ├── log-event-bus.subscriber.ts    # internal Event Bus subscriptions
│   └── repositories/
│       ├── log-config.repository.ts
│       ├── log-route.repository.ts
│       ├── log-ignore.repository.ts
│       └── log-audit.repository.ts
├── api/
│   ├── logs.controller.ts
│   └── dto/
│       ├── update-log-config.dto.ts
│       ├── upsert-log-route.dto.ts
│       ├── create-ignore-rule.dto.ts
│       └── log-audit-query.dto.ts
├── config/
│   └── logs.config.schema.ts          # Zod schemas + defaults
└── tests/
    ├── log-policy.service.spec.ts
    ├── log-formatter.service.spec.ts
    ├── log-ingestion.service.spec.ts
    └── logs.controller.e2e-spec.ts
```

## 5. Public Interfaces

These are the only types exported from `public-api/index.ts`. Other modules import nothing else.

```typescript
// public-api/logs.contract.ts

/** Every log category the module understands. Stable string values are persisted. */
export enum LogCategory {
  MessageDelete = 'MESSAGE_DELETE',
  MessageEdit = 'MESSAGE_EDIT',
  Voice = 'VOICE',
  RoleUpdate = 'ROLE_UPDATE',
  Nickname = 'NICKNAME',
  Channel = 'CHANNEL',
  MemberJoin = 'MEMBER_JOIN',
  MemberLeave = 'MEMBER_LEAVE',
  Ban = 'BAN',
  Timeout = 'TIMEOUT',
  Ticket = 'TICKET',
  CommandUsage = 'COMMAND_USAGE',
  Error = 'ERROR',
}

/** Actor that triggered the event (user, bot, or system). */
export interface LogActor {
  readonly id: string;
  readonly tag: string;
  readonly isBot: boolean;
  readonly avatarUrl: string | null;
}

/** A field rendered into the embed. Values are pre-translated i18n keys + params. */
export interface LogField {
  readonly key: string; // i18n key, e.g. 'logs.field.oldValue'
  readonly params?: Readonly<Record<string, string | number>>;
  readonly value: string;
  readonly inline: boolean;
}

/** The single normalised shape every ingestion source produces. */
export interface NormalizedLogEvent {
  readonly guildId: string;
  readonly category: LogCategory;
  readonly occurredAt: Date;
  readonly actor: LogActor | null;
  readonly target: LogActor | null;
  /** Channel the activity happened in, used for channel-level ignore checks. */
  readonly contextChannelId: string | null;
  /** Role ids relevant to ignore checks (member's roles). */
  readonly actorRoleIds: readonly string[];
  /** Command name for COMMAND_USAGE ignore checks. */
  readonly commandName: string | null;
  /** Structured detail used by the category formatter. */
  readonly fields: readonly LogField[];
  /** Correlation id linking this log to a trace / originating event. */
  readonly correlationId: string | null;
}

/** Public entrypoint other modules MAY call to push a custom log event. */
export abstract class LogsPublicApi {
  abstract record(event: NormalizedLogEvent): Promise<void>;
  abstract isCategoryEnabled(guildId: string, category: LogCategory): Promise<boolean>;
}
```

```typescript
// application/log-ingestion.service.ts (signature only)
export interface ILogIngestionService {
  /** Single funnel for gateway + bus events. Applies policy, formats, dispatches. */
  ingest(event: NormalizedLogEvent): Promise<void>;
}

// application/log-policy.service.ts (signature only)
export interface LogPolicyDecision {
  readonly shouldLog: boolean;
  readonly reason: 'CATEGORY_DISABLED' | 'IGNORED_USER' | 'IGNORED_ROLE'
    | 'IGNORED_CHANNEL' | 'IGNORED_BOT' | 'IGNORED_COMMAND' | 'ALLOWED';
  readonly channelId: string | null; // resolved target channel
}

export interface ILogPolicyService {
  evaluate(event: NormalizedLogEvent): Promise<LogPolicyDecision>;
}
```

## 6. Events

### Consumed — Discord gateway (via Necord `@On`)

| Gateway event | Produces category |
|---|---|
| `messageDelete` | `MESSAGE_DELETE` |
| `messageUpdate` | `MESSAGE_EDIT` |
| `voiceStateUpdate` | `VOICE` (join/leave/move/mute/deaf) |
| `guildMemberUpdate` | `ROLE_UPDATE`, `NICKNAME` |
| `channelCreate` / `channelDelete` / `channelUpdate` | `CHANNEL` |
| `guildMemberAdd` | `MEMBER_JOIN` |
| `guildMemberRemove` | `MEMBER_LEAVE` |
| `guildBanAdd` / `guildBanRemove` | `BAN` |
| `guildMemberUpdate` (communicationDisabledUntil) | `TIMEOUT` |

### Consumed — internal Event Bus

```typescript
// public-api/logs.events.ts
export const LOGS_CONSUMED = {
  TICKET_OPENED: 'tickets.ticket.opened',
  TICKET_CLOSED: 'tickets.ticket.closed',
  TICKET_CLAIMED: 'tickets.ticket.claimed',
  COMMAND_EXECUTED: 'core.command.executed',
  APP_ERROR: 'core.error.raised',
} as const;

export const LOGS_EMITTED = {
  LOG_DISPATCHED: 'logs.entry.dispatched',
  LOG_FAILED: 'logs.entry.failed',
} as const;
```

Example consumed payloads (contracts owned by the publishing module):

```typescript
export interface TicketOpenedEvent {
  readonly guildId: string;
  readonly ticketId: string;
  readonly openedByUserId: string;
  readonly channelId: string;
  readonly correlationId: string;
}

export interface CommandExecutedEvent {
  readonly guildId: string;
  readonly userId: string;
  readonly commandName: string;
  readonly channelId: string;
  readonly success: boolean;
  readonly durationMs: number;
}

export interface AppErrorEvent {
  readonly guildId: string | null;
  readonly category: string;
  readonly code: string;
  readonly userFacingMessage: string;
  readonly correlationId: string;
}
```

### Emitted

```typescript
export interface LogDispatchedEvent {
  readonly guildId: string;
  readonly category: LogCategory;
  readonly channelId: string;
  readonly messageId: string;
  readonly correlationId: string | null;
}

export interface LogFailedEvent {
  readonly guildId: string;
  readonly category: LogCategory;
  readonly reason: string;
  readonly correlationId: string | null;
}
```

## 7. Dependencies

The module relies ONLY on CORE systems — never on other modules' internals.

| Core system | Usage |
|---|---|
| **Event Bus** | Subscribes to ticket/command/error events; emits `logs.entry.*`. |
| **Cache layer** | Caches resolved per-guild config, routes and ignore lists (namespaced `logs:cfg:<guildId>`, TTL 300s). Invalidated on config writes. Never touches Redis directly. |
| **Database (Prisma via Repositories)** | Persists config, routes, ignore rules, optional audit trail. Only repositories touch Prisma. |
| **Permissions** | Guards REST endpoints with claims (see §11). |
| **Config layer** | ENV → DB → Defaults resolution for global toggles (e.g. audit persistence on/off). |
| **Queue (BullMQ)** | Optional: batched audit persistence and retry of failed dispatches via `logs-dispatch-retry` queue with DLQ. |
| **Discord client (Necord)** | Source of gateway events + channel send target. |
| **i18n** | All embed text translated (PT primary, EN secondary), namespace `logs`. |
| **OpenTelemetry / Pino** | Tracing + structured logging. |

## 8. Configuration

All settings are guild-scoped unless noted. Validated with Zod; resolved ENV → DB → Defaults.

```typescript
// config/logs.config.schema.ts
import { z } from 'zod';
import { LogCategory } from '../public-api/logs.contract';

export const discordIdSchema = z.string().regex(/^\d{17,20}$/, 'invalid Discord snowflake');

export const logCategoryConfigSchema = z.object({
  category: z.nativeEnum(LogCategory),
  enabled: z.boolean(),
  channelId: discordIdSchema.nullable(), // null -> fall back to default channel
});

export const ignoreRuleSchema = z.object({
  type: z.enum(['USER', 'ROLE', 'CHANNEL', 'COMMAND']),
  value: z.string().min(1).max(100), // snowflake or command name
});

export const guildLogConfigSchema = z.object({
  guildId: discordIdSchema,
  enabled: z.boolean().default(true),
  defaultChannelId: discordIdSchema.nullable().default(null),
  ignoreBots: z.boolean().default(true),
  embedColorOverride: z
    .number()
    .int()
    .min(0)
    .max(0xffffff)
    .nullable()
    .default(null),
  categories: z.array(logCategoryConfigSchema).default([]),
  ignores: z.array(ignoreRuleSchema).default([]),
});

export type GuildLogConfig = z.infer<typeof guildLogConfigSchema>;

// Global (ENV-backed) defaults
export const globalLogConfigSchema = z.object({
  LOGS_AUDIT_PERSISTENCE: z.coerce.boolean().default(true),
  LOGS_AUDIT_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(90),
  LOGS_DISPATCH_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
});
```

**Default category state:** all categories `enabled: true`, `channelId: null` (use `defaultChannelId`). `ERROR` defaults to `enabled: false` to avoid noise until a channel is configured.

## 9. Database

```prisma
// prisma/schema.prisma — Logs Module additions

model LogConfig {
  id              String            @id @default(cuid())
  guildId         String            @unique
  enabled         Boolean           @default(true)
  defaultChannelId String?
  ignoreBots      Boolean           @default(true)
  embedColorOverride Int?
  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt
  deletedAt       DateTime?         // soft delete

  routes          LogRoute[]
  ignores         LogIgnoreRule[]

  @@index([guildId])
}

model LogRoute {
  id          String      @id @default(cuid())
  guildId     String
  category    String      // LogCategory enum value
  enabled     Boolean     @default(true)
  channelId   String?     // null -> default channel
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  config      LogConfig   @relation(fields: [guildId], references: [guildId], onDelete: Cascade)

  @@unique([guildId, category])
  @@index([guildId])
  @@index([guildId, category])
}

model LogIgnoreRule {
  id        String   @id @default(cuid())
  guildId   String
  type      String   // USER | ROLE | CHANNEL | COMMAND
  value     String   // snowflake or command name
  createdAt DateTime @default(now())

  config    LogConfig @relation(fields: [guildId], references: [guildId], onDelete: Cascade)

  @@unique([guildId, type, value])
  @@index([guildId, type])
}

model LogAuditEntry {
  id            String   @id @default(cuid())
  guildId       String
  category      String
  actorId       String?
  targetId      String?
  channelId     String?  // dispatched channel
  messageId     String?  // dispatched message id
  correlationId String?
  payload       Json     // sanitised normalised event
  dispatched    Boolean  @default(false)
  failureReason String?
  createdAt     DateTime @default(now())

  @@index([guildId, category])
  @@index([guildId, createdAt])
  @@index([correlationId])
}
```

**Notes:** `LogConfig` uses soft delete (`deletedAt`); `LogRoute`/`LogIgnoreRule` cascade-delete with config. `LogAuditEntry` is hard-deleted by the retention job (`LOGS_AUDIT_RETENTION_DAYS`). All searchable fields (`guildId`, `category`, `correlationId`, `createdAt`) are indexed.

## 10. API

Base path: `/api/v1/guilds/:guildId/logs`. All endpoints require auth + guild membership; specific claims in §11. Documented in Swagger under tag `Logs`.

| Method | Path | Description | Body / Query |
|---|---|---|---|
| `GET` | `/config` | Get resolved guild log config | — |
| `PATCH` | `/config` | Update top-level config | `UpdateLogConfigDto` |
| `GET` | `/routes` | List category routes | — |
| `PUT` | `/routes/:category` | Upsert a category route | `UpsertLogRouteDto` |
| `GET` | `/ignores` | List ignore rules (paginated) | `?page&limit&type` |
| `POST` | `/ignores` | Create an ignore rule | `CreateIgnoreRuleDto` |
| `DELETE` | `/ignores/:id` | Delete an ignore rule | — |
| `GET` | `/audit` | Query audit entries (paginated) | `LogAuditQueryDto` |

```typescript
// api/dto/update-log-config.dto.ts
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateLogConfigDto {
  @ApiPropertyOptional() readonly enabled?: boolean;
  @ApiPropertyOptional({ nullable: true }) readonly defaultChannelId?: string | null;
  @ApiPropertyOptional() readonly ignoreBots?: boolean;
  @ApiPropertyOptional({ nullable: true }) readonly embedColorOverride?: number | null;
}

// api/dto/upsert-log-route.dto.ts
export class UpsertLogRouteDto {
  @ApiProperty() readonly enabled!: boolean;
  @ApiPropertyOptional({ nullable: true }) readonly channelId?: string | null;
}

// api/dto/create-ignore-rule.dto.ts
export class CreateIgnoreRuleDto {
  @ApiProperty({ enum: ['USER', 'ROLE', 'CHANNEL', 'COMMAND'] })
  readonly type!: 'USER' | 'ROLE' | 'CHANNEL' | 'COMMAND';
  @ApiProperty() readonly value!: string;
}

// api/dto/log-audit-query.dto.ts
export class LogAuditQueryDto {
  @ApiPropertyOptional() readonly category?: string;
  @ApiPropertyOptional() readonly correlationId?: string;
  @ApiPropertyOptional({ default: 1 }) readonly page?: number;
  @ApiPropertyOptional({ default: 25 }) readonly limit?: number;
}
```

All DTO inputs are revalidated server-side with the Zod schemas from §8 before reaching the application service.

## 11. Permissions

Wildcard-capable claims defined by this module (namespace `logs`):

| Claim | Grants |
|---|---|
| `logs.*` | Full control of the logs module. |
| `logs.config.view` | Read config and routes. |
| `logs.config.edit` | Update config and routes. |
| `logs.ignores.view` | List ignore rules. |
| `logs.ignores.manage` | Create/delete ignore rules. |
| `logs.audit.view` | Query audit entries. |

Endpoints map: `GET /config|/routes` → `logs.config.view`; `PATCH /config`, `PUT /routes/:category` → `logs.config.edit`; `GET /ignores` → `logs.ignores.view`; `POST|DELETE /ignores` → `logs.ignores.manage`; `GET /audit` → `logs.audit.view`. Claims resolve through the Permissions core (groups, inheritance, Discord roles).

## 12. Logging

This module both *produces* Discord logs and *emits its own* structured Pino logs (don't confuse them).

- **Categories (Pino):** `logs.ingestion`, `logs.policy`, `logs.dispatch`, `logs.config`.
- **What is logged:** event received (category, guildId, correlationId), policy decision + reason, dispatch outcome (channelId, messageId), and failures (with stack on `logs.dispatch`).
- **Audit hooks:** every ingested event that passes policy produces a `LogAuditEntry` (when `LOGS_AUDIT_PERSISTENCE=true`); failed dispatches set `dispatched=false` + `failureReason`.
- **Tracing:** `correlationId` propagated from the originating event onto the OpenTelemetry span and into both the audit row and the emitted `logs.entry.*` event.
- **Never leak internals:** `ERROR` category embeds show only `userFacingMessage` + `code`; stack traces stay in Pino, never in Discord.

## 13. Testing

- **Unit (Vitest):**
  - `LogPolicyService` — every ignore type, `ignoreBots`, disabled category, channel resolution fallback (route → default).
  - `LogFormatter` — each of the 12 formatters produces correct colour, fields, and i18n keys; PT and EN render.
  - `LogEventFactory` — gateway payloads correctly normalised (e.g. `guildMemberUpdate` distinguishing `ROLE_UPDATE` vs `NICKNAME`).
- **Integration:**
  - Ingestion pipeline with in-memory cache + test DB: config write invalidates cache; route upsert respected on next ingest.
  - Dispatcher with a mocked Discord channel: success path writes audit row + emits `LOG_DISPATCHED`; missing-permission path emits `LOG_FAILED` and retries via queue.
- **E2E (Playwright/HTTP):** `logs.controller.e2e-spec.ts` — full CRUD over config/routes/ignores with claim enforcement (403 when claim missing), pagination on `/ignores` and `/audit`.
- **Coverage target:** ≥90% on `application/` and `formatting/`.

## 14. Dashboard Integration

The dashboard exposes a **Logs** settings page per guild, backed by the §10 API:

- **Master toggle** (`enabled`) + **default log channel** picker.
- **Category grid:** each category row with an enable switch and a channel override picker; shows effective channel (override or default).
- **Ignore lists:** tabbed manager for Users / Roles / Channels / Commands with add/remove; bot-ignore master switch.
- **Embed preview:** live preview of a sample embed per category honouring `embedColorOverride` and locale.
- **Audit viewer:** paginated, filterable (category, correlationId, date range) read-only table.
- All labels translated via the `logs` i18n namespace (PT/EN).

## 15. Future Extensions

- **Webhook delivery** in addition to channel sends (per-category webhook URLs).
- **External sinks:** ship audit entries to Loki/Elasticsearch.
- **Message content snapshots** with configurable retention for `MESSAGE_DELETE`/`EDIT` (privacy-gated).
- **Rate limiting / batching** of high-frequency categories (voice) into digest embeds.
- **Conditional rules engine** (e.g. only log role changes touching specific roles).
- **Anomaly alerts** — escalate spikes in `ERROR`/`BAN` to a separate alert channel.

## 16. Tasks for Claude

1. **Phase 1 — Schema:** Add `LogConfig`, `LogRoute`, `LogIgnoreRule`, `LogAuditEntry` to `schema.prisma`; create migration; add indexes from §9.
2. **Phase 2 — Config & contracts:** Implement `logs.config.schema.ts` (Zod), `public-api/` contract + event constants.
3. **Phase 3 — Repositories:** Implement the four repositories (Prisma only here), with pagination on audit + ignores.
4. **Phase 4 — Services:** `LogConfigService` (cache-backed), `LogPolicyService`, `LogIngestionService`, `LogDispatcher`, `LogsApplicationService`.
5. **Phase 5 — Domain + formatting:** `LogEventFactory`, colour map, and all 12 category formatters with i18n keys.
6. **Phase 6 — Events:** `LogGatewayListener` (Necord `@On`) and `LogEventBusSubscriber`; wire both into ingestion.
7. **Phase 7 — Commands:** Slash commands `/logs status`, `/logs set-channel <category> [channel]`, `/logs toggle <category>`, `/logs ignore <add|remove> <type> <value>`.
8. **Phase 8 — API:** `LogsController` + DTOs + Swagger + permission guards.
9. **Phase 9 — Dashboard:** Settings page, category grid, ignore manager, embed preview, audit viewer.
10. **Phase 10 — Queue:** `logs-dispatch-retry` queue + DLQ; audit retention job.
11. **Phase 11 — Tests:** Unit, integration, e2e per §13.
12. **Phase 12 — Docs:** Update module README + i18n PT/EN translation files.

## 17. Acceptance Criteria

- [ ] Each category can be independently enabled/disabled and routed to its own channel; falls back to the default channel when no override is set.
- [ ] Ignore lists (user, role, channel, command, bots) suppress matching events with the correct policy reason.
- [ ] Both gateway and Event Bus events flow through the single `ingest()` funnel and render category-correct embeds in PT and EN.
- [ ] Dispatch failures emit `logs.entry.failed`, are retried via queue, never crash the listener.
- [ ] Config writes invalidate the cache; the next ingest reflects new config within one TTL window or immediately on invalidation.
- [ ] REST endpoints enforce the §11 claims (403 otherwise) and paginate `/ignores` and `/audit`.
- [ ] Prometheus counters increment for received/dispatched/ignored/failed per category.
- [ ] No `any`; lint clean; migrations created; coverage ≥90% on core paths.

## 18. Definition of Done

- [ ] All unit/integration/e2e tests pass in CI (GitHub Actions).
- [ ] Prisma migration committed and applied cleanly on a fresh DB.
- [ ] ESLint + Prettier clean; Commitlint-valid Conventional Commits.
- [ ] Swagger/OpenAPI updated; module README + PT/EN i18n files written.
- [ ] No direct Prisma access outside repositories; no direct Redis access outside Cache layer.
- [ ] No imports of other modules' internals (only Event Bus + public API).
- [ ] PR opened against `develop` from `feature/logs`; reviewed; no direct commits to `main`.
