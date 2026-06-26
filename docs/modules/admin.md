# Admin Module

> ## Claude Instructions
> - Never modify another module. Do not change architecture decisions from `docs/00-project.md`.
> - Keep backwards compatibility. Create Prisma migrations for every schema change. Generate tests and docs.
> - Generate DTOs for every endpoint. Use the Repository Pattern — only repositories touch Prisma. Use the Event Bus for cross-module communication. Use Dependency Injection everywhere.
> - No `any`. Keep methods small (<50 lines where reasonable). Follow existing naming conventions.
> - Everything is **guild-scoped** unless explicitly global. Validate ALL config with Zod (`ENV -> Database -> Defaults`).
> - No module touches Redis directly — go through the Cache layer. No module touches another module's internals — use Events or the published public API.
> - Create indexes for searchable fields. Support pagination, caching, translations (i18n PT primary / EN secondary), and dashboard exposure.
> - Slash commands MUST be guild-aware, permission-gated, and emit audit events.

---

## 1. Purpose

The **Admin Module** is the server-configuration and community-engagement toolkit of Ghost Bot. It bundles the day-to-day "server management" features that guild owners and moderators expect from a top-tier Discord bot, all behind a unified, guild-scoped configuration surface.

It owns eleven cohesive features:

| Feature | One-line description |
| --- | --- |
| **Reaction Roles** | Assign/remove roles when members react to a configured message. |
| **Button Roles** | Assign/remove roles via interactive buttons / select menus. |
| **Autorole** | Automatically grant roles (and optional bot-vs-human distinction) on member join. |
| **Join/Leave Messages** | Welcome / goodbye messages with embeds and variable interpolation. |
| **Auto Threads** | Automatically create a thread on every message in configured channels. |
| **Sticky Messages** | Keep a message pinned-to-bottom by re-posting it after channel activity. |
| **Suggestions** | Community suggestion board with up/down voting and status workflow. |
| **Polls** | Timed polls with single/multi choice, live tallies, and result announcement. |
| **Starboard** | Highlight popular messages once they reach a star-reaction threshold. |
| **Embed Builder** | Compose, store, edit and send rich embeds (with the wizard or commands). |
| **Server Setup Wizard** | Guided, interactive first-run configuration of all the above. |

The module is the canonical example of "configuration as a product": every feature is independently toggleable per guild, validated with Zod, cached, translatable, and editable from both Discord and the dashboard.

It does **not** own moderation actions (bans/mutes), tickets, economy, or FiveM integration — those live in their own modules and are reached only via the Event Bus or their public APIs.

---

## 2. Goals

- **Self-service configuration.** Any feature can be enabled, configured, and disabled per guild without code changes or a redeploy.
- **Single source of truth.** All admin settings persist in MySQL via Prisma, layered over `ENV -> Database -> Defaults`, validated by Zod schemas.
- **Reactive & event-driven.** React to Discord gateway events (`guildMemberAdd`, `messageReactionAdd`, `messageCreate`, etc.) through the central Event Bus — never poll.
- **Idempotent and safe.** Reaction/button role toggles, autorole grants, and sticky reposts must be idempotent and resilient to Discord rate limits and duplicate events.
- **Multi-guild isolation.** No setting, cache key, or query may ever leak across guilds.
- **i18n first.** All user-facing strings (welcome messages, poll prompts, suggestion statuses) resolve through the i18n layer with PT primary / EN secondary and variable interpolation.
- **Observable.** Every state change emits a domain event and is auditable; metrics exposed for Prometheus.
- **Dashboard parity.** Everything configurable via slash command is also configurable via the dashboard, and vice versa.
- **Strict layering.** Controllers/command handlers -> Application Services -> Domain Services (where needed) -> Repositories -> Prisma. No shortcuts.

---

## 3. Architecture

The module follows Clean Architecture + DDD-lite, sliced into the standard horizontal layers, and is internally organised by feature (vertical slices) so each feature can evolve independently.

```
Necord Command/Interaction  ┐
Gateway Event Listener      ├─►  Application Service  ─►  Domain Service  ─►  Repository  ─►  Prisma/MySQL
REST Controller (dashboard) ┘            │                     │                  │
                                         ▼                     ▼                  ▼
                                    Event Bus            Pure domain logic    Cache layer
                                  (emit/consume)        (no I/O, no Prisma)  (memory+Redis)
```

Key rules applied here:

- **Controllers / Necord handlers never touch Prisma or Redis.** They validate input (Zod/DTO), delegate to an Application Service, and shape the response/embed.
- **Application Services** orchestrate: load config (cached), call domain services, call repositories, emit events. One service per feature (e.g. `ReactionRoleService`, `StarboardService`).
- **Domain Services** hold pure rules (e.g. "is this reaction a star?", "has the poll expired?", "compute sticky cooldown"). No I/O.
- **Repositories** are the only Prisma consumers. Each feature has a repository.
- **Cache layer** wraps all hot reads (config lookups, active reaction-role maps, sticky state) behind namespaced TTL keys.
- **Event Bus** decouples reactions: the gateway listener publishes a normalised internal event; the relevant Application Service consumes it. Cross-module signals (e.g. "member welcomed") are published for other modules to consume.

A single `AdminModule` (NestJS) wires DI providers and exports **only** the public API surface in §5. Other modules never import `ReactionRoleService` directly.

---

## 4. Folder Structure

```
src/modules/admin/
├── admin.module.ts
├── admin.public-api.ts                 # the ONLY thing other modules may import
├── application/
│   ├── reaction-role.service.ts
│   ├── button-role.service.ts
│   ├── autorole.service.ts
│   ├── greeting.service.ts             # join/leave messages
│   ├── auto-thread.service.ts
│   ├── sticky-message.service.ts
│   ├── suggestion.service.ts
│   ├── poll.service.ts
│   ├── starboard.service.ts
│   ├── embed-builder.service.ts
│   └── setup-wizard.service.ts
├── domain/
│   ├── entities/
│   │   ├── reaction-role.entity.ts
│   │   ├── poll.entity.ts
│   │   ├── suggestion.entity.ts
│   │   └── starboard-entry.entity.ts
│   ├── services/
│   │   ├── poll-tally.service.ts
│   │   ├── star-threshold.service.ts
│   │   └── sticky-cooldown.service.ts
│   └── value-objects/
│       ├── role-assignment-mode.vo.ts
│       └── poll-window.vo.ts
├── infrastructure/
│   ├── repositories/
│   │   ├── reaction-role.repository.ts
│   │   ├── button-role.repository.ts
│   │   ├── autorole.repository.ts
│   │   ├── greeting.repository.ts
│   │   ├── auto-thread.repository.ts
│   │   ├── sticky-message.repository.ts
│   │   ├── suggestion.repository.ts
│   │   ├── poll.repository.ts
│   │   ├── starboard.repository.ts
│   │   └── embed-template.repository.ts
│   └── mappers/
│       └── admin.mappers.ts
├── presentation/
│   ├── commands/
│   │   ├── reaction-role.commands.ts
│   │   ├── button-role.commands.ts
│   │   ├── autorole.commands.ts
│   │   ├── greeting.commands.ts
│   │   ├── auto-thread.commands.ts
│   │   ├── sticky.commands.ts
│   │   ├── suggestion.commands.ts
│   │   ├── poll.commands.ts
│   │   ├── starboard.commands.ts
│   │   ├── embed.commands.ts
│   │   └── setup.commands.ts
│   ├── listeners/
│   │   ├── member.listener.ts          # guildMemberAdd/Remove -> autorole, greeting
│   │   ├── reaction.listener.ts        # reactionAdd/Remove -> reaction roles, starboard, polls
│   │   ├── interaction.listener.ts     # button/select -> button roles, suggestion votes
│   │   └── message.listener.ts         # messageCreate -> auto threads, sticky
│   └── controllers/
│       ├── admin-config.controller.ts
│       ├── suggestion.controller.ts
│       ├── poll.controller.ts
│       └── starboard.controller.ts
├── dto/
│   ├── reaction-role.dto.ts
│   ├── greeting.dto.ts
│   ├── poll.dto.ts
│   ├── suggestion.dto.ts
│   ├── starboard.dto.ts
│   └── embed-template.dto.ts
├── config/
│   └── admin.config.schema.ts          # Zod schemas + defaults
└── events/
    └── admin.events.ts                 # event name constants + payload types
```

---

## 5. Public Interfaces

These are the only types other modules may depend on. Everything else is internal.

```ts
// src/modules/admin/admin.public-api.ts

/** Stable, published contract of the Admin module. */
export abstract class AdminPublicApi {
  /** Returns the active welcome/leave config for a guild, or null if disabled. */
  abstract getGreetingConfig(guildId: string): Promise<GreetingConfigView | null>;

  /** Returns all roles that autorole would grant to a (human) member on join. */
  abstract getAutoroleRoleIds(guildId: string, isBot: boolean): Promise<string[]>;

  /** Renders a stored embed template into a Discord-ready payload (no send). */
  abstract renderEmbedTemplate(
    guildId: string,
    templateKey: string,
    variables: Readonly<Record<string, string>>,
  ): Promise<EmbedRenderResult>;

  /** Lightweight read of a single suggestion for cross-module display. */
  abstract getSuggestion(guildId: string, suggestionId: string): Promise<SuggestionView | null>;
}

export interface GreetingConfigView {
  readonly guildId: string;
  readonly joinEnabled: boolean;
  readonly leaveEnabled: boolean;
  readonly joinChannelId: string | null;
  readonly leaveChannelId: string | null;
}

export interface EmbedRenderResult {
  readonly title: string | null;
  readonly description: string | null;
  readonly color: number | null;
  readonly fields: ReadonlyArray<{ name: string; value: string; inline: boolean }>;
  readonly footer: string | null;
  readonly imageUrl: string | null;
}

export type SuggestionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'IMPLEMENTED' | 'DUPLICATE';

export interface SuggestionView {
  readonly id: string;
  readonly guildId: string;
  readonly authorId: string;
  readonly content: string;
  readonly status: SuggestionStatus;
  readonly upvotes: number;
  readonly downvotes: number;
  readonly createdAt: Date;
}
```

Representative internal application-service contract (one per feature; reaction roles shown):

```ts
// src/modules/admin/application/reaction-role.service.ts (contract excerpt)

export type RoleAssignmentMode = 'TOGGLE' | 'ADD_ONLY' | 'REMOVE_ONLY' | 'UNIQUE' | 'VERIFY';

export interface CreateReactionRoleInput {
  readonly guildId: string;
  readonly channelId: string;
  readonly messageId: string;
  readonly emoji: string;        // unicode or <:name:id>
  readonly roleId: string;
  readonly mode: RoleAssignmentMode;
}

export abstract class ReactionRoleService {
  abstract bind(input: CreateReactionRoleInput, actorId: string): Promise<ReactionRoleEntity>;
  abstract unbind(guildId: string, bindingId: string, actorId: string): Promise<void>;
  abstract listForGuild(guildId: string, page: PageRequest): Promise<Page<ReactionRoleEntity>>;
  /** Invoked by the reaction listener; idempotent. */
  abstract handleReaction(evt: ReactionToggleEvent): Promise<void>;
}

export interface PageRequest { readonly page: number; readonly pageSize: number; }
export interface Page<T> {
  readonly items: ReadonlyArray<T>;
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}
```

---

## 6. Events

Event name constants live in `events/admin.events.ts`. All payloads carry `guildId` and a correlation id from the trace context.

**Consumed (from the gateway via the core Event Bus):**

```ts
export const ADMIN_CONSUMES = {
  MEMBER_ADD: 'gateway.guildMemberAdd',
  MEMBER_REMOVE: 'gateway.guildMemberRemove',
  REACTION_ADD: 'gateway.messageReactionAdd',
  REACTION_REMOVE: 'gateway.messageReactionRemove',
  MESSAGE_CREATE: 'gateway.messageCreate',
  INTERACTION_CREATE: 'gateway.interactionCreate', // buttons / selects
} as const;
```

**Emitted (domain events for other modules / audit / dashboard WS):**

```ts
export const ADMIN_EMITS = {
  REACTION_ROLE_GRANTED: 'admin.reactionRole.granted',
  REACTION_ROLE_REVOKED: 'admin.reactionRole.revoked',
  BUTTON_ROLE_TOGGLED: 'admin.buttonRole.toggled',
  AUTOROLE_APPLIED: 'admin.autorole.applied',
  MEMBER_WELCOMED: 'admin.greeting.welcomed',
  MEMBER_FAREWELLED: 'admin.greeting.farewelled',
  AUTO_THREAD_CREATED: 'admin.autoThread.created',
  STICKY_REPOSTED: 'admin.sticky.reposted',
  SUGGESTION_CREATED: 'admin.suggestion.created',
  SUGGESTION_STATUS_CHANGED: 'admin.suggestion.statusChanged',
  POLL_OPENED: 'admin.poll.opened',
  POLL_CLOSED: 'admin.poll.closed',
  STARBOARD_ENTRY_CREATED: 'admin.starboard.entryCreated',
  STARBOARD_ENTRY_UPDATED: 'admin.starboard.entryUpdated',
} as const;
```

Example payload shapes:

```ts
export interface AutoroleAppliedPayload {
  guildId: string;
  userId: string;
  roleIds: string[];
  isBot: boolean;
  appliedAt: string; // ISO
}

export interface SuggestionStatusChangedPayload {
  guildId: string;
  suggestionId: string;
  previous: SuggestionStatus;
  next: SuggestionStatus;
  moderatorId: string;
  reason: string | null;
}

export interface PollClosedPayload {
  guildId: string;
  pollId: string;
  channelId: string;
  totalVotes: number;
  winningOptionIds: string[]; // ties possible
  closedAt: string;
}
```

A poll that has a scheduled close time is enqueued in **BullMQ** (`admin.poll.close` job, delayed) rather than polled. The poll worker emits `POLL_CLOSED`.

---

## 7. Dependencies

The module depends ONLY on CORE systems — never on other feature modules:

| Core system | Used for |
| --- | --- |
| **Event Bus** | Consuming gateway events; emitting domain events; dashboard WS fan-out. |
| **Cache layer** | Caching guild config, active reaction-role maps, sticky state, starboard thresholds. Namespaced keys, TTL. |
| **Database (Prisma)** | Persistence, via repositories only. |
| **Queue (BullMQ)** | Delayed poll closing, sticky-repost debounce, suggestion reminder, starboard recount. |
| **Permissions** | Gating slash commands and REST endpoints via wildcard claims. |
| **Config layer** | Resolving `ENV -> DB -> Defaults` with Zod validation. |
| **i18n** | Translating all user-facing output (PT/EN, namespaces, plurals, interpolation). |
| **Logger (Pino)** | Structured, categorised logs + audit hooks. |
| **Discord client (Necord)** | Sending messages, managing roles, creating threads, adding reactions. |

Cross-module needs (e.g. notifying the moderation module that a suggestion was abusive) happen by **emitting an event**, not by importing another module.

---

## 8. Configuration

All settings are guild-scoped (a single global kill-switch aside). Resolution order: `ENV -> Database -> Defaults`. Validated with Zod.

```ts
// src/modules/admin/config/admin.config.schema.ts
import { z } from 'zod';

export const snowflake = z.string().regex(/^\d{17,20}$/, 'invalid snowflake');

export const greetingConfigSchema = z.object({
  joinEnabled: z.boolean().default(false),
  leaveEnabled: z.boolean().default(false),
  joinChannelId: snowflake.nullable().default(null),
  leaveChannelId: snowflake.nullable().default(null),
  joinTemplateKey: z.string().min(1).default('greeting.join.default'),
  leaveTemplateKey: z.string().min(1).default('greeting.leave.default'),
  dmOnJoin: z.boolean().default(false),
  pingUser: z.boolean().default(true),
});

export const autoroleConfigSchema = z.object({
  enabled: z.boolean().default(false),
  humanRoleIds: z.array(snowflake).max(10).default([]),
  botRoleIds: z.array(snowflake).max(10).default([]),
  requireVerificationFirst: z.boolean().default(false),
});

export const autoThreadConfigSchema = z.object({
  enabled: z.boolean().default(false),
  channelIds: z.array(snowflake).max(25).default([]),
  threadNameTemplate: z.string().max(100).default('{author} — {date}'),
  autoArchiveMinutes: z.union([z.literal(60), z.literal(1440), z.literal(4320), z.literal(10080)]).default(1440),
  slowmodeSeconds: z.number().int().min(0).max(21600).default(0),
});

export const stickyConfigSchema = z.object({
  enabled: z.boolean().default(false),
  cooldownSeconds: z.number().int().min(5).max(3600).default(15),
});

export const suggestionConfigSchema = z.object({
  enabled: z.boolean().default(false),
  channelId: snowflake.nullable().default(null),
  reviewChannelId: snowflake.nullable().default(null),
  allowAnonymous: z.boolean().default(false),
  threadPerSuggestion: z.boolean().default(true),
  upvoteEmoji: z.string().default('⬆️'),
  downvoteEmoji: z.string().default('⬇️'),
});

export const pollConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxOptions: z.number().int().min(2).max(25).default(10),
  maxDurationMinutes: z.number().int().min(1).max(20160).default(1440),
  allowMultiChoiceDefault: z.boolean().default(false),
});

export const starboardConfigSchema = z.object({
  enabled: z.boolean().default(false),
  channelId: snowflake.nullable().default(null),
  emoji: z.string().default('⭐'),
  threshold: z.number().int().min(1).max(100).default(5),
  selfStarAllowed: z.boolean().default(false),
  ignoredChannelIds: z.array(snowflake).default([]),
  ignoreNsfw: z.boolean().default(true),
});

export const adminGuildConfigSchema = z.object({
  greeting: greetingConfigSchema.default({}),
  autorole: autoroleConfigSchema.default({}),
  autoThread: autoThreadConfigSchema.default({}),
  sticky: stickyConfigSchema.default({}),
  suggestion: suggestionConfigSchema.default({}),
  poll: pollConfigSchema.default({}),
  starboard: starboardConfigSchema.default({}),
});

export type AdminGuildConfig = z.infer<typeof adminGuildConfigSchema>;

// Global (ENV-level) kill switch, e.g. ADMIN_MODULE_ENABLED.
export const adminGlobalConfigSchema = z.object({
  moduleEnabled: z.boolean().default(true),
  maxStickyPerGuild: z.coerce.number().int().min(1).max(100).default(20),
  maxReactionBindingsPerMessage: z.coerce.number().int().min(1).max(20).default(20),
});
```

The config object is cached per guild (`cache.namespace('admin:cfg').get(guildId)`) and invalidated on any write.

---

## 9. Database

Prisma models added to `schema.prisma`. All carry `guildId`, `createdAt`, `updatedAt`, and soft-delete via `deletedAt` where records are user-managed. Indexes target every searchable / lookup field.

```prisma
enum RoleAssignmentMode { TOGGLE ADD_ONLY REMOVE_ONLY UNIQUE VERIFY }
enum SuggestionStatus   { PENDING APPROVED REJECTED IMPLEMENTED DUPLICATE }
enum PollState          { OPEN CLOSED CANCELLED }

model ReactionRoleBinding {
  id        String             @id @default(cuid())
  guildId   String
  channelId String
  messageId String
  emoji     String             // unicode or custom emoji id token
  roleId    String
  mode      RoleAssignmentMode @default(TOGGLE)
  groupKey  String?            // UNIQUE mode grouping
  createdAt DateTime           @default(now())
  updatedAt DateTime           @updatedAt
  deletedAt DateTime?

  @@unique([messageId, emoji, roleId])
  @@index([guildId])
  @@index([messageId])
}

model ButtonRoleSet {
  id         String           @id @default(cuid())
  guildId    String
  channelId  String
  messageId  String?
  title      String
  buttons    ButtonRoleItem[]
  createdAt  DateTime         @default(now())
  updatedAt  DateTime         @updatedAt
  deletedAt  DateTime?

  @@index([guildId])
  @@index([messageId])
}

model ButtonRoleItem {
  id        String             @id @default(cuid())
  setId     String
  set       ButtonRoleSet      @relation(fields: [setId], references: [id], onDelete: Cascade)
  roleId    String
  label     String
  emoji     String?
  style     Int                @default(1) // Discord ButtonStyle
  mode      RoleAssignmentMode @default(TOGGLE)

  @@index([setId])
}

model AutoroleConfig {
  guildId               String   @id
  enabled               Boolean  @default(false)
  humanRoleIds          Json     @default("[]")
  botRoleIds            Json     @default("[]")
  requireVerification   Boolean  @default(false)
  updatedAt             DateTime @updatedAt
}

model GreetingConfig {
  guildId         String   @id
  joinEnabled     Boolean  @default(false)
  leaveEnabled    Boolean  @default(false)
  joinChannelId   String?
  leaveChannelId  String?
  joinTemplateKey String   @default("greeting.join.default")
  leaveTemplateKey String  @default("greeting.leave.default")
  dmOnJoin        Boolean  @default(false)
  pingUser        Boolean  @default(true)
  updatedAt       DateTime @updatedAt
}

model AutoThreadConfig {
  guildId            String  @id
  enabled            Boolean @default(false)
  channelIds         Json    @default("[]")
  threadNameTemplate String  @default("{author} — {date}")
  autoArchiveMinutes Int     @default(1440)
  slowmodeSeconds    Int     @default(0)
  updatedAt          DateTime @updatedAt
}

model StickyMessage {
  id            String   @id @default(cuid())
  guildId       String
  channelId     String
  content       String   @db.Text
  embedJson     Json?
  lastMessageId String?
  active        Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  deletedAt     DateTime?

  @@unique([channelId])
  @@index([guildId])
}

model Suggestion {
  id         String           @id @default(cuid())
  guildId    String
  channelId  String
  messageId  String?
  threadId   String?
  authorId   String
  anonymous  Boolean          @default(false)
  content    String           @db.Text
  status     SuggestionStatus @default(PENDING)
  upvotes    Int              @default(0)
  downvotes  Int              @default(0)
  reason     String?
  moderatorId String?
  createdAt  DateTime         @default(now())
  updatedAt  DateTime         @updatedAt
  deletedAt  DateTime?
  votes      SuggestionVote[]

  @@index([guildId, status])
  @@index([authorId])
  @@index([messageId])
}

model SuggestionVote {
  suggestionId String
  suggestion   Suggestion @relation(fields: [suggestionId], references: [id], onDelete: Cascade)
  userId       String
  value        Int        // +1 / -1
  createdAt    DateTime   @default(now())

  @@id([suggestionId, userId])
}

model Poll {
  id            String       @id @default(cuid())
  guildId       String
  channelId     String
  messageId     String?
  authorId      String
  question      String       @db.Text
  multiChoice   Boolean      @default(false)
  state         PollState    @default(OPEN)
  closesAt      DateTime?
  closeJobId    String?
  options       PollOption[]
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt

  @@index([guildId, state])
  @@index([closesAt])
}

model PollOption {
  id      String     @id @default(cuid())
  pollId  String
  poll    Poll       @relation(fields: [pollId], references: [id], onDelete: Cascade)
  label   String
  emoji   String?
  votes   PollVote[]

  @@index([pollId])
}

model PollVote {
  optionId String
  option   PollOption @relation(fields: [optionId], references: [id], onDelete: Cascade)
  userId   String
  createdAt DateTime  @default(now())

  @@id([optionId, userId])
}

model StarboardConfig {
  guildId           String  @id
  enabled           Boolean @default(false)
  channelId         String?
  emoji             String  @default("⭐")
  threshold         Int     @default(5)
  selfStarAllowed   Boolean @default(false)
  ignoredChannelIds Json    @default("[]")
  ignoreNsfw        Boolean @default(true)
  updatedAt         DateTime @updatedAt
}

model StarboardEntry {
  id                String   @id @default(cuid())
  guildId           String
  sourceChannelId   String
  sourceMessageId   String
  starboardMessageId String?
  starCount         Int      @default(0)
  authorId          String
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@unique([guildId, sourceMessageId])
  @@index([guildId])
}

model EmbedTemplate {
  id        String   @id @default(cuid())
  guildId   String
  key       String   // e.g. "greeting.join.default", or a user key
  name      String
  payload   Json     // serialized embed (validated by Zod on write)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?

  @@unique([guildId, key])
  @@index([guildId])
}
```

**Soft-delete note:** records with `deletedAt` are excluded by repository default scopes; hard purge runs via a scheduled BullMQ cleanup job after a retention window.

---

## 10. API

REST endpoints (NestJS controllers, Swagger-documented). All are guild-scoped, JWT-authenticated, and permission-gated. DTOs are validated with `class-validator` mirroring the Zod schemas.

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| `GET` | `/guilds/:guildId/admin/config` | `admin.config.read` | Full resolved admin config. |
| `PATCH` | `/guilds/:guildId/admin/config/:feature` | `admin.config.write` | Update one feature's config. |
| `GET` | `/guilds/:guildId/admin/reaction-roles` | `admin.reactionrole.read` | Paginated bindings. |
| `POST` | `/guilds/:guildId/admin/reaction-roles` | `admin.reactionrole.manage` | Create binding. |
| `DELETE` | `/guilds/:guildId/admin/reaction-roles/:id` | `admin.reactionrole.manage` | Remove binding. |
| `GET` | `/guilds/:guildId/admin/suggestions` | `admin.suggestion.read` | Paginated + filter by status. |
| `PATCH` | `/guilds/:guildId/admin/suggestions/:id/status` | `admin.suggestion.moderate` | Change status. |
| `GET` | `/guilds/:guildId/admin/polls` | `admin.poll.read` | List polls + tallies. |
| `POST` | `/guilds/:guildId/admin/polls/:id/close` | `admin.poll.manage` | Force-close a poll. |
| `GET` | `/guilds/:guildId/admin/starboard` | `admin.starboard.read` | Paginated starboard entries. |
| `GET` | `/guilds/:guildId/admin/embeds` | `admin.embed.read` | List embed templates. |
| `PUT` | `/guilds/:guildId/admin/embeds/:key` | `admin.embed.manage` | Upsert embed template. |

```ts
// src/modules/admin/dto/poll.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsBoolean, IsInt, IsString, Max, Min } from 'class-validator';

export class CreatePollDto {
  @ApiProperty() @IsString() readonly question!: string;

  @ApiProperty({ type: [String] })
  @ArrayMinSize(2) @ArrayMaxSize(25) @IsString({ each: true })
  readonly options!: string[];

  @ApiProperty() @IsBoolean() readonly multiChoice!: boolean;

  @ApiProperty({ minimum: 1, maximum: 20160 })
  @IsInt() @Min(1) @Max(20160) readonly durationMinutes!: number;
}

export class PollView {
  @ApiProperty() readonly id!: string;
  @ApiProperty() readonly question!: string;
  @ApiProperty() readonly state!: 'OPEN' | 'CLOSED' | 'CANCELLED';
  @ApiProperty() readonly totalVotes!: number;
  @ApiProperty({ type: 'array' }) readonly options!: ReadonlyArray<{
    id: string; label: string; votes: number;
  }>;
}
```

**WebSocket:** the dashboard subscribes to `admin.*` domain events over the gateway WS namespace for live suggestion votes, poll tallies, and starboard updates.

---

## 11. Permissions

Wildcard-capable claims defined by this module (grantable to groups / roles, with inheritance):

```
admin.*                       # everything below
admin.config.read
admin.config.write
admin.reactionrole.read
admin.reactionrole.manage
admin.buttonrole.manage
admin.autorole.manage
admin.greeting.manage
admin.autothread.manage
admin.sticky.manage
admin.suggestion.read
admin.suggestion.create        # default: @everyone (configurable)
admin.suggestion.vote          # default: @everyone
admin.suggestion.moderate
admin.poll.create
admin.poll.read
admin.poll.manage              # close/cancel any poll
admin.starboard.read
admin.starboard.manage
admin.embed.read
admin.embed.manage
admin.setup.run                # run the setup wizard
```

Every slash command and REST endpoint declares its required claim. The Permissions core resolves wildcards (`admin.*` satisfies `admin.poll.manage`), groups, inheritance, and Discord-role mappings. Guild owners implicitly hold `admin.*`.

---

## 12. Logging

Structured Pino logs, categorised with a `category` field and the trace/correlation id.

| Category | Logged events |
| --- | --- |
| `admin.config` | Every config write: feature, actor, diff (before/after, secrets redacted). |
| `admin.roles` | Reaction/button role grant & revoke, autorole application, failures (missing role, hierarchy). |
| `admin.greeting` | Welcome/leave sent, DM fallback, template render errors. |
| `admin.engagement` | Suggestion create/vote/status change, poll open/close, starboard entry create/update. |
| `admin.thread` | Auto-thread created, sticky reposted (with cooldown skips at `debug`). |
| `admin.error` | Discord API errors, permission/hierarchy failures, Zod validation failures. |

**Audit hooks:** every state-changing operation (config writes, suggestion moderation, forced poll close, embed edits) calls the core audit logger with `{ guildId, actorId, action, targetId, metadata }`. These feed the dashboard audit view. User-facing errors are sanitised; internals never leak.

---

## 13. Testing

Framework: **Vitest** (unit/integration), **Playwright** (dashboard e2e). Coverage target ≥ 85% lines on services + domain.

**Unit (pure, mocked deps):**
- `PollTallyService`: tally aggregation, multi-choice, tie detection.
- `StarThresholdService`: threshold crossing, self-star exclusion, ignored channels/NSFW.
- `StickyCooldownService`: cooldown maths, repost decision.
- Zod schemas: defaults, bounds (max options, snowflake regex), rejection of invalid input.
- Reaction-role mode logic: `TOGGLE`/`ADD_ONLY`/`REMOVE_ONLY`/`UNIQUE` outcomes, idempotency.

**Integration (test DB + in-memory cache + fake Discord client):**
- Each repository: CRUD, soft-delete scoping, pagination, unique constraints.
- `SuggestionService`: create -> vote -> status change emits correct events; vote idempotency per user.
- `PollService`: create enqueues BullMQ close job; forced close emits `POLL_CLOSED`.
- Autorole on `guildMemberAdd`: human vs bot role sets, verification-gating.
- Starboard: reaction add crosses threshold -> entry created; below threshold -> updates count only.
- Cache invalidation on config write.

**E2E (Playwright, dashboard):**
- Edit greeting config + send test welcome.
- Create reaction-role binding from dashboard and verify it appears in Discord listing.
- Moderate a suggestion (approve) and confirm WS live update.

**Required coverage:** every emitted event has at least one assertion; every permission claim has a deny-path test; multi-guild isolation test (config of guild A never returned for guild B).

---

## 14. Dashboard Integration

The dashboard exposes a dedicated **Admin** section, one tab per feature, all reading/writing through the REST API in §10 and listening to `admin.*` WS events:

- **Overview / Setup Wizard** — re-run the guided setup; per-feature enable toggles with status badges.
- **Reaction & Button Roles** — visual binding editor (pick message, emoji/button, role, mode); list with pagination & search.
- **Autorole** — multi-select human/bot roles, verification toggle.
- **Greetings** — embed builder preview for join/leave templates, channel pickers, "send test" button.
- **Auto Threads & Sticky** — channel selectors, name template editor, sticky content/embed editor with live preview.
- **Suggestions** — moderation queue with status filters, inline approve/reject/implement, live vote counts.
- **Polls** — active/closed polls, live tallies (WS), force-close.
- **Starboard** — config + browsable entries with jump links.
- **Embed Builder** — full WYSIWYG embed editor, template library (CRUD), variable hints.

All labels and previews resolve via i18n (PT/EN). Every write surfaces validation errors from the shared Zod/DTO contract.

---

## 15. Future Extensions

- **Temporary roles** (auto-expire reaction/button roles after a duration via BullMQ).
- **Conditional autorole** (role based on invite link / source / screening answers).
- **Scheduled & recurring messages** beyond sticky (announcements on cron).
- **Suggestion categories & boards**, plus webhook export to external roadmap tools (via events).
- **Ranked-choice & weighted polls.**
- **Starboard leaderboards** (top starred authors / messages).
- **Form/modal builder** to extend the embed builder into full interactive forms.
- **AI-assisted setup wizard** suggesting config based on server type.
- **Per-feature analytics** surfaced to Grafana (engagement funnels).

---

## 16. Tasks for Claude

Execute in order; open one PR per phase against `develop`, never `main`.

**Phase 1 — Schema & migrations.** Add all Prisma models/enums in §9. Run `prisma migrate dev` to create migrations. Add repository default soft-delete scopes.

**Phase 2 — Config & Zod.** Implement `admin.config.schema.ts`, the resolver (`ENV -> DB -> Defaults`), and cache wiring with namespaced keys + invalidation.

**Phase 3 — Repositories.** Implement all repositories with pagination, unique-constraint handling, and mappers. Unit + integration tests.

**Phase 4 — Domain services.** `PollTallyService`, `StarThresholdService`, `StickyCooldownService`, value objects. Fully unit-tested, no I/O.

**Phase 5 — Application services.** One per feature (§4). Wire config, repos, cache, events, i18n. Keep methods < 50 lines.

**Phase 6 — Events & listeners.** Implement `admin.events.ts`, the four gateway listeners, and BullMQ workers (poll close, sticky debounce, starboard recount). Ensure idempotency.

**Phase 7 — Slash commands.** Implement Necord command handlers (§ slash list below), permission-gated, audit-emitting, i18n output.

**Phase 8 — Setup wizard.** Interactive multi-step wizard (buttons/selects/modals) orchestrating the per-feature services.

**Phase 9 — REST API & DTOs.** Controllers, DTOs, Swagger annotations, WS event fan-out for the dashboard.

**Phase 10 — Dashboard integration.** Build the Admin section tabs and live updates.

**Phase 11 — Tests.** Complete unit/integration/e2e coverage to target. Multi-guild isolation + permission deny-path tests.

**Phase 12 — Docs.** Update module README, command reference, and dashboard docs.

### Slash commands to implement

```
/reactionrole add <message> <emoji> <role> [mode]
/reactionrole remove <binding-id>
/reactionrole list
/buttonrole create <channel> <title>
/buttonrole addbutton <set-id> <role> <label> [emoji] [style] [mode]
/autorole set <role> [target:humans|bots]
/autorole clear
/autorole show
/greeting set <type:join|leave> <channel> [template]
/greeting test <type:join|leave>
/greeting toggle <type:join|leave> <enabled>
/autothread enable <channel> [name-template] [archive]
/autothread disable <channel>
/sticky set <channel> <content>
/sticky remove <channel>
/suggest <content>            # creates a suggestion
/suggestion status <id> <status> [reason]
/poll create <question> <options...> [duration] [multi]
/poll close <id>
/starboard config <emoji> <threshold> <channel>
/starboard toggle <enabled>
/embed create <name>          # opens modal builder
/embed send <key> <channel>
/embed edit <key>
/setup                        # launches the server setup wizard
```

---

## 17. Acceptance Criteria

- [ ] Reacting/un-reacting on a bound message grants/revokes the role idempotently; `UNIQUE` mode swaps roles within a group.
- [ ] Button-role sets render interactive components and toggle roles correctly.
- [ ] Autorole grants the correct role set for humans vs bots on join; honours verification gating.
- [ ] Join/leave messages send to the configured channel with variables interpolated and i18n-resolved; DM fallback works.
- [ ] Auto-thread creates a thread on every message in configured channels with the templated name and archive setting.
- [ ] Sticky message reposts to the channel bottom after activity, respecting the cooldown; only one active sticky per channel.
- [ ] Suggestions create with vote buttons; votes are one-per-user; status changes update the message/embed and emit events.
- [ ] Polls open with options, accept votes, close automatically at `closesAt` via BullMQ (or by force-close), and announce results.
- [ ] Starboard creates/updates an entry once the star threshold is crossed; respects self-star, ignored channels, NSFW.
- [ ] Embed builder stores, edits, renders (with variables), and sends templates.
- [ ] The setup wizard configures all features end-to-end.
- [ ] Every feature is independently toggleable per guild and isolated across guilds.
- [ ] All config writes are validated by Zod, cached, and invalidated on change.
- [ ] Every slash command and endpoint enforces its permission claim; deny paths return user-friendly errors.
- [ ] All user-facing text resolves via i18n (PT + EN).

---

## 18. Definition of Done

- [ ] All 12 phases merged via PRs into `develop` (no direct commits to `main`); Conventional Commits used.
- [ ] Prisma migrations created and committed; `prisma migrate` runs clean.
- [ ] TypeScript strict passes with **no `any`**; ESLint + Prettier clean; Husky/Commitlint green.
- [ ] Vitest unit + integration suites pass with ≥ 85% coverage on services/domain; Playwright e2e green.
- [ ] All emitted events covered by tests; multi-guild isolation and permission deny-path tests present.
- [ ] Swagger/OpenAPI updated for all endpoints; DTOs documented.
- [ ] Cache, Event Bus, Queue, Permissions, Config, and i18n integrations verified (no direct Redis/Prisma access outside the allowed layers).
- [ ] Prometheus metrics exposed; logs categorised; audit hooks firing.
- [ ] Module docs (README, command reference, dashboard guide) written and reviewed.
- [ ] PR(s) opened with description, screenshots/recordings of dashboard, and migration notes.
