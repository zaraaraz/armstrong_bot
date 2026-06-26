# Giveaways Module

> ## Claude Instructions
> - Never modify another module. Do not change architecture decisions from `00-project.md`.
> - Keep backwards compatibility. Create Prisma migrations. Generate tests and docs.
> - Generate DTOs. Use the Repository Pattern. Use the Event Bus. Use Dependency Injection.
> - No `any`. Keep methods small (<50 lines where reasonable). Follow existing naming.
> - Create indexes for searchable fields. Support pagination, caching, translations, dashboard.
> - This module is guild-aware. NEVER touch Prisma outside repositories, NEVER touch Redis outside the Cache layer.
> - All timed behaviour (auto-end) goes through BullMQ, never `setTimeout`. Communicate with other modules ONLY via the Event Bus or their published public API.
> - Entry counting (bonus/multiplier), winner selection, and reroll MUST be deterministic and unit-tested. Persist a draw seed so a reroll is auditable.

---

## 1. Purpose

The Giveaways Module lets guild staff run button-entry giveaways inside Discord channels. A user clicks a single **Enter** button on the giveaway message; the module validates entry **requirements** (minimum role, minimum level, minimum Discord account age, not blacklisted), computes the user's **weighted entry count** (base entries plus role/level **bonus and multiplier** rules), and records the participation. When the giveaway ends — either automatically via a BullMQ-scheduled job at `endsAt`, or manually — the module performs a deterministic weighted draw, selects one or more **winners**, announces them, and stores the draw result. Staff can **pause/resume**, **reroll** (replacing some or all winners while excluding previous ones), and **cancel** giveaways.

The module is fully multi-guild, i18n-aware (PT primary, EN secondary), permission-gated, cached, and observable.

## 2. Goals

- One-click **button entry** with idempotent participation (clicking twice never double-counts).
- Configurable **requirements**: min role(s), min level, min account age (days), guild-join age (days), blacklist.
- **Bonus / multiplier** entries driven by roles and levels (e.g. role `@Booster` → ×3, level ≥ 50 → +5 entries).
- **Scheduled auto-end** via BullMQ delayed jobs, resilient across restarts (re-hydrated from DB on boot).
- **Multiple winners** per giveaway with a single deterministic, seed-recorded weighted draw.
- **Reroll** that excludes prior winners (optionally) and is fully auditable via persisted seed + RNG cursor.
- **Pause/resume** that freezes entries without ending the giveaway.
- Slash commands for staff and a full dashboard configuration surface.
- Emit domain events so other modules (levels, audit, analytics) can react without coupling.
- Strict typing, no `any`, Zod-validated config, Repository Pattern, Cache layer, Event Bus.

## 3. Architecture

The module follows the strict layer flow from `00-project.md`:

```
Discord interaction (button / slash command)
      │
      ▼
GiveawayCommandsController (Necord)  ── REST: GiveawayHttpController (NestJS + Swagger)
      │
      ▼
Application Services
  ├─ GiveawayService            (create/start/pause/resume/cancel/end/reroll orchestration)
  ├─ GiveawayEntryService       (button entry, requirement checks, weight computation)
  └─ GiveawayDrawService        (deterministic weighted winner selection)
      │
      ▼
Domain Services
  ├─ EntryWeightCalculator      (pure: rules + member context → entry weight)
  ├─ RequirementEvaluator       (pure: rules + member context → pass/fail reasons)
  └─ WeightedDrawEngine         (pure: entries + seed + count + excludes → winners)
      │
      ▼
Repositories (ONLY layer touching Prisma)
  ├─ GiveawayRepository
  ├─ GiveawayEntryRepository
  └─ GiveawayWinnerRepository
      │
      ▼
MySQL (via Prisma)
```

CORE collaborators used through their abstractions only:

- **Event Bus** — publish/consume domain events.
- **Cache layer** — namespaced, TTL'd reads of giveaway state and entry counts.
- **Queue (BullMQ)** — `giveaways` queue for scheduled end + end-processing with retries/DLQ.
- **Permissions** — claim checks for staff actions.
- **Config** — Zod-validated guild + global settings (ENV → DB → defaults).
- **i18n** — `giveaways` namespace for all user-facing strings.
- **Logger (Pino)** — categorised, traceable logs + audit hooks.

CQRS is **not** used here — the read/write asymmetry does not justify it. Reads go through cached repository methods.

## 4. Folder Structure

```
src/modules/giveaways/
├── giveaways.module.ts
├── index.ts                          # public API barrel (the ONLY external surface)
├── giveaways.public.ts               # published contract: types + GiveawaysPublicApi token
├── application/
│   ├── giveaway.service.ts
│   ├── giveaway-entry.service.ts
│   └── giveaway-draw.service.ts
├── domain/
│   ├── entities/
│   │   ├── giveaway.entity.ts
│   │   ├── giveaway-entry.entity.ts
│   │   └── giveaway-winner.entity.ts
│   ├── services/
│   │   ├── entry-weight.calculator.ts
│   │   ├── requirement.evaluator.ts
│   │   └── weighted-draw.engine.ts
│   ├── value-objects/
│   │   ├── giveaway-status.vo.ts
│   │   ├── entry-rule.vo.ts
│   │   └── requirement-set.vo.ts
│   └── errors/
│       └── giveaway.errors.ts
├── infrastructure/
│   ├── repositories/
│   │   ├── giveaway.repository.ts
│   │   ├── giveaway-entry.repository.ts
│   │   └── giveaway-winner.repository.ts
│   └── persistence/
│       └── giveaway.mapper.ts        # Prisma row <-> domain entity
├── presentation/
│   ├── discord/
│   │   ├── giveaway.commands.ts      # Necord slash commands
│   │   ├── giveaway.buttons.ts       # button interaction handlers
│   │   └── giveaway.embeds.ts        # embed/component builders (i18n-aware)
│   └── http/
│       ├── giveaway.http-controller.ts
│       └── dto/
│           ├── create-giveaway.dto.ts
│           ├── update-giveaway.dto.ts
│           ├── reroll-giveaway.dto.ts
│           ├── giveaway-query.dto.ts
│           └── giveaway-response.dto.ts
├── jobs/
│   ├── giveaway-end.processor.ts     # BullMQ worker for the `giveaways` queue
│   └── giveaway-queue.constants.ts
├── events/
│   ├── giveaway.events.ts            # event name constants + payload types
│   └── giveaway.listeners.ts         # consumed events (e.g. member leave)
└── config/
    └── giveaways.config.ts           # Zod schema + defaults
```

## 5. Public Interfaces

Strict TypeScript exposed by `giveaways.public.ts`. Other modules import ONLY from here.

```ts
export const GIVEAWAYS_PUBLIC_API = Symbol('GiveawaysPublicApi');

export type GiveawayStatus =
  | 'SCHEDULED'
  | 'RUNNING'
  | 'PAUSED'
  | 'ENDED'
  | 'CANCELLED';

export type RequirementKind = 'ROLE' | 'LEVEL' | 'ACCOUNT_AGE' | 'GUILD_AGE';

export interface GiveawayRequirement {
  readonly kind: RequirementKind;
  /** Role IDs for ROLE; numeric threshold (level / days) otherwise. */
  readonly roleIds?: readonly string[];
  readonly threshold?: number;
}

export type EntryRuleEffect = 'BONUS' | 'MULTIPLIER';

export interface EntryRule {
  readonly kind: Extract<RequirementKind, 'ROLE' | 'LEVEL'>;
  readonly roleId?: string;
  readonly minLevel?: number;
  readonly effect: EntryRuleEffect;
  /** BONUS: integer entries added. MULTIPLIER: factor applied (e.g. 3 = ×3). */
  readonly value: number;
}

export interface GiveawaySummary {
  readonly id: string;
  readonly guildId: string;
  readonly channelId: string;
  readonly messageId: string | null;
  readonly prize: string;
  readonly winnerCount: number;
  readonly status: GiveawayStatus;
  readonly entryCount: number;
  readonly endsAt: Date | null;
  readonly createdAt: Date;
}

export interface GiveawayWinnerInfo {
  readonly userId: string;
  readonly weight: number;
  readonly isReroll: boolean;
}

/** The published contract. Read-only + safe actions only; no Prisma leakage. */
export interface GiveawaysPublicApi {
  getGiveaway(guildId: string, giveawayId: string): Promise<GiveawaySummary | null>;
  listActive(guildId: string): Promise<readonly GiveawaySummary[]>;
  getWinners(guildId: string, giveawayId: string): Promise<readonly GiveawayWinnerInfo[]>;
  /** True if the user currently has a valid entry. */
  hasEntered(guildId: string, giveawayId: string, userId: string): Promise<boolean>;
}
```

Key internal application-service contracts:

```ts
export interface CreateGiveawayInput {
  readonly guildId: string;
  readonly channelId: string;
  readonly prize: string;
  readonly description?: string;
  readonly winnerCount: number;
  readonly durationMs: number;
  readonly requirements: readonly GiveawayRequirement[];
  readonly entryRules: readonly EntryRule[];
  readonly createdByUserId: string;
}

export interface RerollInput {
  readonly guildId: string;
  readonly giveawayId: string;
  readonly count: number;
  /** Exclude previously drawn winners from the new draw. Default true. */
  readonly excludePreviousWinners: boolean;
  readonly actorUserId: string;
}

export abstract class GiveawayService {
  abstract create(input: CreateGiveawayInput): Promise<GiveawaySummary>;
  abstract pause(guildId: string, id: string, actorUserId: string): Promise<void>;
  abstract resume(guildId: string, id: string, actorUserId: string): Promise<void>;
  abstract cancel(guildId: string, id: string, actorUserId: string): Promise<void>;
  abstract end(guildId: string, id: string, actorUserId: string | null): Promise<readonly GiveawayWinnerInfo[]>;
  abstract reroll(input: RerollInput): Promise<readonly GiveawayWinnerInfo[]>;
}

export interface EnterResult {
  readonly accepted: boolean;
  readonly weight: number;
  readonly failedReasons: readonly string[]; // i18n keys
}

export abstract class GiveawayEntryService {
  abstract enter(guildId: string, giveawayId: string, member: MemberContext): Promise<EnterResult>;
  abstract withdraw(guildId: string, giveawayId: string, userId: string): Promise<void>;
}

/** Member snapshot passed in by presentation layer — no Discord types leak into domain. */
export interface MemberContext {
  readonly userId: string;
  readonly roleIds: readonly string[];
  readonly level: number;
  readonly accountCreatedAt: Date;
  readonly joinedGuildAt: Date | null;
}
```

Domain (pure) services:

```ts
export abstract class EntryWeightCalculator {
  /** Returns final integer weight (>= 1). Multipliers apply to base+bonus. */
  abstract compute(rules: readonly EntryRule[], member: MemberContext, baseEntries: number): number;
}

export interface RequirementResult {
  readonly passed: boolean;
  readonly failedReasons: readonly string[]; // i18n keys, e.g. 'giveaways.req.level'
}

export abstract class RequirementEvaluator {
  abstract evaluate(
    requirements: readonly GiveawayRequirement[],
    member: MemberContext,
    blacklistedUserIds: ReadonlySet<string>,
    now: Date,
  ): RequirementResult;
}

export interface WeightedCandidate {
  readonly userId: string;
  readonly weight: number;
}

export abstract class WeightedDrawEngine {
  /** Deterministic given the same seed. Excludes are removed before drawing. */
  abstract draw(
    candidates: readonly WeightedCandidate[],
    winnerCount: number,
    seed: string,
    excludeUserIds: ReadonlySet<string>,
  ): readonly string[];
}
```

## 6. Events

All names live in `giveaway.events.ts` and are namespaced `giveaways.*`. Published on the CORE Event Bus.

**Emitted:**

```ts
export const GiveawayEvents = {
  Created: 'giveaways.created',
  Started: 'giveaways.started',
  Entered: 'giveaways.entered',
  EntryRejected: 'giveaways.entry_rejected',
  Withdrawn: 'giveaways.withdrawn',
  Paused: 'giveaways.paused',
  Resumed: 'giveaways.resumed',
  Ended: 'giveaways.ended',
  Rerolled: 'giveaways.rerolled',
  Cancelled: 'giveaways.cancelled',
} as const;

export interface GiveawayEnteredPayload {
  guildId: string;
  giveawayId: string;
  userId: string;
  weight: number;
  entryCount: number;
}

export interface GiveawayEndedPayload {
  guildId: string;
  giveawayId: string;
  prize: string;
  winnerUserIds: string[];
  totalEntries: number;
  drawSeed: string;
}

export interface GiveawayRerolledPayload {
  guildId: string;
  giveawayId: string;
  newWinnerUserIds: string[];
  replacedWinnerUserIds: string[];
  actorUserId: string;
}
```

**Consumed** (via `giveaway.listeners.ts`):

- `members.left` (from a member-lifecycle source) → optionally invalidate the leaver's entry if `removeEntryOnLeave` is enabled.
- `levels.level_up` (published payload) → no state change; used only to bust the cached weight for that user so the next entry recomputes. Consumed via Event Bus, never by importing the levels module.

## 7. Dependencies

CORE systems only — no direct module imports.

| CORE system | Usage |
|-------------|-------|
| **Event Bus** | Emit lifecycle events; consume `members.left`, `levels.level_up`. |
| **Cache layer** | Namespace `giveaways:`. Keys: `giveaways:active:{guildId}`, `giveaways:gw:{id}`, `giveaways:count:{id}`, `giveaways:entered:{id}:{userId}`. TTL 300s, busted on writes. |
| **Queue (BullMQ)** | Queue `giveaways`. Job `giveaway.end` (delayed to `endsAt`), retries (3, exponential), DLQ. Re-hydrated on boot. |
| **Permissions** | Claim checks for staff actions (see §11). |
| **Config** | Zod-validated guild + global settings. |
| **Database** | Through repositories only. |
| **i18n** | `giveaways` namespace, PT/EN, plurals for "1 entry / N entries". |
| **Logger** | Categorised logs + audit hooks. |

Member level + role data is supplied to the domain via `MemberContext`, assembled in the presentation layer from Discord member state and the **levels public API** (read-only contract), never by importing levels internals.

## 8. Configuration

Guild-scoped and global settings, Zod-validated, priority ENV → DB → Defaults.

```ts
import { z } from 'zod';

export const giveawayGuildConfigSchema = z.object({
  defaultWinnerCount: z.number().int().min(1).max(50).default(1),
  defaultDurationMs: z.number().int().min(60_000).max(2_592_000_000).default(86_400_000), // 1m..30d, def 1d
  maxConcurrentActive: z.number().int().min(1).max(200).default(25),
  baseEntries: z.number().int().min(1).max(100).default(1),
  maxBonusEntries: z.number().int().min(0).max(1_000).default(50),
  maxMultiplier: z.number().int().min(1).max(100).default(10),
  removeEntryOnLeave: z.boolean().default(true),
  pingRoleId: z.string().regex(/^\d{17,20}$/).nullable().default(null),
  embedColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#5865F2'),
  blacklistRoleIds: z.array(z.string().regex(/^\d{17,20}$/)).max(25).default([]),
});
export type GiveawayGuildConfig = z.infer<typeof giveawayGuildConfigSchema>;

export const giveawayGlobalConfigSchema = z.object({
  endJobConcurrency: z.number().int().min(1).max(50).default(5),
  maxRequirementsPerGiveaway: z.number().int().min(0).max(20).default(10),
  maxEntryRulesPerGiveaway: z.number().int().min(0).max(20).default(10),
  drawHmacSecret: z.string().min(16), // from ENV; used to derive draw seed
});
export type GiveawayGlobalConfig = z.infer<typeof giveawayGlobalConfigSchema>;
```

`drawHmacSecret` MUST come from ENV. The persisted `drawSeed` is `HMAC(secret, giveawayId + ":" + drawNonce)` so draws are reproducible for audit but not predictable by users.

## 9. Database

Prisma models. Soft-delete via `deletedAt` on `Giveaway`. Entries are hard-scoped to a giveaway and removed on cascade; winners are retained for audit (never hard-deleted).

```prisma
enum GiveawayStatus {
  SCHEDULED
  RUNNING
  PAUSED
  ENDED
  CANCELLED
}

model Giveaway {
  id            String          @id @default(cuid())
  guildId       String
  channelId     String
  messageId     String?
  prize         String          @db.VarChar(256)
  description   String?         @db.Text
  winnerCount   Int             @default(1)
  baseEntries   Int             @default(1)
  status        GiveawayStatus  @default(SCHEDULED)
  requirements  Json            // GiveawayRequirement[]
  entryRules    Json            // EntryRule[]
  blacklist     Json            // string[] userIds
  drawSeed      String?         // set at end; HMAC-derived
  drawNonce     Int             @default(0) // bumped per reroll for fresh seed
  endsAt        DateTime?
  endedAt       DateTime?
  pausedAt      DateTime?
  createdByUserId String
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt
  deletedAt     DateTime?

  entries       GiveawayEntry[]
  winners       GiveawayWinner[]

  @@index([guildId, status])
  @@index([status, endsAt])         // for boot re-hydration of pending ends
  @@index([guildId, createdAt])
  @@unique([messageId])
}

model GiveawayEntry {
  id          String    @id @default(cuid())
  giveawayId  String
  guildId     String
  userId      String
  weight      Int       @default(1)
  createdAt   DateTime  @default(now())

  giveaway    Giveaway  @relation(fields: [giveawayId], references: [id], onDelete: Cascade)

  @@unique([giveawayId, userId])    // idempotent entry
  @@index([guildId, userId])
}

model GiveawayWinner {
  id          String    @id @default(cuid())
  giveawayId  String
  guildId     String
  userId      String
  weight      Int
  isReroll    Boolean   @default(false)
  drawNonce   Int
  createdAt   DateTime  @default(now())

  giveaway    Giveaway  @relation(fields: [giveawayId], references: [id], onDelete: Cascade)

  @@index([giveawayId, drawNonce])
  @@index([guildId, userId])
}
```

Notes:
- `@@unique([giveawayId, userId])` on entries enforces idempotency at the DB layer — a double-click cannot double-count.
- `requirements`, `entryRules`, `blacklist` are stored as typed JSON and validated with Zod on read/write in the repository.
- Soft-deleted giveaways are filtered (`deletedAt: null`) in all repository read queries.

## 10. API

REST under `/api/v1/guilds/:guildId/giveaways`, NestJS + Swagger. All DTOs validated with Zod pipes; pagination on list.

| Method | Path | Claim | Body / Query | Description |
|--------|------|-------|--------------|-------------|
| `POST` | `/` | `giveaways.manage` | `CreateGiveawayDto` | Create + start a giveaway. |
| `GET` | `/` | `giveaways.view` | `GiveawayQueryDto` (status, page, pageSize) | Paginated list. |
| `GET` | `/:id` | `giveaways.view` | — | Single giveaway + entry count. |
| `PATCH` | `/:id` | `giveaways.manage` | `UpdateGiveawayDto` | Edit prize/description/requirements (only while SCHEDULED/RUNNING). |
| `POST` | `/:id/pause` | `giveaways.manage` | — | Pause entries. |
| `POST` | `/:id/resume` | `giveaways.manage` | — | Resume. |
| `POST` | `/:id/end` | `giveaways.manage` | — | End now, draw winners. |
| `POST` | `/:id/reroll` | `giveaways.reroll` | `RerollGiveawayDto` | Reroll N winners. |
| `POST` | `/:id/blacklist` | `giveaways.manage` | `{ userId: string }` | Add to blacklist + remove entry. |
| `DELETE` | `/:id` | `giveaways.manage` | — | Soft-delete (cancels if active). |

```ts
export class CreateGiveawayDto {
  channelId!: string;
  prize!: string;
  description?: string;
  winnerCount!: number;
  durationMs!: number;
  requirements!: GiveawayRequirement[];
  entryRules!: EntryRule[];
}

export class RerollGiveawayDto {
  count!: number;
  excludePreviousWinners = true;
}

export class GiveawayResponseDto {
  id!: string;
  prize!: string;
  status!: GiveawayStatus;
  winnerCount!: number;
  entryCount!: number;
  endsAt!: string | null;
  winnerUserIds!: string[];
}
```

WS: a `/ws/guilds/:guildId/giveaways` channel pushes `entryCount` updates and `status` transitions to the dashboard in real time (emitted off the Event Bus listeners).

## 11. Permissions

Claims defined by this module (wildcard `giveaways.*` grants all):

| Claim | Grants |
|-------|--------|
| `giveaways.view` | Read giveaways + winners via API/dashboard. |
| `giveaways.manage` | Create, edit, pause, resume, end, cancel, blacklist. |
| `giveaways.reroll` | Reroll winners. |
| `giveaways.enter` | Click the entry button (default granted to `@everyone`; can be revoked). |

Checks run through the CORE Permissions service. Slash commands and REST endpoints both resolve the actor's effective claims (groups, inheritance, Discord roles, wildcards) before executing.

## 12. Logging

Pino, category `giveaways`. Structured fields: `guildId`, `giveawayId`, `userId`, `actorUserId`, `event`, `traceId`.

- **info**: create, start, pause/resume, end (with winner count + total entries), reroll, cancel.
- **debug**: each accepted entry (`weight`, computed rule breakdown), cache hits/misses, job scheduling.
- **warn**: entry rejected (with failed-reason keys), reroll requested with insufficient remaining candidates, message not found when announcing.
- **error**: draw engine failure, queue job failure (before retry/DLQ), Discord API failure on announce.

Audit hooks: `create`, `end`, `reroll`, `cancel`, `blacklist` write an audit record (actor, action, before/after snapshot) through the CORE audit channel so the moderation/audit module can consume it via the Event Bus. The persisted `drawSeed` + `drawNonce` make every winner selection independently reproducible.

## 13. Testing

Vitest (unit/integration) + Playwright (dashboard e2e).

**Unit (pure domain — highest coverage, deterministic):**
- `EntryWeightCalculator`: base only; single bonus; single multiplier; stacked bonus+multiplier; multiplier order (applies to base+bonus); clamping at `maxBonusEntries`/`maxMultiplier`; minimum weight 1.
- `RequirementEvaluator`: each requirement kind pass/fail; account-age and guild-age boundary at `now`; blacklist hit; multiple failures aggregate all i18n reason keys.
- `WeightedDrawEngine`: determinism (same seed ⇒ same winners); winners unique; excludes removed; `winnerCount > candidates` returns all candidates; weight bias is statistically correct over many seeds; empty candidate set returns `[]`.

**Integration:**
- Entry idempotency: concurrent double-click yields exactly one entry (DB unique constraint).
- BullMQ end job schedules at `endsAt`, fires once, transitions `RUNNING → ENDED`, persists winners + seed.
- Boot re-hydration: pending `endsAt` giveaways re-enqueue their end jobs on startup.
- Pause blocks entry; resume restores it.
- Reroll excludes previous winners, bumps `drawNonce`, persists new winners with `isReroll = true`.
- Cache busting on entry/end.

**E2E (Playwright dashboard):** create giveaway via dashboard → appears in list → live entry count updates → end → winners shown; reroll flow.

Coverage gate: domain services ≥ 95%, application services ≥ 85%.

## 14. Dashboard Integration

Dashboard section **Giveaways** (guild-scoped):

- **List view**: paginated table (prize, status badge, entry count, winners, ends-in countdown), filter by status.
- **Create/Edit form**: channel picker, prize, description, winner count, duration picker, requirement builder (role/level/account-age/guild-age rows), entry-rule builder (role/level → bonus/multiplier with value), blacklist editor.
- **Detail view**: live entry count (WS), winner list, "End now", "Pause/Resume", "Reroll (N)", "Cancel" buttons gated by claims.
- **Settings panel**: edits `giveawayGuildConfigSchema` values (defaults, limits, ping role, embed color, blacklist roles, remove-on-leave).
- All labels translated via the `giveaways` i18n namespace. Actions reflect the user's effective permission claims (disabled when not granted).

## 15. Future Extensions

- **Entry conditions via other modules** (e.g. "must have an open ticket closed", "minimum economy balance") — consumed via published public APIs / Event Bus, never direct imports.
- **Recurring giveaways** (weekly) using BullMQ repeatable jobs.
- **Per-user entry caps** and **invite-based bonus entries**.
- **Anti-abuse**: alt-account heuristics, captcha-on-entry for high-value prizes.
- **Multi-channel / cross-guild network giveaways** (global, opt-in).
- **DM winner notification** + claim-by-deadline with auto-reroll if unclaimed.

## 16. Tasks for Claude

Execute in order; one PR per logical phase off `feature/giveaways`.

1. **Schema**: add `Giveaway`, `GiveawayEntry`, `GiveawayWinner` models + `GiveawayStatus` enum; create Prisma migration; add indexes/uniques as specified.
2. **Config**: implement `giveaways.config.ts` Zod schemas + defaults; wire into CORE config (ENV → DB → defaults).
3. **Repositories**: implement the three repositories + mapper; soft-delete filtering; JSON Zod validation; cache integration (read-through, write-bust).
4. **Domain services**: implement `EntryWeightCalculator`, `RequirementEvaluator`, `WeightedDrawEngine` (pure, fully unit-tested) + value objects + errors.
5. **Application services**: `GiveawayService`, `GiveawayEntryService`, `GiveawayDrawService` with DI; emit events; enforce config limits + permissions.
6. **Events**: define event constants/payloads; implement listeners for `members.left` and `levels.level_up`.
7. **Queue**: `giveaway-end.processor.ts`, scheduling at `endsAt`, retries/DLQ, boot re-hydration of pending ends.
8. **Discord commands + buttons**: implement Necord slash commands and the entry button handler + i18n embeds.
9. **REST API**: HTTP controller, DTOs, Zod pipes, Swagger annotations, pagination, WS channel.
10. **Dashboard**: list/create/edit/detail/settings views + live WS updates.
11. **Public API**: implement `GiveawaysPublicApi` and export only via `index.ts`/`giveaways.public.ts`.
12. **Tests**: unit, integration, e2e per §13; meet coverage gates.
13. **Docs**: update module README + Swagger; verify this spec matches implementation.

## 17. Acceptance Criteria

- A staff member can run `/giveaway start <prize> <duration> [winners] [channel]` and a giveaway message with an **Enter** button appears.
- Clicking **Enter** when requirements pass records exactly one entry with the correct computed weight; clicking again does not duplicate it.
- Clicking **Enter** when a requirement fails shows an ephemeral, translated reason and records no entry.
- Bonus and multiplier rules produce the documented weights (multiplier applies to base + bonus), clamped to config limits.
- At `endsAt`, the BullMQ job ends the giveaway exactly once, draws the configured number of distinct winners weighted by entries, announces them, and persists winners + `drawSeed`.
- `/giveaway reroll <id> [count]` replaces winners, excludes previous winners by default, is reproducible from the persisted seed, and marks new rows `isReroll = true`.
- `/giveaway pause` and `/giveaway resume` correctly freeze/unfreeze entries without ending the giveaway.
- Multiple simultaneous active giveaways per guild work up to `maxConcurrentActive`.
- All staff actions are permission-gated, logged, and audited; restart re-hydrates pending end jobs.
- The dashboard reflects live entry counts and exposes all actions gated by claims.

## 18. Definition of Done

- All 18 sections implemented and matching the code.
- Vitest unit + integration suites pass; domain ≥ 95%, application ≥ 85% coverage; Playwright e2e green.
- Prisma migration created, named, and applied cleanly; no drift.
- `npm run lint` and `prettier --check` clean; no `any`; commitlint passing; Husky hooks green.
- Swagger docs generated for all endpoints; i18n PT + EN strings present for every user-facing key.
- Cache, Event Bus, Queue, Permissions, Config used only through their CORE abstractions — no direct Prisma/Redis access outside the designated layers, no cross-module internal imports.
- PR opened against `develop` following Conventional Commits; reviewed; CI green.
