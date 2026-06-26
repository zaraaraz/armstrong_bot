# Levels Module

> ## Claude Instructions
> - Never modify another module. Do not change architecture decisions from `00-project.md`.
> - Keep backwards compatibility. Create Prisma migrations for every schema change. Generate tests and docs.
> - Generate DTOs for every API boundary. Use the Repository Pattern. Use the Event Bus. Use Dependency Injection.
> - No `any`. Keep methods small (<50 lines where reasonable). Follow existing naming conventions.
> - Create indexes for searchable fields (guildId, userId, totalXp). Support pagination, caching, translations, dashboard.
> - Never touch Prisma outside a Repository. Never touch Redis outside the Cache layer. Never import another module's internal services — use the Event Bus or this module's published public API.
> - Everything is guild-aware unless explicitly marked global. All XP mutations must respect anti-farm cooldowns, no-XP channels/roles, and multipliers.
> - Rank-card image generation must never block the gateway — offload to a BullMQ job when generation is heavy.

---

## 1. Purpose

The Levels Module turns guild activity into a progression system. Members earn **XP** by sending messages and spending time in voice channels. XP accumulates into **levels** via a configurable curve, unlocks **role rewards**, and feeds **leaderboards** (per-guild and global) and **rank cards** (generated images). The module supports **prestige** (resetting level for a permanent badge), **XP multipliers** (time-windowed, per-role, per-channel, global events), and strict **anti-farm** protections (cooldowns, no-XP channels/roles, minimum message length).

This module is the single source of truth for "how much activity has this member contributed" and exposes that signal to the rest of Ghost Bot via the Event Bus and a published public API. It owns no moderation, economy, or ticket logic — it only measures and rewards engagement.

## 2. Goals

- **Accurate, abuse-resistant XP accounting.** Every grant passes through cooldown, channel/role exclusion, multiplier, and length checks before mutating state.
- **Configurable per guild.** Curve shape, XP ranges, cooldowns, voice rules, multipliers, role rewards, and prestige rules are all guild-scoped and Zod-validated.
- **Deterministic level math.** A pure, tested `LevelCurveService` converts XP <-> level with no side effects.
- **Fast reads.** Rank and leaderboard reads are served from the Cache layer; expensive rank-card images are produced asynchronously and cached.
- **Event-driven rewards.** Level-ups emit domain events; role rewards, announcements, and downstream modules react without tight coupling.
- **Dual leaderboards.** Per-guild ranking plus an opt-in aggregated global ranking.
- **Operable.** Logging, metrics, audit hooks, and a dashboard surface for every setting.

## 3. Architecture

The module follows the strict layer flow from the contract:

```
Discord Gateway (Necord listener)
        │  messageCreate / voiceStateUpdate
        ▼
LevelsEventListener ──▶ XpGrantService (Application)
                              │
                              ├─▶ XpPolicyService (Domain: cooldown, exclusions, multiplier resolution)
                              ├─▶ LevelCurveService (Domain: pure XP↔level math)
                              ├─▶ MemberLevelRepository (Repository → Prisma → MySQL)
                              ├─▶ CacheService (Core: rank/leaderboard cache)
                              └─▶ EventBus (Core: emits levels.xp.granted / levels.level.up)

LevelsController (REST) ──▶ LevelsQueryService (Application) ──▶ Repository / Cache
/rank /leaderboard /level (Necord) ──▶ LevelsQueryService / LevelsConfigService

RankCardProcessor (BullMQ worker) ──▶ RankCardRenderer (Domain) ──▶ Cache (image bytes)
RoleRewardListener (consumes levels.level.up) ──▶ Discord role grant via gateway
```

Key decisions:
- **No CQRS bus here** — the read/write split is achieved with two thin application services (`XpGrantService`, `LevelsQueryService`), which is enough for this unit.
- **Voice XP** is accrued by a recurring BullMQ job that ticks active voice sessions, not by busy-waiting.
- **Rank cards** are generated off the hot path. The slash command returns immediately with a "rendering" deferral; the worker fills the cache and the reply is edited.
- The **domain layer is pure**: `LevelCurveService` and `XpPolicyService` decision logic take inputs and return decisions; they never read Prisma/Redis directly.

## 4. Folder Structure

```
src/modules/levels/
├── levels.module.ts
├── index.ts                          # public API barrel (ONLY exported surface)
├── application/
│   ├── xp-grant.service.ts
│   ├── levels-query.service.ts
│   ├── levels-config.service.ts
│   └── prestige.service.ts
├── domain/
│   ├── level-curve.service.ts        # pure XP↔level math
│   ├── xp-policy.service.ts          # cooldown/exclusion/multiplier decisions
│   ├── rank-card.renderer.ts         # image composition
│   ├── entities/
│   │   ├── member-level.entity.ts
│   │   └── xp-multiplier.entity.ts
│   └── value-objects/
│       ├── level.vo.ts
│       └── xp-amount.vo.ts
├── infrastructure/
│   ├── repositories/
│   │   ├── member-level.repository.ts
│   │   ├── level-reward.repository.ts
│   │   └── xp-multiplier.repository.ts
│   └── jobs/
│       ├── voice-xp-tick.processor.ts
│       └── rank-card.processor.ts
├── presentation/
│   ├── commands/
│   │   ├── rank.command.ts
│   │   ├── leaderboard.command.ts
│   │   └── level-config.command.ts
│   ├── listeners/
│   │   ├── message-xp.listener.ts
│   │   ├── voice-xp.listener.ts
│   │   └── role-reward.listener.ts
│   └── api/
│       ├── levels.controller.ts
│       └── dto/
│           ├── rank-response.dto.ts
│           ├── leaderboard-query.dto.ts
│           ├── leaderboard-response.dto.ts
│           ├── update-levels-config.dto.ts
│           └── upsert-level-reward.dto.ts
├── contracts/
│   ├── levels.public-api.ts          # interface re-exported by index.ts
│   └── levels.events.ts              # event name + payload types
├── config/
│   └── levels.config.schema.ts       # Zod schemas + defaults
└── tests/
    ├── level-curve.service.spec.ts
    ├── xp-policy.service.spec.ts
    ├── xp-grant.service.spec.ts
    ├── prestige.service.spec.ts
    ├── leaderboard.integration.spec.ts
    └── levels.e2e.spec.ts
```

## 5. Public Interfaces

The module exposes **only** the following surface via `src/modules/levels/index.ts`. Other modules consume these through DI of the published API token; they never import internal services.

```typescript
// contracts/levels.public-api.ts
import type { Snowflake } from '../../../shared/types/discord';

/** A member's current progression snapshot. */
export interface MemberRank {
  readonly guildId: Snowflake;
  readonly userId: Snowflake;
  readonly level: number;
  readonly prestige: number;
  readonly totalXp: number;
  /** XP into the current level (0..xpForNextLevel). */
  readonly xpIntoLevel: number;
  /** XP required to reach the next level from the start of the current level. */
  readonly xpForNextLevel: number;
  /** 1-based rank within the guild (or global). */
  readonly position: number;
}

export interface LeaderboardEntry {
  readonly userId: Snowflake;
  readonly guildId: Snowflake | null; // null when global aggregate
  readonly level: number;
  readonly prestige: number;
  readonly totalXp: number;
  readonly position: number;
}

export interface Paginated<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export type LeaderboardScope = 'guild' | 'global';

/** Reason an external module wants to award XP (e.g. completing a quest). */
export interface ExternalXpAward {
  readonly guildId: Snowflake;
  readonly userId: Snowflake;
  readonly amount: number;
  readonly source: string; // free-form provenance, e.g. "quests:daily"
  /** When true, anti-farm cooldown is bypassed (trusted source). */
  readonly bypassCooldown?: boolean;
}

/**
 * Published API. Injected via LEVELS_PUBLIC_API token.
 * This is the ONLY way other modules read or influence levels.
 */
export abstract class LevelsPublicApi {
  abstract getRank(guildId: Snowflake, userId: Snowflake): Promise<MemberRank>;

  abstract getLeaderboard(
    scope: LeaderboardScope,
    guildId: Snowflake | null,
    page: number,
    pageSize: number,
  ): Promise<Paginated<LeaderboardEntry>>;

  /** Trusted, server-side XP award from another module. Returns the new rank. */
  abstract awardXp(award: ExternalXpAward): Promise<MemberRank>;

  abstract getLevel(guildId: Snowflake, userId: Snowflake): Promise<number>;
}
```

```typescript
// domain/level-curve.service.ts — pure, no I/O
export interface LevelCurveConfig {
  readonly baseXp: number;     // XP cost of level 1
  readonly factor: number;     // growth multiplier
  readonly curve: 'linear' | 'quadratic' | 'exponential';
}

export abstract class LevelCurveService {
  /** Total XP required to *reach* the given level from level 0. */
  abstract totalXpForLevel(level: number, config: LevelCurveConfig): number;
  /** Resolve a total XP value into level + progress within that level. */
  abstract resolve(
    totalXp: number,
    config: LevelCurveConfig,
  ): { level: number; xpIntoLevel: number; xpForNextLevel: number };
}
```

```typescript
// domain/xp-policy.service.ts — pure decision logic
export interface XpGrantContext {
  readonly guildId: string;
  readonly userId: string;
  readonly channelId: string;
  readonly memberRoleIds: readonly string[];
  readonly contentLength: number;     // 0 for voice ticks
  readonly lastMessageXpAt: Date | null;
  readonly now: Date;
  readonly kind: 'message' | 'voice' | 'external';
}

export interface XpDecision {
  readonly granted: boolean;
  readonly amount: number;            // already multiplier-applied
  readonly appliedMultiplier: number;
  readonly reason?: 'cooldown' | 'no-xp-channel' | 'no-xp-role' | 'too-short';
}

export abstract class XpPolicyService {
  abstract decide(ctx: XpGrantContext, settings: LevelsResolvedConfig): XpDecision;
}
```

## 6. Events

Event names are centralised in `contracts/levels.events.ts`. All payloads are guild-aware. Emitted through the Core Event Bus; never via raw Node EventEmitter.

```typescript
// contracts/levels.events.ts
export const LEVELS_EVENTS = {
  XP_GRANTED: 'levels.xp.granted',
  LEVEL_UP: 'levels.level.up',
  PRESTIGE: 'levels.prestige.gained',
  ROLE_REWARD_GRANTED: 'levels.role-reward.granted',
} as const;

export interface XpGrantedEvent {
  guildId: string;
  userId: string;
  amount: number;
  source: 'message' | 'voice' | 'external';
  newTotalXp: number;
  appliedMultiplier: number;
  occurredAt: string; // ISO-8601
}

export interface LevelUpEvent {
  guildId: string;
  userId: string;
  previousLevel: number;
  newLevel: number;
  prestige: number;
  totalXp: number;
  occurredAt: string;
}

export interface PrestigeEvent {
  guildId: string;
  userId: string;
  newPrestige: number;
  resetFromLevel: number;
  occurredAt: string;
}

export interface RoleRewardGrantedEvent {
  guildId: string;
  userId: string;
  roleId: string;
  level: number;
  occurredAt: string;
}
```

**Emitted:** `levels.xp.granted` (every accepted grant), `levels.level.up`, `levels.prestige.gained`, `levels.role-reward.granted`.

**Consumed (internally):**
- `RoleRewardListener` consumes `levels.level.up` to grant/remove Discord roles.
- An optional announcement handler consumes `levels.level.up` to post the level-up message in the configured channel.

**Consumed from other modules:** `guild.member.removed` (from the Guild/core lifecycle) to soft-delete a member's level row when they leave (configurable: keep vs purge).

## 7. Dependencies

Relies on CORE systems **only** — never on other modules' internals:

| Core system | Usage |
|-------------|-------|
| **Event Bus** | Emit `levels.*` events; consume `guild.member.removed`. |
| **Cache layer** | Rank snapshots, leaderboard pages, rendered rank-card bytes, cooldown markers. Namespaced keys `levels:*`. |
| **Permissions** | Guard `/level config` and config REST endpoints with `levels.config.*`. |
| **Database (Prisma)** | Via repositories only. |
| **Queue (BullMQ)** | `levels.voice-tick` (recurring), `levels.rank-card` (on-demand render). |
| **Config service** | Resolves ENV -> DB -> Defaults for guild settings. |
| **Logger (Pino)** | Structured logs + audit hooks. |
| **i18n** | Command replies, embeds, error messages (PT primary, EN secondary). |

Cross-module communication: other modules calling `LevelsPublicApi.awardXp(...)` or subscribing to `levels.*` events. The Levels module imports **no** other module.

## 8. Configuration

Guild-scoped and global settings, Zod-validated. Priority ENV -> Database -> Defaults.

```typescript
// config/levels.config.schema.ts
import { z } from 'zod';

export const levelCurveSchema = z.object({
  baseXp: z.number().int().min(10).max(10_000).default(100),
  factor: z.number().min(1).max(5).default(1.2),
  curve: z.enum(['linear', 'quadratic', 'exponential']).default('quadratic'),
});

export const xpMultiplierWindowSchema = z.object({
  multiplier: z.number().min(0).max(10),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
}).refine((v) => v.endsAt > v.startsAt, { message: 'endsAt must be after startsAt' });

export const levelsConfigSchema = z.object({
  enabled: z.boolean().default(true),

  // Message XP
  messageXpMin: z.number().int().min(0).max(1_000).default(15),
  messageXpMax: z.number().int().min(0).max(1_000).default(25),
  messageCooldownSeconds: z.number().int().min(0).max(3_600).default(60),
  minMessageLength: z.number().int().min(0).max(500).default(3),

  // Voice XP
  voiceXpEnabled: z.boolean().default(true),
  voiceXpPerMinute: z.number().int().min(0).max(500).default(5),
  voiceRequiresUnmuted: z.boolean().default(true),
  voiceRequiresOthersPresent: z.boolean().default(true),

  // Curve
  curve: levelCurveSchema.default({}),

  // Anti-farm exclusions
  noXpChannelIds: z.array(z.string()).default([]),
  noXpRoleIds: z.array(z.string()).default([]),

  // Multipliers
  globalMultiplier: z.number().min(0).max(10).default(1),
  roleMultipliers: z.record(z.string(), z.number().min(0).max(10)).default({}),
  channelMultipliers: z.record(z.string(), z.number().min(0).max(10)).default({}),
  eventWindows: z.array(xpMultiplierWindowSchema).max(20).default([]),

  // Level-up behaviour
  announceChannelId: z.string().nullable().default(null),
  announceLevelUp: z.boolean().default(true),
  stackRoleRewards: z.boolean().default(false), // false = remove previous reward role

  // Prestige
  prestigeEnabled: z.boolean().default(false),
  prestigeRequiredLevel: z.number().int().min(1).max(1_000).default(100),
  maxPrestige: z.number().int().min(1).max(100).default(10),

  // Leaderboard
  globalLeaderboardOptIn: z.boolean().default(false),

  // Lifecycle
  purgeOnLeave: z.boolean().default(false),
}).refine((v) => v.messageXpMax >= v.messageXpMin, {
  message: 'messageXpMax must be >= messageXpMin',
});

export type LevelsResolvedConfig = z.infer<typeof levelsConfigSchema>;

/** Global (non-guild) settings sourced from ENV. */
export const levelsGlobalSchema = z.object({
  RANK_CARD_RENDER_TIMEOUT_MS: z.coerce.number().int().default(8_000),
  GLOBAL_LEADERBOARD_ENABLED: z.coerce.boolean().default(true),
  VOICE_TICK_INTERVAL_SECONDS: z.coerce.number().int().min(15).max(300).default(60),
});
```

Defaults ship in code; per-guild overrides persist in the `GuildLevelsConfig` table; ENV overrides global behaviour.

## 9. Database

Prisma models. Soft-delete via `deletedAt`. Indexes target leaderboard sorts and lookups.

```prisma
model MemberLevel {
  id             String   @id @default(cuid())
  guildId        String
  userId         String
  totalXp        BigInt   @default(0)
  level          Int      @default(0)
  prestige       Int      @default(0)
  lastMessageXpAt DateTime?
  voiceSecondsAccrued BigInt @default(0)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  deletedAt      DateTime?

  @@unique([guildId, userId])
  @@index([guildId, totalXp(sort: Desc)])      // guild leaderboard
  @@index([totalXp(sort: Desc)])               // global leaderboard
  @@index([guildId, deletedAt])
  @@map("member_levels")
}

model LevelReward {
  id        String   @id @default(cuid())
  guildId   String
  level     Int
  roleId    String
  createdAt DateTime @default(now())
  deletedAt DateTime?

  @@unique([guildId, level])
  @@index([guildId])
  @@map("level_rewards")
}

model GuildLevelsConfig {
  id        String   @id @default(cuid())
  guildId   String   @unique
  config    Json     // validated against levelsConfigSchema on read/write
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("guild_levels_config")
}

model XpMultiplier {
  id         String   @id @default(cuid())
  guildId    String
  multiplier Float
  startsAt   DateTime
  endsAt     DateTime
  reason     String?
  createdAt  DateTime @default(now())
  deletedAt  DateTime?

  @@index([guildId, startsAt, endsAt])
  @@map("xp_multipliers")
}
```

Notes:
- `totalXp` is `BigInt` to survive long-lived guilds.
- Leaderboard reads use the composite `(guildId, totalXp DESC)` index; soft-deleted rows are filtered in the repository (`deletedAt IS NULL`).
- `GuildLevelsConfig.config` is a JSON blob always parsed through `levelsConfigSchema` — invalid blobs fall back to defaults and log a warning.

## 10. API

REST under `/api/v1/guilds/:guildId/levels`. All DTOs validated with Zod-derived class DTOs; Swagger-annotated.

| Method | Path | Auth (claim) | Description |
|--------|------|--------------|-------------|
| GET | `/levels/rank/:userId` | `levels.rank.view` | Member rank snapshot. |
| GET | `/levels/leaderboard?scope=&page=&pageSize=` | `levels.leaderboard.view` | Paginated leaderboard. |
| GET | `/levels/config` | `levels.config.view` | Current resolved config. |
| PATCH | `/levels/config` | `levels.config.edit` | Update guild config. |
| GET | `/levels/rewards` | `levels.config.view` | List role rewards. |
| PUT | `/levels/rewards` | `levels.config.edit` | Upsert a role reward. |
| DELETE | `/levels/rewards/:level` | `levels.config.edit` | Remove a role reward. |
| POST | `/levels/prestige/:userId` | `levels.prestige.manage` | Force/allow prestige. |

```typescript
// presentation/api/dto/leaderboard-query.dto.ts
import { ApiPropertyOptional } from '@nestjs/swagger';

export class LeaderboardQueryDto {
  @ApiPropertyOptional({ enum: ['guild', 'global'], default: 'guild' })
  scope: 'guild' | 'global' = 'guild';

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  page = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  pageSize = 25;
}

// presentation/api/dto/rank-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class RankResponseDto {
  @ApiProperty() userId!: string;
  @ApiProperty() guildId!: string;
  @ApiProperty() level!: number;
  @ApiProperty() prestige!: number;
  @ApiProperty() totalXp!: number;
  @ApiProperty() xpIntoLevel!: number;
  @ApiProperty() xpForNextLevel!: number;
  @ApiProperty() position!: number;
}

// presentation/api/dto/update-levels-config.dto.ts — partial of levelsConfigSchema
export class UpdateLevelsConfigDto {
  // Each field optional; validated through levelsConfigSchema.partial() in the service.
  // Declared explicitly for Swagger; omitted here for brevity but MUST be typed (no `any`).
}
```

No public WebSocket; the dashboard polls the REST endpoints and subscribes to a server-pushed `levels.level.up` over the existing dashboard WS gateway (owned by the dashboard core, not this module).

## 11. Permissions

Wildcard-friendly claims defined by this module (parent `levels.*`):

| Claim | Protects |
|-------|----------|
| `levels.rank.view` | Viewing any member's rank via API. |
| `levels.leaderboard.view` | Viewing leaderboards via API. |
| `levels.config.view` | Reading guild config + rewards. |
| `levels.config.edit` | `/level config`, config PATCH, reward upsert/delete. |
| `levels.prestige.manage` | Forcing prestige for another member. |
| `levels.xp.adjust` | Admin XP add/remove (future dashboard action). |

`/rank` and `/leaderboard` slash commands are open to all members by default (no claim) but respect `enabled`. `/level config` requires `levels.config.edit`. Claims integrate with the core permission system (groups, inheritance, Discord roles, wildcards like `levels.*`).

## 12. Logging

Structured Pino logs, category `levels`. Every log carries `guildId` and, where relevant, `userId`, `correlationId`.

- **`levels.xp`** — accepted grants (level: debug) and rejections with `reason` (level: debug). Sampled to avoid noise.
- **`levels.levelup`** — level-up (info) with old/new level.
- **`levels.prestige`** — prestige gained (info).
- **`levels.reward`** — role reward granted/removed (info), failures (warn) e.g. missing permission to assign role.
- **`levels.config`** — config changes (info) with actor `userId` — also written to the **audit log** via the audit hook.
- **`levels.rankcard`** — render duration (debug), render failure/timeout (warn).

Audit hooks fire on: config edit, reward upsert/delete, forced prestige, admin XP adjust. Prometheus metrics: `levels_xp_granted_total`, `levels_levelups_total`, `levels_rankcard_render_seconds`, `levels_voice_tick_duration_seconds`. OpenTelemetry spans wrap `awardXp`, rank-card render, and leaderboard queries.

## 13. Testing

| Layer | Coverage expectation |
|-------|----------------------|
| **Unit** | `LevelCurveService` (curve math monotonic, round-trip resolve), `XpPolicyService` (cooldown, no-xp channel/role, min length, multiplier stacking, event windows), `PrestigeService` (eligibility, max prestige, reset). |
| **Unit** | `XpGrantService` with mocked repo/cache/eventbus: emits `xp.granted`, detects level-up, emits `level.up`, idempotent voice ticks. |
| **Integration** | Repositories against a test MySQL (Prisma): leaderboard ordering, pagination, soft-delete filtering, unique constraint on `(guildId, userId)`. |
| **Integration** | Cache invalidation on XP mutation; voice-tick job accrual. |
| **e2e** | `/rank`, `/leaderboard`, `/level config` flows via Necord test harness; REST endpoints via Playwright/supertest hitting Swagger contract. |

Required: deterministic curve tests with fixed config; anti-farm tests proving a second message within the cooldown grants 0 XP; multiplier test proving role + channel + global + event-window multipliers combine per the documented rule. Min coverage 90% on `domain/` and `application/`.

## 14. Dashboard Integration

The dashboard exposes a **Levels** page per guild:
- **Settings form** bound to `levelsConfigSchema` (curve preview chart, XP ranges, cooldowns, voice rules, exclusions multiselect for channels/roles, prestige toggle).
- **Role rewards editor** — table of `level -> role`, add/remove, with `stackRoleRewards` toggle.
- **Multiplier scheduler** — create/edit time-windowed event multipliers; live "currently active multiplier" badge.
- **Leaderboard viewer** — guild + global tabs, paginated, search by user.
- **Rank-card preview** — renders the current card for a selected member (calls the render job, displays cached image).
- **Live level-up feed** — subscribes to `levels.level.up` over the dashboard WS.

All writes go through the REST endpoints in section 10 and are guarded by `levels.config.*` claims. Translatable labels via i18n namespaces (`levels.*`).

## 15. Future Extensions

- **Seasonal/weekly XP** with periodic resets and season leaderboards.
- **Configurable rank-card themes / uploaded backgrounds** per guild.
- **XP decay** for inactivity.
- **Achievements/badges** layered on top of level milestones (separate module consuming `levels.level.up`).
- **Cross-guild "global prestige"** ladder.
- **Per-category multipliers** (Discord channel categories).
- **GraphQL read API** alongside REST for the dashboard.

## 16. Tasks for Claude

**Phase 1 — Schema.** Add `MemberLevel`, `LevelReward`, `GuildLevelsConfig`, `XpMultiplier` to the Prisma schema with the indexes above. Create the migration. Generate the client.

**Phase 2 — Config & domain.** Implement `levels.config.schema.ts` (Zod + defaults). Implement pure `LevelCurveService` and `XpPolicyService` with full unit tests.

**Phase 3 — Repositories.** Implement `MemberLevelRepository`, `LevelRewardRepository`, `XpMultiplierRepository` (Repository Pattern, soft-delete filtering, pagination). Integration tests.

**Phase 4 — Application services.** Implement `XpGrantService` (policy -> curve -> repo -> cache -> events), `LevelsQueryService` (rank + leaderboard, cached), `PrestigeService`, `LevelsConfigService`.

**Phase 5 — Events.** Wire `EventBus` emissions; implement `RoleRewardListener` (consume `level.up`) and the announcement handler; consume `guild.member.removed`.

**Phase 6 — Listeners & jobs.** Implement `MessageXpListener`, `VoiceXpListener`, `voice-xp-tick.processor` (recurring BullMQ), `rank-card.processor` (on-demand render) and `RankCardRenderer`.

**Phase 7 — Commands.** Implement `/rank`, `/leaderboard`, `/level config` with deferral for rank cards and i18n replies.

**Phase 8 — Dashboard + API.** Implement `LevelsController` + DTOs + Swagger. Expose the dashboard surface per section 14.

**Phase 9 — Tests.** Complete unit/integration/e2e per section 13. Add Prometheus metrics + OTel spans.

**Phase 10 — Docs.** Update module README, public API docs, and the events catalogue.

## 17. Acceptance Criteria

- [ ] Sending a qualifying message grants XP within `[messageXpMin, messageXpMax]`, exactly once per `messageCooldownSeconds`.
- [ ] Messages in `noXpChannelIds`, from members with a `noXpRoleId`, or shorter than `minMessageLength` grant 0 XP.
- [ ] Voice XP accrues per minute via the tick job, honoring `voiceRequiresUnmuted` / `voiceRequiresOthersPresent`.
- [ ] Multipliers combine (global × role × channel × active event window) and are reflected in `appliedMultiplier`.
- [ ] Crossing a level boundary emits `levels.level.up` and grants the configured role reward (removing the prior one unless `stackRoleRewards`).
- [ ] Prestige resets level to 0, increments prestige, only at `prestigeRequiredLevel`, capped at `maxPrestige`.
- [ ] `/rank` returns a rendered rank card; `/leaderboard` paginates guild and (if opted-in) global standings.
- [ ] Leaderboard and rank reads are served from cache and invalidated on XP mutation.
- [ ] `/level config` and config REST require `levels.config.edit`; changes are audit-logged.
- [ ] `LevelsPublicApi.awardXp` works for trusted modules and respects `bypassCooldown`.
- [ ] No `any`; ESLint/Prettier clean; all settings Zod-validated.

## 18. Definition of Done

- [ ] All 18 sections implemented as specified; module exposes only its public API barrel.
- [ ] Prisma migration created and applied; client regenerated.
- [ ] Unit, integration, and e2e tests pass; coverage >= 90% on `domain/` and `application/`.
- [ ] Lint, format, typecheck, and Commitlint pass; no `any`, no Prisma/Redis access outside repositories/cache.
- [ ] Events documented in the catalogue; Swagger/OpenAPI updated for all endpoints.
- [ ] i18n keys added for PT and EN.
- [ ] Dashboard page wired to live endpoints.
- [ ] Prometheus metrics + OTel spans emitting.
- [ ] PR opened against `develop` from `feature/levels`, following Conventional Commits; no direct commits to `main`.
