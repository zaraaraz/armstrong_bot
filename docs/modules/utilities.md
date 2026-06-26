# Utilities Module

> ## Claude Instructions
> - Never modify another module. Do not change architecture decisions from `00-project.md`.
> - Keep backwards compatibility. Create Prisma migrations. Generate tests and docs.
> - Generate DTOs. Use the Repository Pattern. Use the Event Bus. Use Dependency Injection.
> - No `any`. Keep methods small (<50 lines where reasonable). Follow existing naming.
> - Create indexes for searchable fields. Support pagination, caching, translations, dashboard.
> - This module is **mostly stateless**. Persist ONLY reminders, notes and todos. Everything
>   else (calculator, translate, weather, qrcode, password, timestamp, conversion, info commands)
>   is computed on the fly and cached, never stored.
> - Reminders DO NOT run their own timers. They publish to the **Scheduler module via the Event Bus**.
>   Never import Scheduler internals — communicate by contract events only.
> - All external calls (weather, translation, url-shortener) go through the Cache layer and a
>   resilient HTTP client with timeouts, retries and circuit breaking. Never call providers raw.
> - No module touches Redis or Prisma directly. Cache layer for cache, Repositories for DB.

---

## 1. Purpose

The **Utilities Module** is a collection of lightweight, high-frequency helper commands that
provide everyday value to guild members without heavy infrastructure. It groups two kinds of
commands:

- **Stateless tools** computed on demand: `calculator`, `translate`, `weather`, `qrcode`,
  `password generator`, `timestamp`, `url shortener`, `user/server/avatar info`, and
  `math/unit conversion`.
- **Lightweight stateful helpers** that persist small, per-user/per-guild records:
  `reminder`, `notes`, and `todo`.

Reminders are intentionally NOT scheduled inside this module. The module persists the reminder
record and **delegates time-based delivery to the Scheduler module via the Event Bus**, keeping
Utilities free of timers, cron loops, and queue management beyond emitting contract events.

The module is fully guild-aware, i18n-enabled (PT primary, EN secondary), permission-gated, and
exposes a small dashboard surface for managing reminders, notes and todos.

## 2. Goals

- Provide a broad set of low-friction utility slash commands with consistent UX and embeds.
- Keep the module **stateless wherever possible**; persist only reminders, notes, and todos.
- Never re-implement scheduling — delegate reminder delivery to Scheduler over the Event Bus.
- Cache all expensive/external results (translations, weather, geocoding, URL shortening).
- Enforce per-guild and per-user rate limits to protect upstream providers and the bot.
- Localise every user-facing string and format numbers/dates per the guild locale.
- Stay within the strict layer flow: Controller -> Application Service -> (Domain Service) ->
  Repository -> Database. Controllers never touch Prisma or Redis.
- Be resilient: external provider failures degrade gracefully to a localised, user-friendly error.

## 3. Architecture

The module follows Clean Architecture + DDD-lite. Necord command controllers are thin adapters
that validate input (Zod), call Application Services, and render localised embeds.

```
Discord Slash Command (Necord)
        │
        ▼
UtilitiesController (adapter layer)         REST: UtilitiesApiController
        │                                          │
        ▼                                          ▼
Application Services
  ├─ ReminderService ───────► EventBus.emit('utilities.reminder.scheduled')
  ├─ NoteService                                   │ (consumed by Scheduler module)
  ├─ TodoService                                   ▼
  ├─ ConversionService (math/unit)        Scheduler fires due reminder →
  ├─ CalculatorService                    emits 'scheduler.job.fired' →
  ├─ QrCodeService                        ReminderDeliveryHandler delivers DM/channel
  ├─ PasswordService
  ├─ TimestampService
  ├─ InfoService (user/server/avatar)
  └─ ExternalToolService
        ├─ TranslateService ─┐
        ├─ WeatherService    ├─► CacheLayer ─► ResilientHttpClient ─► Provider APIs
        └─ UrlShortenerService ┘
        │
        ▼
Repositories (Prisma only here)
  ├─ ReminderRepository
  ├─ NoteRepository
  └─ TodoRepository
        │
        ▼
      MySQL (Prisma)
```

Key decisions:

- **CQRS not used** — these operations are simple CRUD/compute. Plain Application Services suffice.
- **Domain Services** are used only where real logic lives: `ConversionService` (unit graph),
  `CalculatorService` (safe expression evaluation), `PasswordService` (entropy rules).
- **External providers** are abstracted behind interfaces so they can be swapped (e.g. translation
  provider) without touching command code.

## 4. Folder Structure

```text
src/modules/utilities/
├── utilities.module.ts
├── index.ts                            # public API barrel (ONLY exported surface)
├── public/
│   ├── utilities.contract.ts           # public events + DTO contracts other modules may use
│   └── utilities.tokens.ts             # DI injection tokens
├── application/
│   ├── reminder.service.ts
│   ├── note.service.ts
│   ├── todo.service.ts
│   ├── calculator.service.ts
│   ├── conversion.service.ts
│   ├── qrcode.service.ts
│   ├── password.service.ts
│   ├── timestamp.service.ts
│   ├── info.service.ts
│   └── external/
│       ├── translate.service.ts
│       ├── weather.service.ts
│       └── url-shortener.service.ts
├── domain/
│   ├── conversion/
│   │   ├── unit-graph.ts               # unit conversion factor graph
│   │   └── unit.types.ts
│   ├── calculator/
│   │   └── expression-evaluator.ts     # safe AST evaluator (no eval)
│   └── password/
│       └── password-policy.ts
├── infrastructure/
│   ├── providers/
│   │   ├── translate.provider.ts       # impl of TranslationProvider port
│   │   ├── weather.provider.ts
│   │   └── url-shortener.provider.ts
│   └── http/
│       └── resilient-http.client.ts    # wraps shared HTTP w/ retry + breaker
├── controllers/
│   ├── reminder.controller.ts
│   ├── note.controller.ts
│   ├── todo.controller.ts
│   ├── tools.controller.ts             # calc, convert, qrcode, password, timestamp
│   ├── lookup.controller.ts            # translate, weather, urlshorten
│   └── info.controller.ts              # user/server/avatar info
├── api/
│   ├── utilities.api.controller.ts     # REST (dashboard)
│   └── dto/
│       ├── create-reminder.dto.ts
│       ├── reminder-response.dto.ts
│       ├── create-note.dto.ts
│       ├── note-response.dto.ts
│       ├── create-todo.dto.ts
│       ├── update-todo.dto.ts
│       └── todo-response.dto.ts
├── repositories/
│   ├── reminder.repository.ts
│   ├── note.repository.ts
│   └── todo.repository.ts
├── events/
│   ├── reminder-delivery.handler.ts    # consumes scheduler.job.fired
│   └── utilities.events.ts             # emitted event constants + payloads
├── config/
│   └── utilities.config.ts             # Zod schema + defaults
├── i18n/
│   ├── pt/utilities.json
│   └── en/utilities.json
└── utilities.constants.ts
```

## 5. Public Interfaces

Real strict TypeScript exposed through `index.ts`. Internal services are NOT exported.

```ts
// public/utilities.tokens.ts
export const UTILITIES_TOKENS = {
  ReminderService: Symbol('UtilitiesReminderService'),
  NoteService: Symbol('UtilitiesNoteService'),
  TodoService: Symbol('UtilitiesTodoService'),
} as const;
```

```ts
// public/utilities.contract.ts
export type ReminderDeliveryTarget = 'dm' | 'channel';

export interface CreateReminderInput {
  readonly guildId: string;
  readonly userId: string;
  readonly channelId: string;
  readonly message: string;
  readonly remindAt: Date;
  readonly target: ReminderDeliveryTarget;
}

export interface ReminderView {
  readonly id: string;
  readonly guildId: string;
  readonly userId: string;
  readonly message: string;
  readonly remindAt: Date;
  readonly target: ReminderDeliveryTarget;
  readonly delivered: boolean;
  readonly createdAt: Date;
}

export interface PaginatedResult<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

/** Public application service contract for reminders. */
export abstract class IReminderService {
  abstract create(input: CreateReminderInput): Promise<ReminderView>;
  abstract cancel(guildId: string, userId: string, reminderId: string): Promise<void>;
  abstract listForUser(
    guildId: string,
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<ReminderView>>;
}
```

```ts
// domain ports for external providers (no `any`)
export interface TranslationResult {
  readonly sourceLang: string;
  readonly targetLang: string;
  readonly translatedText: string;
  readonly provider: string;
}

export interface TranslationProvider {
  translate(text: string, targetLang: string, sourceLang?: string): Promise<TranslationResult>;
}

export interface WeatherSnapshot {
  readonly location: string;
  readonly tempC: number;
  readonly feelsLikeC: number;
  readonly humidityPct: number;
  readonly conditionCode: string;
  readonly windKph: number;
  readonly observedAt: Date;
}

export interface WeatherProvider {
  current(query: string): Promise<WeatherSnapshot>;
}

export interface UrlShortenerProvider {
  shorten(longUrl: string): Promise<{ readonly shortUrl: string; readonly id: string }>;
}
```

```ts
// domain conversion + calculator contracts
export type MeasurementCategory = 'length' | 'mass' | 'temperature' | 'volume' | 'data' | 'time' | 'speed';

export interface ConversionRequest {
  readonly value: number;
  readonly fromUnit: string;
  readonly toUnit: string;
}

export interface ConversionResult {
  readonly value: number;
  readonly fromUnit: string;
  readonly toUnit: string;
  readonly category: MeasurementCategory;
}

export interface ICalculatorService {
  evaluate(expression: string): number; // throws CalculatorError on invalid input
}

export interface IConversionService {
  convert(req: ConversionRequest): ConversionResult; // throws UnknownUnitError
  listUnits(category: MeasurementCategory): readonly string[];
}
```

## 6. Events

All event names are constants in `events/utilities.events.ts`. Payloads are versioned and typed.

**Emitted:**

```ts
export const UtilitiesEvents = {
  ReminderScheduled: 'utilities.reminder.scheduled',
  ReminderCancelled: 'utilities.reminder.cancelled',
  ReminderDelivered: 'utilities.reminder.delivered',
  NoteCreated: 'utilities.note.created',
  TodoCreated: 'utilities.todo.created',
  TodoCompleted: 'utilities.todo.completed',
} as const;

export interface ReminderScheduledPayload {
  readonly reminderId: string;
  readonly guildId: string;
  readonly userId: string;
  readonly remindAt: string; // ISO-8601
  readonly schedulerJobKey: string; // 'utilities:reminder:<reminderId>'
}

export interface ReminderCancelledPayload {
  readonly reminderId: string;
  readonly schedulerJobKey: string;
}
```

`utilities.reminder.scheduled` is the **contract handed to the Scheduler module**. Scheduler
registers a one-shot job keyed by `schedulerJobKey` to fire at `remindAt`.

**Consumed:**

- `scheduler.job.fired` — handled by `ReminderDeliveryHandler`. Filters jobs whose key starts with
  `utilities:reminder:`, loads the reminder, delivers it (DM or channel), marks it delivered, and
  emits `utilities.reminder.delivered`.

```ts
export interface SchedulerJobFiredPayload {
  readonly jobKey: string;
  readonly firedAt: string;
}
```

## 7. Dependencies

CORE systems only — never another module's internals.

| Core system   | Usage                                                                          |
| ------------- | ------------------------------------------------------------------------------ |
| Event Bus     | Emit reminder lifecycle events; consume `scheduler.job.fired`.                 |
| Cache         | Cache translations, weather, geocoding, shortened URLs; per-user rate limits.  |
| Permissions   | Gate every command via wildcard claims (see §11).                              |
| Database      | Prisma via Repositories for `Reminder`, `Note`, `Todo` only.                   |
| Queue (BullMQ)| Indirect — Scheduler owns the queue. Utilities does NOT enqueue directly.      |
| Config        | Guild + global settings resolved ENV -> DB -> Defaults, Zod-validated.         |
| HTTP (shared) | `ResilientHttpClient` wraps shared client with retry/timeout/circuit breaker.  |
| i18n          | All user-facing strings via the `utilities` namespace.                         |
| Logger (Pino) | Structured logs + audit hooks (see §12).                                       |

Scheduler is reached **only through Event Bus contracts** — no direct import.

## 8. Configuration

Resolved with priority ENV -> Database -> Defaults, validated by Zod. Most settings are
guild-scoped; provider credentials are global (ENV only).

```ts
import { z } from 'zod';

export const utilitiesGuildConfigSchema = z.object({
  enabled: z.boolean().default(true),
  remindersEnabled: z.boolean().default(true),
  maxRemindersPerUser: z.number().int().min(1).max(100).default(25),
  maxReminderHorizonDays: z.number().int().min(1).max(365).default(365),
  notesEnabled: z.boolean().default(true),
  maxNotesPerUser: z.number().int().min(1).max(500).default(100),
  maxNoteLength: z.number().int().min(50).max(4000).default(2000),
  todosEnabled: z.boolean().default(true),
  maxTodosPerUser: z.number().int().min(1).max(500).default(100),
  translateEnabled: z.boolean().default(true),
  weatherEnabled: z.boolean().default(true),
  urlShortenerEnabled: z.boolean().default(true),
  defaultWeatherUnits: z.enum(['metric', 'imperial']).default('metric'),
  passwordMaxLength: z.number().int().min(8).max(256).default(64),
  rateLimitPerMinute: z.number().int().min(1).max(120).default(20),
});

export type UtilitiesGuildConfig = z.infer<typeof utilitiesGuildConfigSchema>;

export const utilitiesGlobalConfigSchema = z.object({
  translationProviderApiKey: z.string().min(1).optional(),
  weatherProviderApiKey: z.string().min(1).optional(),
  urlShortenerApiKey: z.string().min(1).optional(),
  externalHttpTimeoutMs: z.number().int().min(500).max(30_000).default(5_000),
  externalCacheTtlSeconds: z.number().int().min(30).max(86_400).default(600),
});

export type UtilitiesGlobalConfig = z.infer<typeof utilitiesGlobalConfigSchema>;
```

Cache TTLs (namespaced keys, all via Cache layer):

- `utilities:translate:<targetLang>:<hash(text)>` — `externalCacheTtlSeconds`.
- `utilities:weather:<normalisedQuery>` — 600s.
- `utilities:urlshort:<hash(longUrl)>` — 24h.
- `utilities:ratelimit:<guildId>:<userId>:<command>` — 60s sliding window.

## 9. Database

Only three persisted models. All are guild-aware and soft-deletable via `deletedAt`.

```prisma
enum ReminderTarget {
  DM
  CHANNEL
}

model Reminder {
  id           String         @id @default(cuid())
  guildId      String
  userId       String
  channelId    String
  message      String         @db.Text
  remindAt     DateTime
  target       ReminderTarget @default(DM)
  delivered    Boolean        @default(false)
  deliveredAt  DateTime?
  schedulerKey String         @unique
  createdAt    DateTime       @default(now())
  updatedAt    DateTime       @updatedAt
  deletedAt    DateTime?

  @@index([guildId, userId])
  @@index([remindAt, delivered])
  @@index([deletedAt])
  @@map("utilities_reminders")
}

model Note {
  id        String    @id @default(cuid())
  guildId   String
  userId    String
  title     String    @db.VarChar(120)
  body      String    @db.Text
  pinned    Boolean   @default(false)
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  @@index([guildId, userId])
  @@index([guildId, userId, pinned])
  @@index([deletedAt])
  @@map("utilities_notes")
}

enum TodoStatus {
  OPEN
  DONE
}

model Todo {
  id          String     @id @default(cuid())
  guildId     String
  userId      String
  text        String     @db.VarChar(500)
  status      TodoStatus @default(OPEN)
  priority    Int        @default(0) // 0=low,1=med,2=high
  dueAt       DateTime?
  completedAt DateTime?
  position    Int        @default(0) // user-defined ordering
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
  deletedAt   DateTime?

  @@index([guildId, userId, status])
  @@index([guildId, userId, position])
  @@index([deletedAt])
  @@map("utilities_todos")
}
```

Soft delete: repositories always filter `deletedAt: null`; deletions set `deletedAt`. The
`schedulerKey` on `Reminder` is the contract key shared with Scheduler (`utilities:reminder:<id>`).

## 10. API

REST endpoints under `/api/v1/guilds/:guildId/utilities`, secured by the dashboard auth guard +
permission claims. Swagger-documented; all list endpoints paginate (`page`, `pageSize`).

| Method | Path                                   | Body / Query              | Claim                  |
| ------ | -------------------------------------- | ------------------------- | ---------------------- |
| GET    | `/reminders`                           | `?page&pageSize`          | `utilities.reminders.read` |
| POST   | `/reminders`                           | `CreateReminderDto`       | `utilities.reminders.create` |
| DELETE | `/reminders/:id`                       | —                         | `utilities.reminders.delete` |
| GET    | `/notes`                               | `?page&pageSize&q`        | `utilities.notes.read` |
| POST   | `/notes`                               | `CreateNoteDto`           | `utilities.notes.create` |
| PATCH  | `/notes/:id`                           | `UpdateNoteDto`           | `utilities.notes.update` |
| DELETE | `/notes/:id`                           | —                         | `utilities.notes.delete` |
| GET    | `/todos`                               | `?page&pageSize&status`   | `utilities.todos.read` |
| POST   | `/todos`                               | `CreateTodoDto`           | `utilities.todos.create` |
| PATCH  | `/todos/:id`                           | `UpdateTodoDto`           | `utilities.todos.update` |
| DELETE | `/todos/:id`                           | —                         | `utilities.todos.delete` |

Stateless tools (calculator, translate, weather, etc.) are NOT exposed over REST — they are
Discord-only. The dashboard renders read-only documentation for them.

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsISO8601, IsString, MaxLength } from 'class-validator';

export class CreateReminderDto {
  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  readonly message!: string;

  @ApiProperty({ example: '2026-07-01T18:00:00.000Z' })
  @IsISO8601()
  readonly remindAt!: string;

  @ApiProperty({ enum: ['dm', 'channel'] })
  @IsEnum(['dm', 'channel'])
  readonly target!: 'dm' | 'channel';

  @ApiProperty()
  @IsString()
  readonly channelId!: string;
}

export class ReminderResponseDto {
  @ApiProperty() readonly id!: string;
  @ApiProperty() readonly message!: string;
  @ApiProperty() readonly remindAt!: string;
  @ApiProperty({ enum: ['dm', 'channel'] }) readonly target!: 'dm' | 'channel';
  @ApiProperty() readonly delivered!: boolean;
  @ApiProperty() readonly createdAt!: string;
}
```

## 11. Permissions

Wildcard-friendly claims following `module.resource.action`. Granting `utilities.*` enables all.

| Claim                          | Grants                                            |
| ------------------------------ | ------------------------------------------------- |
| `utilities.*`                  | All utilities commands and API.                   |
| `utilities.reminders.*`        | Create/read/cancel reminders.                     |
| `utilities.reminders.create`   | `/remind` create.                                 |
| `utilities.reminders.read`     | List own reminders.                               |
| `utilities.reminders.delete`   | Cancel a reminder.                                |
| `utilities.notes.*`            | Manage notes (create/read/update/delete).         |
| `utilities.todos.*`            | Manage todos.                                     |
| `utilities.tools.use`          | Calculator, convert, qrcode, password, timestamp. |
| `utilities.translate.use`      | `/translate`.                                     |
| `utilities.weather.use`        | `/weather`.                                       |
| `utilities.urlshorten.use`     | `/shorten`.                                       |
| `utilities.info.use`           | `/userinfo`, `/serverinfo`, `/avatar`.            |

Default member role receives `utilities.tools.use`, `utilities.info.use`, `utilities.reminders.*`,
`utilities.notes.*`, `utilities.todos.*`. Claims resolve through the core Permissions service
(groups, inheritance, Discord roles).

## 12. Logging

Structured Pino logs, namespaced category `utilities`. No PII beyond Discord IDs; note/reminder
bodies are NOT logged at info level.

Log categories:

- `utilities.reminder` — create/cancel/deliver (info), delivery failure (warn/error).
- `utilities.external` — provider calls: latency, cache hit/miss, breaker state (info/warn).
- `utilities.command` — command invocation: `commandName`, `guildId`, `userId`, `durationMs`.
- `utilities.error` — caught domain errors (calculator/conversion) at debug; unexpected at error.

Audit hooks (core Audit log) fire for: reminder created/cancelled, note deleted, todo deleted,
and every successful reminder delivery (`reminderId`, `target`, `actorId`). External provider
calls log `provider`, `cacheHit`, `statusCode`, `traceId` (OpenTelemetry) but never API keys.

## 13. Testing

Vitest for unit/integration; Playwright for dashboard e2e.

**Unit (must cover):**

- `ExpressionEvaluator`: precedence, parentheses, division by zero, rejection of identifiers/`eval`
  vectors; never executes arbitrary code.
- `UnitGraph` / `ConversionService`: every category, round-trip accuracy, temperature offsets,
  unknown-unit error.
- `PasswordPolicy`: length bounds, charset flags, entropy guarantee.
- `TimestampService`: all Discord styles (`t`, `T`, `d`, `D`, `f`, `F`, `R`).
- `ReminderService`: horizon validation, per-user cap, emits `ReminderScheduled` with correct key.

**Integration:**

- Repositories against a test MySQL: soft-delete filtering, pagination, indexes used.
- `ReminderDeliveryHandler` consuming a mocked `scheduler.job.fired`, marking delivered and
  emitting `ReminderDelivered`.
- External services with mocked providers: cache hit path, breaker-open fallback, timeout.

**E2E:** Dashboard reminders/notes/todos CRUD; permission denial returns 403.

Coverage target: ≥90% lines on domain (`calculator`, `conversion`, `password`), ≥80% overall.

## 14. Dashboard Integration

The dashboard exposes, per guild (gated by claims):

- **Reminders** panel — list (paginated), create with date/time picker + channel/DM toggle, cancel.
- **Notes** panel — searchable list (`q` against title), pin/unpin, edit, delete.
- **Todos** panel — kanban-style OPEN/DONE columns, drag to reorder (`position`), priority + due date.
- **Settings** — toggles and limits from the guild config schema (§8), validated client + server.
- **Tools reference** — read-only docs of stateless commands and supported unit categories.

All panels consume the REST API in §10 and respect i18n (PT/EN) and the active guild locale for
date/number formatting.

## 15. Future Extensions

- Recurring reminders (RRULE) once Scheduler exposes recurring job contracts.
- Shared guild notes / collaborative todo lists with the Permissions group model.
- Additional translation/weather providers behind the existing ports (failover chain).
- Polls and reaction-role quick tools migrated in if scope grows.
- Custom user unit aliases stored per guild.
- Reminder snooze action on the delivery message (button interaction).

## 16. Tasks for Claude

Execute in order; each phase is a separate Conventional Commit on a `feature/utilities` branch.

1. **Schema** — add `Reminder`, `Note`, `Todo` models + enums to Prisma; create migration; add indexes.
2. **Config** — implement `utilities.config.ts` Zod schemas + ENV/DB/Defaults resolution.
3. **Repositories** — `ReminderRepository`, `NoteRepository`, `TodoRepository` (soft delete, pagination).
4. **Domain** — `ExpressionEvaluator`, `UnitGraph`/conversion, `PasswordPolicy` (pure, fully unit-tested).
5. **Application services** — reminder, note, todo, calculator, conversion, qrcode, password,
   timestamp, info; external services (translate/weather/urlshortener) behind provider ports + Cache.
6. **Events** — define emitted constants/payloads; emit `ReminderScheduled`/`Cancelled`; implement
   `ReminderDeliveryHandler` consuming `scheduler.job.fired`.
7. **Commands (Necord controllers)** — wire all slash commands with Zod input + localised embeds.
8. **Dashboard API** — REST controller + DTOs + Swagger + permission guards + pagination.
9. **Dashboard UI hooks** — expose the panels described in §14 (contracts/DTOs).
10. **Tests** — unit, integration, e2e per §13.
11. **Docs & i18n** — PT + EN namespace files; update module README; ensure lint clean.

## 17. Acceptance Criteria

- `/remind <time> <message>` persists a reminder, emits `utilities.reminder.scheduled`, and the
  reminder is delivered at the right time via the Scheduler -> `ReminderDeliveryHandler` path.
- Cancelling a reminder emits `utilities.reminder.cancelled` and Scheduler removes the job.
- `/calc <expression>` evaluates safely; malformed input returns a localised error, never crashes.
- `/convert <value> <from> <to>` returns correct results across all categories incl. temperature.
- `/translate`, `/weather`, `/shorten` use the Cache layer; repeated calls within TTL hit cache and
  do not re-call providers; provider outage yields a friendly localised error (breaker open).
- `/password [length] [options]` honours config max length and entropy rules.
- `/timestamp` outputs valid Discord timestamp markup for every style.
- `/userinfo`, `/serverinfo`, `/avatar` render correct guild-aware embeds.
- Notes and todos CRUD works in Discord and dashboard; soft delete hides records; lists paginate.
- Every command is permission-gated and rate-limited per guild config.
- No module imports Scheduler internals; only Event Bus contracts are used.

## 18. Definition of Done

- All 18 sections implemented; code matches this spec.
- Prisma migration created and applied; `prisma generate` clean.
- Vitest unit + integration green; Playwright e2e green; coverage targets met.
- ESLint + Prettier clean; no `any`; Commitlint-compliant Conventional Commits.
- i18n PT + EN namespace files complete; no hardcoded user-facing strings.
- Swagger/OpenAPI updated for all REST endpoints.
- Cache, Permissions, Event Bus, Config, Logging integrations verified; no direct Redis/Prisma
  access outside Cache/Repository layers.
- PR opened against `develop` (not `main`) with this doc linked; CI green.
