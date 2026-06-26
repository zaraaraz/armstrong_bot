# Tickets Module

> ## Claude Instructions
> - Never modify another module. Do not change architecture decisions from `00-project.md`.
> - Keep backwards compatibility. Create Prisma migrations for every schema change. Generate tests and docs.
> - Generate DTOs for every endpoint. Use the Repository Pattern — only repositories touch Prisma.
> - Use the Event Bus for cross-module communication. Use Dependency Injection everywhere.
> - No `any`. Keep methods small (<50 lines where reasonable). Follow existing naming conventions.
> - Everything is guild-aware. Route all cache access through the Cache layer; never touch Redis directly.
> - Route all background work (auto-close, transcript build) through BullMQ; never `setTimeout` long-lived timers.
> - Create indexes for searchable fields. Support pagination, caching, translations (PT primary, EN secondary), and dashboard.
> - Validate all config with Zod. Respect config priority ENV -> Database -> Defaults.
> - Never leak internals in user-facing errors. Log + categorise + trace everything.

---

## 1. Purpose

The Tickets Module provides an enterprise-grade support-ticketing system for Discord guilds. It lets
guild members open private, category-scoped channels ("tickets") through interactive button panels,
routes those tickets to the correct staff based on **ticket type**, and drives each ticket through a
strict **lifecycle state machine** from creation to archival.

It owns the full operational surface of ticketing: type configuration, panels, claiming, priority,
staff assignment, inactivity auto-close, HTML transcript generation, and post-resolution ratings.
It exposes a public contract so other modules (e.g. `logging`, `analytics`, `economy`) can react to
ticket events **without** importing internal services.

This module does **not** own moderation, role management, or generic notifications — it consumes the
core Permissions, Cache, Events, Database, and Queue systems and communicates outward via the Event Bus.

---

## 2. Goals

- **Multi-type ticketing**: `support`, `report`, `staff`, `purchase`, `partnership`, each with its own
  Discord category, permission overwrites, opening message, naming scheme, and assignable staff group.
- **Button panels**: an admin publishes a panel message; each button opens a ticket of a configured type.
- **Strict lifecycle**: every ticket has exactly one state; transitions are validated by a state machine.
- **Claiming & assignment**: staff can claim a ticket (self-assign) or be assigned by a manager.
- **Priority**: `low | normal | high | urgent`, drives sort order and SLA hints on the dashboard.
- **Transcripts**: a self-contained HTML transcript is generated on close, stored, and downloadable.
- **Auto-close on inactivity**: configurable per-type inactivity windows close stale tickets via BullMQ.
- **Ratings**: after close, the opener may rate the experience (1–5) with optional feedback.
- **Guild-aware & i18n**: all user-facing strings translated (PT primary, EN secondary), all data guild-scoped.
- **Observable**: full structured logging, audit hooks, metrics, and OpenTelemetry spans.
- **Dashboard-ready**: paginated, filterable, cache-backed read APIs for a web dashboard.

---

## 3. Architecture

The module follows the project-wide layer flow with **no shortcuts**:

```
Discord Interaction (Necord)            REST (NestJS Controller)
        |                                       |
        v                                       v
   TicketCommandHandler / PanelInteraction   TicketApiController
        |                                       |
        +-----------------+---------------------+
                          v
                 TicketApplicationService          <- orchestrates use cases, transactions, events
                          |
        +-----------------+------------------+----------------------+
        v                 v                  v                      v
 TicketLifecycleService  TicketTypeService  TranscriptService   RatingService   (Domain services)
        |                 |                  |                      |
        +-----------------+------------------+----------------------+
                          v
                 TicketRepository / TicketTypeService backing repos   <- ONLY layer touching Prisma
                          v
                       MySQL (Prisma)
```

Cross-cutting concerns are injected from CORE: `CacheService`, `EventBus`, `PermissionService`,
`QueueService` (BullMQ), `PrismaService` (via repositories only), `I18nService`, `LoggerService`.

- **Controllers/Handlers never touch Prisma** and never run business rules — they validate input
  (Zod/DTO) and delegate to `TicketApplicationService`.
- The **lifecycle state machine** lives in `TicketLifecycleService` (a pure domain service) so it is
  unit-testable without Discord or DB.
- **Auto-close** is a BullMQ delayed/repeatable job; a sweep job re-evaluates inactivity windows.
- **Transcript build** is an async BullMQ job (CPU/IO heavy HTML rendering) to keep interactions fast.

---

## 4. Folder Structure

```
src/modules/tickets/
├── tickets.module.ts                       # NestJS module wiring (DI providers, exports public API)
├── tickets.public.ts                       # PUBLIC API surface (the only thing other modules import)
├── application/
│   ├── ticket.application-service.ts        # use-case orchestration + transactions + event emission
│   ├── dto/
│   │   ├── create-ticket.dto.ts
│   │   ├── close-ticket.dto.ts
│   │   ├── claim-ticket.dto.ts
│   │   ├── assign-ticket.dto.ts
│   │   ├── set-priority.dto.ts
│   │   ├── rate-ticket.dto.ts
│   │   ├── create-ticket-type.dto.ts
│   │   ├── create-panel.dto.ts
│   │   └── query-tickets.dto.ts
│   └── mappers/
│       └── ticket.mapper.ts                 # entity <-> response DTO mapping
├── domain/
│   ├── ticket.entity.ts                     # domain entity + invariants
│   ├── ticket-state.machine.ts              # transition table + guard logic
│   ├── ticket-state.enum.ts
│   ├── ticket-priority.enum.ts
│   ├── ticket-type.enum.ts
│   └── services/
│       ├── ticket-lifecycle.service.ts      # apply transitions, enforce guards
│       ├── ticket-type.service.ts           # resolve type config, category, perms
│       ├── transcript.service.ts            # build self-contained HTML transcript
│       └── rating.service.ts                # validate + persist ratings, aggregates
├── infrastructure/
│   ├── repositories/
│   │   ├── ticket.repository.ts             # implements TicketRepositoryPort (Prisma)
│   │   ├── ticket-type.repository.ts
│   │   ├── ticket-message.repository.ts
│   │   └── ticket-rating.repository.ts
│   ├── discord/
│   │   ├── ticket-channel.factory.ts        # creates Discord channels w/ overwrites
│   │   └── ticket-embed.builder.ts          # builds panels, control rows, messages
│   └── transcript/
│       └── html-transcript.renderer.ts      # pure HTML renderer (no Discord deps)
├── presentation/
│   ├── commands/
│   │   ├── ticket.commands.ts               # /ticket ... slash commands (Necord)
│   │   └── ticketpanel.commands.ts          # /ticketpanel ... admin commands
│   ├── interactions/
│   │   ├── panel-button.handler.ts          # button -> open ticket
│   │   └── control-button.handler.ts        # claim/close/rate buttons inside ticket
│   └── api/
│       └── ticket.api-controller.ts         # REST controller (dashboard)
├── jobs/
│   ├── auto-close.processor.ts              # BullMQ: close inactive tickets
│   ├── inactivity-sweep.processor.ts        # BullMQ repeatable: scan & schedule closures
│   └── transcript-build.processor.ts        # BullMQ: render + persist transcript
├── config/
│   └── tickets.config.ts                    # Zod schema + defaults (guild + global)
├── tickets.events.ts                        # event name constants + payload types
└── tests/
    ├── ticket-state.machine.spec.ts
    ├── ticket.application-service.spec.ts
    ├── transcript.service.spec.ts
    ├── rating.service.spec.ts
    └── ticket.api-controller.e2e-spec.ts
```

---

## 5. Public Interfaces

These are the **only** symbols exported from `tickets.public.ts`. Other modules import from here, never
from `application/`, `domain/`, or `infrastructure/`.

```typescript
// src/modules/tickets/domain/ticket-state.enum.ts
export enum TicketState {
  Open = 'OPEN',
  Claimed = 'CLAIMED',
  Pending = 'PENDING',     // waiting on opener / external
  Resolved = 'RESOLVED',   // staff marked solved, awaiting confirmation/rating window
  Closed = 'CLOSED',       // channel deleted, transcript built
  Archived = 'ARCHIVED',   // fully finalised, read-only record
}

// src/modules/tickets/domain/ticket-priority.enum.ts
export enum TicketPriority {
  Low = 'LOW',
  Normal = 'NORMAL',
  High = 'HIGH',
  Urgent = 'URGENT',
}

// src/modules/tickets/domain/ticket-type.enum.ts
export enum TicketTypeKind {
  Support = 'SUPPORT',
  Report = 'REPORT',
  Staff = 'STAFF',
  Purchase = 'PURCHASE',
  Partnership = 'PARTNERSHIP',
}
```

```typescript
// src/modules/tickets/tickets.public.ts

/** Read-only view of a ticket exposed to other modules and the dashboard. */
export interface TicketView {
  readonly id: string;
  readonly guildId: string;
  readonly typeKind: TicketTypeKind;
  readonly typeId: string;
  readonly channelId: string | null;
  readonly openerId: string;          // Discord user id
  readonly claimedById: string | null;
  readonly assignedToId: string | null;
  readonly state: TicketState;
  readonly priority: TicketPriority;
  readonly subject: string | null;
  readonly createdAt: Date;
  readonly lastActivityAt: Date;
  readonly closedAt: Date | null;
  readonly rating: number | null;     // 1..5
}

/** Public, stable contract. Implemented by TicketApplicationService and exported from the module. */
export abstract class TicketPublicApi {
  abstract getTicket(guildId: string, ticketId: string): Promise<TicketView | null>;
  abstract findActiveByUser(guildId: string, userId: string): Promise<readonly TicketView[]>;
  abstract countOpen(guildId: string): Promise<number>;
  /** Allows other modules to request a programmatic close (e.g. anti-spam). Emits events. */
  abstract closeTicket(input: CloseTicketCommand): Promise<TicketView>;
}

export interface CloseTicketCommand {
  readonly guildId: string;
  readonly ticketId: string;
  readonly actorId: string;           // who triggered the close (user or 'SYSTEM')
  readonly reason: string;
  readonly buildTranscript: boolean;
}
```

```typescript
// Repository ports (domain-owned, implemented in infrastructure)
export interface TicketRepositoryPort {
  create(data: CreateTicketData): Promise<TicketEntity>;
  findById(guildId: string, id: string): Promise<TicketEntity | null>;
  findByChannelId(guildId: string, channelId: string): Promise<TicketEntity | null>;
  findActiveByOpener(guildId: string, openerId: string, typeId: string): Promise<TicketEntity | null>;
  update(guildId: string, id: string, patch: Partial<TicketUpdatableFields>): Promise<TicketEntity>;
  query(guildId: string, q: TicketQuery): Promise<Paginated<TicketEntity>>;
  findStaleForAutoClose(guildId: string, before: Date, limit: number): Promise<readonly TicketEntity[]>;
  countByState(guildId: string, state: TicketState): Promise<number>;
}

export interface Paginated<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}
```

---

## 6. Events

All events are published on the core **Event Bus** with namespaced names and typed payloads. Other
modules consume these; this module never imports another module to react to them.

```typescript
// src/modules/tickets/tickets.events.ts
export const TICKET_EVENTS = {
  Created: 'tickets.ticket.created',
  Claimed: 'tickets.ticket.claimed',
  Assigned: 'tickets.ticket.assigned',
  StateChanged: 'tickets.ticket.state_changed',
  PriorityChanged: 'tickets.ticket.priority_changed',
  Closed: 'tickets.ticket.closed',
  Rated: 'tickets.ticket.rated',
  TranscriptReady: 'tickets.transcript.ready',
} as const;

export interface TicketCreatedPayload {
  guildId: string;
  ticketId: string;
  typeKind: TicketTypeKind;
  openerId: string;
  channelId: string;
  priority: TicketPriority;
  at: string; // ISO
}

export interface TicketStateChangedPayload {
  guildId: string;
  ticketId: string;
  from: TicketState;
  to: TicketState;
  actorId: string;
  at: string;
}

export interface TicketClosedPayload {
  guildId: string;
  ticketId: string;
  closedById: string;
  reason: string;
  durationMs: number;
  at: string;
}

export interface TicketRatedPayload {
  guildId: string;
  ticketId: string;
  raterId: string;
  rating: number; // 1..5
  feedback: string | null;
  at: string;
}

export interface TranscriptReadyPayload {
  guildId: string;
  ticketId: string;
  transcriptId: string;
  url: string;
  at: string;
}
```

**Consumed events** (subscribed via `@OnEvent`):

| Event | Source (core) | Reaction |
| --- | --- | --- |
| `core.message.created` | Discord gateway adapter | If in a ticket channel, append `TicketMessage` + bump `lastActivityAt`. |
| `core.channel.deleted` | Discord gateway adapter | If a ticket channel was deleted out-of-band, force-close + flag. |
| `core.guild.left` | Guild lifecycle | Soft-delete and archive that guild's open tickets. |

---

## 7. Dependencies

Relies **only** on CORE systems (never other modules directly):

- **Cache** (`CacheService`): cached type config (`tickets:type:{guildId}:{typeId}`), open counts,
  panel definitions, per-user active-ticket lookups. Namespaced keys, TTLs below.
- **Events** (`EventBus`): emits the events in §6; subscribes to message/channel/guild events.
- **Permissions** (`PermissionService`): checks wildcard claims (§11) before privileged actions.
- **Database** (`PrismaService`) — accessed **only** through repositories.
- **Queue** (`QueueService` / BullMQ): `tickets-autoclose`, `tickets-sweep` (repeatable), `tickets-transcript`.
- **I18n** (`I18nService`): namespace `tickets`; PT primary, EN secondary; plurals + interpolation.
- **Config** (`ConfigService`): merges ENV -> DB -> defaults, Zod-validated.
- **Logging** (`LoggerService` / Pino) + **Telemetry** (OpenTelemetry) + **Metrics** (Prometheus).
- **Discord** (`Necord`/`discord.js` client) via injected adapters for channel + message ops.

Cache keys & TTLs:

| Key | TTL | Invalidated on |
| --- | --- | --- |
| `tickets:type:{guildId}:list` | 10m | type create/update/delete |
| `tickets:panel:{guildId}:{panelId}` | 30m | panel update/delete |
| `tickets:open-count:{guildId}` | 60s | create/close |
| `tickets:active:{guildId}:{userId}` | 120s | create/close for that user |

---

## 8. Configuration

Guild-scoped and global settings, Zod-validated, priority ENV -> Database -> Defaults.

```typescript
// src/modules/tickets/config/tickets.config.ts
import { z } from 'zod';

export const ticketTypeConfigSchema = z.object({
  kind: z.nativeEnum(TicketTypeKind),
  label: z.string().min(1).max(80),                 // i18n key or literal
  emoji: z.string().max(64).optional(),
  categoryId: z.string().regex(/^\d{17,20}$/),       // Discord category channel id
  staffGroupId: z.string().uuid(),                   // permission group assigned to this type
  buttonStyle: z.enum(['PRIMARY', 'SECONDARY', 'SUCCESS', 'DANGER']).default('PRIMARY'),
  namingScheme: z.string().default('{type}-{number}'),
  openingMessageKey: z.string().default('tickets.opening.default'),
  inactivityMinutes: z.number().int().min(0).max(43_200).default(2_880), // 0 = disabled, 48h default
  requireSubject: z.boolean().default(false),
  maxOpenPerUser: z.number().int().min(1).max(20).default(1),
  defaultPriority: z.nativeEnum(TicketPriority).default(TicketPriority.Normal),
  ratingEnabled: z.boolean().default(true),
});

export const ticketsGuildConfigSchema = z.object({
  enabled: z.boolean().default(true),
  transcriptChannelId: z.string().regex(/^\d{17,20}$/).optional(),
  logChannelId: z.string().regex(/^\d{17,20}$/).optional(),
  autoCloseEnabled: z.boolean().default(true),
  autoCloseWarnMinutes: z.number().int().min(0).default(60),  // warn before auto-close
  transcriptRetentionDays: z.number().int().min(1).max(3650).default(365),
  ratingWindowHours: z.number().int().min(1).max(168).default(48),
  numberingStart: z.number().int().min(1).default(1),
  types: z.array(ticketTypeConfigSchema).max(25).default([]),
});

export const ticketsGlobalConfigSchema = z.object({
  maxTicketsPerGuild: z.number().int().min(1).default(10_000),
  transcriptStorage: z.enum(['DB', 'S3', 'LOCAL']).default('DB'),
  sweepIntervalSeconds: z.number().int().min(30).default(300),
});

export type TicketTypeConfig = z.infer<typeof ticketTypeConfigSchema>;
export type TicketsGuildConfig = z.infer<typeof ticketsGuildConfigSchema>;
export type TicketsGlobalConfig = z.infer<typeof ticketsGlobalConfigSchema>;
```

Defaults are applied by Zod; ENV (e.g. `TICKETS_TRANSCRIPT_STORAGE`) overrides global values; per-guild
DB rows override per-guild defaults.

---

## 9. Database

Prisma models. All ticket data is guild-scoped, indexed for search, and supports soft-delete via
`deletedAt`. Transcripts and messages cascade with the ticket.

```prisma
enum TicketState {
  OPEN
  CLAIMED
  PENDING
  RESOLVED
  CLOSED
  ARCHIVED
}

enum TicketPriority {
  LOW
  NORMAL
  HIGH
  URGENT
}

enum TicketTypeKind {
  SUPPORT
  REPORT
  STAFF
  PURCHASE
  PARTNERSHIP
}

model TicketType {
  id              String          @id @default(cuid())
  guildId         String
  kind            TicketTypeKind
  label           String
  emoji           String?
  categoryId      String
  staffGroupId    String
  namingScheme    String          @default("{type}-{number}")
  inactivityMin   Int             @default(2880)
  requireSubject  Boolean         @default(false)
  maxOpenPerUser  Int             @default(1)
  defaultPriority TicketPriority  @default(NORMAL)
  ratingEnabled   Boolean         @default(true)
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
  deletedAt       DateTime?
  tickets         Ticket[]
  panelButtons    TicketPanelButton[]

  @@index([guildId, kind])
  @@index([guildId, deletedAt])
}

model Ticket {
  id             String          @id @default(cuid())
  guildId        String
  number         Int                                  // human-friendly per-guild sequence
  typeId         String
  type           TicketType      @relation(fields: [typeId], references: [id])
  channelId      String?
  openerId       String
  claimedById    String?
  assignedToId   String?
  state          TicketState     @default(OPEN)
  priority       TicketPriority  @default(NORMAL)
  subject        String?
  closeReason    String?
  lastActivityAt DateTime        @default(now())
  closedAt       DateTime?
  closedById     String?
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt
  deletedAt      DateTime?

  messages       TicketMessage[]
  transcript     TicketTranscript?
  rating         TicketRating?

  @@unique([guildId, number])
  @@index([guildId, state, priority])
  @@index([guildId, openerId, state])
  @@index([guildId, channelId])
  @@index([guildId, lastActivityAt])
  @@index([guildId, deletedAt])
}

model TicketMessage {
  id          String   @id @default(cuid())
  ticketId    String
  ticket      Ticket   @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  authorId    String
  authorTag   String
  content     String   @db.Text
  attachments Json     @default("[]")
  sentAt      DateTime @default(now())

  @@index([ticketId, sentAt])
}

model TicketTranscript {
  id         String   @id @default(cuid())
  ticketId   String   @unique
  ticket     Ticket   @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  guildId    String
  html       String   @db.LongText            // when storage = DB
  externalUrl String?                         // when storage = S3/LOCAL
  byteSize   Int
  messageCount Int
  createdAt  DateTime @default(now())

  @@index([guildId, createdAt])
}

model TicketRating {
  id        String   @id @default(cuid())
  ticketId  String   @unique
  ticket    Ticket   @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  guildId   String
  raterId   String
  rating    Int                               // 1..5 (validated in app layer)
  feedback  String?  @db.Text
  createdAt DateTime @default(now())

  @@index([guildId, rating])
}

model TicketPanel {
  id          String              @id @default(cuid())
  guildId     String
  channelId   String
  messageId   String?
  titleKey    String
  descKey     String
  createdAt   DateTime            @default(now())
  updatedAt   DateTime            @updatedAt
  deletedAt   DateTime?
  buttons     TicketPanelButton[]

  @@index([guildId, deletedAt])
  @@unique([guildId, messageId])
}

model TicketPanelButton {
  id        String      @id @default(cuid())
  panelId   String
  panel     TicketPanel @relation(fields: [panelId], references: [id], onDelete: Cascade)
  typeId    String
  type      TicketType  @relation(fields: [typeId], references: [id])
  order     Int         @default(0)

  @@index([panelId, order])
}
```

Soft-delete notes: `Ticket`, `TicketType`, and `TicketPanel` use `deletedAt`; repository queries filter
`deletedAt: null` by default. Messages/transcripts/ratings are hard-cascaded with their parent ticket
only on permanent purge (retention job), not on soft-delete.

---

## 10. API

REST endpoints under `/api/v1/guilds/:guildId/tickets`, NestJS controller, Swagger-documented, guarded by
permission claims (§11) and guild-scope guard. All list endpoints paginate and are cache-backed.

| Method | Path | Claim | Description |
| --- | --- | --- | --- |
| GET | `/api/v1/guilds/:guildId/tickets` | `tickets.view` | List/filter tickets (paginated). |
| GET | `/api/v1/guilds/:guildId/tickets/:id` | `tickets.view` | Get a single ticket. |
| POST | `/api/v1/guilds/:guildId/tickets/:id/claim` | `tickets.claim` | Claim ticket. |
| POST | `/api/v1/guilds/:guildId/tickets/:id/assign` | `tickets.assign` | Assign to staff. |
| PATCH | `/api/v1/guilds/:guildId/tickets/:id/priority` | `tickets.priority.set` | Set priority. |
| POST | `/api/v1/guilds/:guildId/tickets/:id/close` | `tickets.close` | Close ticket. |
| GET | `/api/v1/guilds/:guildId/tickets/:id/transcript` | `tickets.transcript.view` | Download HTML transcript. |
| GET | `/api/v1/guilds/:guildId/tickets/types` | `tickets.types.view` | List type configs. |
| POST | `/api/v1/guilds/:guildId/tickets/types` | `tickets.types.manage` | Create a type. |
| PATCH | `/api/v1/guilds/:guildId/tickets/types/:typeId` | `tickets.types.manage` | Update a type. |
| POST | `/api/v1/guilds/:guildId/tickets/panels` | `tickets.panels.manage` | Create/publish a panel. |
| GET | `/api/v1/guilds/:guildId/tickets/stats` | `tickets.view` | Aggregate stats (counts, avg rating). |

```typescript
// src/modules/tickets/application/dto/query-tickets.dto.ts
export class QueryTicketsDto {
  @ApiPropertyOptional({ enum: TicketState }) state?: TicketState;
  @ApiPropertyOptional({ enum: TicketPriority }) priority?: TicketPriority;
  @ApiPropertyOptional() openerId?: string;
  @ApiPropertyOptional() assignedToId?: string;
  @ApiPropertyOptional() typeId?: string;
  @ApiPropertyOptional({ default: 1 }) page = 1;
  @ApiPropertyOptional({ default: 25, maximum: 100 }) pageSize = 25;
  @ApiPropertyOptional({ enum: ['createdAt', 'lastActivityAt', 'priority'] }) sortBy = 'createdAt';
  @ApiPropertyOptional({ enum: ['asc', 'desc'] }) sortDir: 'asc' | 'desc' = 'desc';
}

// src/modules/tickets/application/dto/close-ticket.dto.ts
export class CloseTicketRequestDto {
  @ApiProperty() @IsString() @Length(1, 500) reason!: string;
  @ApiPropertyOptional({ default: true }) @IsBoolean() buildTranscript = true;
}

// src/modules/tickets/application/dto/rate-ticket.dto.ts
export class RateTicketRequestDto {
  @ApiProperty({ minimum: 1, maximum: 5 }) @IsInt() @Min(1) @Max(5) rating!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 1000) feedback?: string;
}
```

WS: the dashboard subscribes to a `tickets` gateway room per guild; the module pushes
`ticket:created`, `ticket:state_changed`, and `ticket:closed` frames (mirrors the Event Bus payloads)
for live board updates. Authorisation reuses `tickets.view`.

Slash commands (Necord):

- `/ticket close [reason]` — close the current ticket channel.
- `/ticket claim` — claim the current ticket.
- `/ticket assign <staff>` — assign ticket to a staff member.
- `/ticket priority <low|normal|high|urgent>` — set priority.
- `/ticket add <user>` / `/ticket remove <user>` — manage channel participants.
- `/ticket rename <subject>` — set subject.
- `/ticketpanel create <channel>` — publish a button panel.
- `/ticketpanel addtype <type>` — attach a ticket type button to a panel.

---

## 11. Permissions

Wildcard claims defined by this module (parent `tickets.*`):

| Claim | Grants |
| --- | --- |
| `tickets.open` | Open a ticket via panel/command (granted to members by default). |
| `tickets.view` | View tickets / dashboard board / stats. |
| `tickets.claim` | Claim an unclaimed ticket. |
| `tickets.assign` | Assign a ticket to another staff member. |
| `tickets.priority.set` | Change ticket priority. |
| `tickets.close` | Close any ticket (openers may always close their own). |
| `tickets.participants.manage` | Add/remove users from a ticket channel. |
| `tickets.transcript.view` | View/download transcripts. |
| `tickets.types.view` | View type configuration. |
| `tickets.types.manage` | Create/update/delete ticket types. |
| `tickets.panels.manage` | Create/update/publish panels. |
| `tickets.*` | All of the above (admin). |

Per-type staff are resolved via each type's `staffGroupId` permission group; a user with the type's
group implicitly receives view/claim/close on that type's tickets. Discord-role-based inheritance and
group inheritance are evaluated by the core `PermissionService` — this module only asserts claims.

---

## 12. Logging

Structured Pino logs, category `tickets`, with `traceId`/`spanId` from OpenTelemetry and always
including `guildId` + `ticketId` where applicable. User-facing errors are translated and never expose
stack traces.

Logged events (sub-categories): `tickets.lifecycle`, `tickets.panel`, `tickets.transcript`,
`tickets.autoclose`, `tickets.rating`, `tickets.api`.

Audit hooks (persisted via core audit log + emitted on Event Bus):

- Ticket created / claimed / assigned / priority changed / closed / rated.
- Type created/updated/deleted (with diff), panel published.
- Auto-close fired (with inactivity window + last activity timestamp).

Prometheus metrics:

- `tickets_open_total{guildId,type}` (gauge), `tickets_created_total{type}` (counter),
  `tickets_close_duration_seconds` (histogram), `tickets_rating` (histogram),
  `tickets_autoclose_total` (counter), `tickets_transcript_build_seconds` (histogram).

---

## 13. Testing

All with Vitest (unit/integration) + Playwright (dashboard e2e). No `any` in tests.

- **Unit** — `ticket-state.machine.spec.ts`: every legal transition allowed, every illegal transition
  rejected with a typed error; guards (claim before resolve, only opener rates) verified.
- **Unit** — `transcript.service.spec.ts`: deterministic HTML for a fixed message fixture, XSS-escaping
  of user content, attachment links rendered, byte-size + message-count correct.
- **Unit** — `rating.service.spec.ts`: range validation (1–5), one rating per ticket, rating window
  enforcement, aggregate average computation.
- **Integration** — `ticket.application-service.spec.ts`: open -> claim -> resolve -> close happy path
  against an in-memory/SQLite Prisma, verifying events emitted, cache invalidated, channel factory called.
- **Integration** — auto-close: a stale ticket gets a scheduled close job; sweep enqueues correctly.
- **e2e** — `ticket.api-controller.e2e-spec.ts`: REST CRUD + pagination + permission guards (403 on
  missing claim), transcript download, stats endpoint.
- **Coverage target**: ≥90% lines on `domain/` and `application/`; state machine 100% branch.

---

## 14. Dashboard Integration

The dashboard exposes:

- **Ticket board**: kanban-style columns by `TicketState`, cards sorted by priority then `lastActivityAt`,
  live-updated over WS. Filter by type, priority, assignee, opener; full-text on subject.
- **Ticket detail**: full message thread (read-only), state timeline, claim/assign/priority/close actions
  gated by claims, transcript download button.
- **Type manager**: CRUD for ticket types (category picker, staff group picker, inactivity, naming scheme,
  priority defaults, rating toggle) — all backed by the `/types` endpoints with Zod validation.
- **Panel builder**: compose a panel, drag-order buttons mapped to types, publish to a channel.
- **Analytics**: open/closed counts, average resolution time, average rating per type, auto-close rate
  (from `/stats`), with date-range filtering.

All reads are paginated and cache-backed; all writes round-trip through the Application Service.

---

## 15. Future Extensions

- **SLA policies** per type (response/resolution targets, breach alerts via Event Bus).
- **Macros / canned responses** with i18n + variable interpolation.
- **AI triage**: auto-suggest type/priority from the opening message.
- **Escalation chains**: auto-reassign to a higher group after time-in-state.
- **Cross-guild templates**: export/import type + panel config.
- **Voice tickets**: optional voice channel per ticket.
- **External integrations**: mirror tickets to Zendesk/Jira via a published webhook contract.

---

## 16. Tasks for Claude

Execute in order; each phase is independently committable on a `feature/tickets/*` branch.

1. **Phase 1 — Schema**: add Prisma models (§9), generate migration `add_tickets`, run `prisma generate`.
2. **Phase 2 — Config**: implement `tickets.config.ts` (Zod, §8) + wire into core ConfigService.
3. **Phase 3 — Domain**: implement enums, `TicketEntity`, `ticket-state.machine.ts`, and domain services
   (lifecycle, type, transcript, rating). 100% branch coverage on the state machine.
4. **Phase 4 — Repositories**: implement `TicketRepositoryPort` + sibling repos (Prisma only here).
5. **Phase 5 — Application Service**: orchestrate use cases, transactions, cache invalidation, and
   event emission; implement `TicketPublicApi`.
6. **Phase 6 — Events**: define constants/payloads (§6); subscribe to message/channel/guild events.
7. **Phase 7 — Discord**: channel factory (overwrites per type), embed/button builders, command handlers,
   panel + control button interactions.
8. **Phase 8 — Jobs**: BullMQ `inactivity-sweep` (repeatable), `auto-close`, `transcript-build` processors
   with retries + DLQ.
9. **Phase 9 — Dashboard**: WS gateway room + the read/write surface in §14.
10. **Phase 10 — API**: REST controller + DTOs + Swagger + guards (§10/§11).
11. **Phase 11 — Tests**: unit/integration/e2e per §13.
12. **Phase 12 — Docs**: update module README, i18n PT+EN strings, OpenAPI export.

---

## 17. Acceptance Criteria

- [ ] A member can open each of the 5 ticket types from a published panel; the channel is created in the
      type's category with correct permission overwrites and an opening message in the guild's language.
- [ ] `maxOpenPerUser` is enforced per type; exceeding it returns a translated, user-friendly error.
- [ ] Claiming sets `claimedById`, transitions `OPEN -> CLAIMED`, and updates the control row.
- [ ] Assignment, priority changes, and closes all emit the correct Event Bus events with valid payloads.
- [ ] The state machine rejects every illegal transition with a typed error (no silent failures).
- [ ] Inactivity auto-close warns at `autoCloseWarnMinutes`, then closes after `inactivityMin`; honours
      `autoCloseEnabled`.
- [ ] On close, an HTML transcript is built, stored per `transcriptStorage`, and `TranscriptReady` is emitted;
      it renders all messages with escaped content and is downloadable via the API.
- [ ] After close, the opener can rate 1–5 within `ratingWindowHours`; out-of-window or duplicate ratings rejected.
- [ ] All list/stat endpoints paginate, are cache-backed, and enforce the correct claims (403 otherwise).
- [ ] No module imports another module's internals; all cross-talk is via the Event Bus / public API.
- [ ] No Redis/Prisma access outside Cache layer / repositories respectively.

---

## 18. Definition of Done

- [ ] All 18 sections implemented; behaviour matches this spec.
- [ ] Prisma migration created and applied; `prisma generate` clean.
- [ ] TypeScript strict passes — zero `any`, zero `@ts-ignore`.
- [ ] ESLint + Prettier clean; Husky + Commitlint pass; Conventional Commits used.
- [ ] Vitest unit/integration green; Playwright e2e green; coverage targets met (§13).
- [ ] i18n strings added for PT (primary) and EN (secondary), namespaced under `tickets`.
- [ ] Swagger/OpenAPI updated; metrics + OTel spans emitting; logs categorised.
- [ ] No direct commits to `main`; PR opened against `develop` with description + checklist.
- [ ] Module exposes ONLY its public API; internal services not exported.
