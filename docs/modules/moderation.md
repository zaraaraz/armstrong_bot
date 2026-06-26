# Moderation Module

> ## Claude Instructions
> - Never modify another module. Do not change architecture decisions from `00-project.md`.
> - Keep backwards compatibility. Create Prisma migrations for every schema change. Generate tests and docs alongside code.
> - Generate DTOs for every endpoint. Use the Repository Pattern — only repositories touch Prisma. Use the Event Bus for cross-module communication. Use Dependency Injection everywhere.
> - No `any`. Keep methods small (<50 lines where reasonable). Follow existing naming conventions.
> - Create indexes for searchable fields (guildId, userId, caseNumber, type). Support pagination, caching (via the Cache layer, never Redis directly), translations (PT primary, EN secondary), and dashboard exposure.
> - Everything is guild-aware. Config priority is ENV -> Database -> Defaults, validated with Zod.
> - Controllers NEVER touch Prisma. Modules NEVER import another module's internal services.
> - All long-running or delayed actions (tempban expiry, timeout expiry, scheduled unmute) go through BullMQ, never `setTimeout`.

---

## 1. Purpose

The Moderation Module is the enforcement core of Ghost Bot. It provides server staff with a complete, auditable toolkit for keeping guilds safe and orderly, and provides an autonomous **AutoMod rule engine** that reacts to message and member events in real time without human intervention.

It unifies two concerns under a single **Case / Infraction** model:

1. **Manual moderation actions** issued by staff via slash commands or the dashboard: `ban`, `tempban`, `softban`, `kick`, `warn`, `timeout`, `mute`, `jail`, `slowmode`, `lock`/`unlock`, `purge`, and `mass-role`.
2. **Automated moderation (AutoMod)** triggered by configurable rules: anti-spam, anti-raid, anti-link, anti-mention, anti-scam, anti-invite, anti-ghost-ping, and a verification gate for new members.

Every action — manual or automated — produces a durable, traceable **Case** with a per-guild sequential case number, a full **infraction history** per user, and an audit trail. Every action is reversible where Discord allows (unban, unmute, untimeout, unjail) and every delayed reversal is scheduled through BullMQ.

The module is the source of truth for "what happened to whom, by whom, and why" in a guild.

---

## 2. Goals

- **Complete action coverage.** Implement all manual actions and all AutoMod protections listed above, each as a small, testable application service.
- **Unified case system.** Every enforcement action — including AutoMod hits — is recorded as a `Case` with a guild-scoped sequential `caseNumber`, severity, reason, evidence, and reversal metadata.
- **Reversibility & scheduling.** Tempbans, timeouts, mutes, and jails expire automatically via BullMQ delayed jobs. Manual reversal (`/unban`, `/unmute`, `/unjail`) is always available and cancels the pending job.
- **Configurable AutoMod engine.** Each protection is a rule with guild-scoped Zod-validated config: thresholds, time windows, actions, exemptions (roles/channels/users), and an action escalation ladder.
- **Escalation ladder.** Repeated infractions escalate automatically (warn -> mute -> tempban -> ban) based on configurable point thresholds with decay.
- **Idempotency & safety.** No double-punishment for the same event; respect role hierarchy; never act on guild owner or higher-ranked staff; dry-run mode for new rules.
- **Full auditability.** Every action emits a typed event, writes an audit log entry, and is queryable/filterable from the dashboard.
- **i18n everywhere.** All user-facing DM notifications, command responses, and AutoMod reasons are translated (PT primary, EN secondary) with variable interpolation.
- **Performance.** Hot paths (AutoMod message evaluation) read rule config from the Cache layer, not the database.

---

## 3. Architecture

The module follows the strict layer flow from `00-project.md`:

```
Discord (Necord command / gateway event)
        │
        ▼
ModerationController (slash commands)            AutoModListener (gateway events)
        │                                                │
        ▼                                                ▼
Application Services  (BanService, WarnService, TimeoutService, PurgeService, MassRoleService,
                       CaseService, EscalationService, AutoModEngineService)
        │
        ▼
Domain Services       (InfractionPolicy, EscalationPolicy, HierarchyGuard, RuleEvaluator)
        │
        ▼
Repositories          (CaseRepository, AutoModRuleRepository, ModSettingsRepository)
        │
        ▼
Prisma -> MySQL
```

Key design points:

- **Controllers never touch Prisma or business rules.** They parse the slash-command input into a DTO, resolve the actor/guild context, and delegate to an application service.
- **AutoMod is event-driven.** `AutoModListener` subscribes to `messageCreate`, `guildMemberAdd`, `messageUpdate`, and `messageDelete` (via the Core Event Bus adapter over the Discord gateway), and forwards normalized payloads to `AutoModEngineService`.
- **RuleEvaluator is a pure domain service.** Given a normalized event and a rule config, it returns a verdict (`pass | violation`) with a reason. This makes the engine fully unit-testable without Discord.
- **HierarchyGuard** is a shared domain guard that prevents acting on users the actor (or the bot) cannot moderate.
- **EscalationPolicy** computes the next action from accumulated infraction points.
- **CQRS** is applied lightly: case writes go through command-style services; case history reads go through a dedicated query path optimized with indexes and caching. No separate event-sourcing store.
- **Delayed reversals** are enqueued to BullMQ (`moderation` queue) with the case id as job data and a stable jobId for cancellation.

---

## 4. Folder Structure

```
src/modules/moderation/
├── moderation.module.ts
├── index.ts                              # public API barrel (ONLY exported surface)
├── api/
│   ├── moderation.public.ts              # ModerationPublicApi contract for other modules
│   └── moderation.events.ts             # exported event names + payload types
├── application/
│   ├── services/
│   │   ├── ban.service.ts
│   │   ├── kick.service.ts
│   │   ├── warn.service.ts
│   │   ├── timeout.service.ts
│   │   ├── mute.service.ts
│   │   ├── jail.service.ts
│   │   ├── channel-state.service.ts      # slowmode, lock/unlock
│   │   ├── purge.service.ts
│   │   ├── mass-role.service.ts
│   │   ├── case.service.ts
│   │   ├── escalation.service.ts
│   │   └── automod-engine.service.ts
│   └── dto/
│       ├── create-case.dto.ts
│       ├── ban.dto.ts
│       ├── warn.dto.ts
│       ├── timeout.dto.ts
│       ├── purge.dto.ts
│       ├── mass-role.dto.ts
│       ├── automod-rule.dto.ts
│       └── query-cases.dto.ts
├── domain/
│   ├── case.entity.ts
│   ├── infraction-points.vo.ts
│   ├── case-type.enum.ts
│   ├── case-status.enum.ts
│   ├── automod-rule-type.enum.ts
│   ├── policies/
│   │   ├── infraction.policy.ts
│   │   └── escalation.policy.ts
│   ├── guards/
│   │   └── hierarchy.guard.ts
│   └── automod/
│       ├── rule-evaluator.ts             # pure verdict engine
│       ├── verdict.ts
│       └── detectors/
│           ├── anti-spam.detector.ts
│           ├── anti-raid.detector.ts
│           ├── anti-link.detector.ts
│           ├── anti-mention.detector.ts
│           ├── anti-scam.detector.ts
│           ├── anti-invite.detector.ts
│           └── anti-ghost-ping.detector.ts
├── infrastructure/
│   ├── repositories/
│   │   ├── case.repository.ts
│   │   ├── automod-rule.repository.ts
│   │   └── mod-settings.repository.ts
│   └── prisma/
│       └── case-number.allocator.ts      # atomic per-guild sequence
├── presentation/
│   ├── commands/
│   │   ├── moderation.controller.ts      # /ban /kick /warn /timeout ...
│   │   ├── channel.controller.ts         # /slowmode /lock /unlock /purge
│   │   ├── case.controller.ts            # /case /history /reason /delcase
│   │   └── automod.controller.ts         # /automod ...
│   └── listeners/
│       ├── automod.listener.ts           # gateway -> engine
│       └── verification.listener.ts      # join gate
├── jobs/
│   ├── unban.processor.ts
│   ├── unmute.processor.ts
│   ├── untimeout.processor.ts
│   ├── unjail.processor.ts
│   └── points-decay.processor.ts         # recurring
├── config/
│   └── moderation.config.schema.ts       # Zod schemas + defaults
└── moderation.constants.ts
```

---

## 5. Public Interfaces

These are the **only** types other modules and the dashboard may depend on. Internal services are never imported across module boundaries.

```typescript
// src/modules/moderation/domain/case-type.enum.ts
export enum CaseType {
  Ban = 'BAN',
  TempBan = 'TEMP_BAN',
  SoftBan = 'SOFT_BAN',
  Unban = 'UNBAN',
  Kick = 'KICK',
  Warn = 'WARN',
  Timeout = 'TIMEOUT',
  Untimeout = 'UNTIMEOUT',
  Mute = 'MUTE',
  Unmute = 'UNMUTE',
  Jail = 'JAIL',
  Unjail = 'UNJAIL',
  Note = 'NOTE',
}

// src/modules/moderation/domain/case-status.enum.ts
export enum CaseStatus {
  Active = 'ACTIVE',
  Expired = 'EXPIRED',
  Revoked = 'REVOKED',
  Deleted = 'DELETED',
}

// src/modules/moderation/domain/automod-rule-type.enum.ts
export enum AutoModRuleType {
  AntiSpam = 'ANTI_SPAM',
  AntiRaid = 'ANTI_RAID',
  AntiLink = 'ANTI_LINK',
  AntiMention = 'ANTI_MENTION',
  AntiScam = 'ANTI_SCAM',
  AntiInvite = 'ANTI_INVITE',
  AntiGhostPing = 'ANTI_GHOST_PING',
  Verification = 'VERIFICATION',
}

// src/modules/moderation/domain/automod/verdict.ts
export interface AutoModVerdict {
  readonly violated: boolean;
  readonly ruleType: AutoModRuleType;
  readonly reasonKey: string;          // i18n key, never raw text
  readonly reasonVars: Readonly<Record<string, string | number>>;
  readonly severity: number;           // 0..100, feeds escalation points
}
```

```typescript
// src/modules/moderation/domain/case.entity.ts
export interface ModerationCase {
  readonly id: string;
  readonly guildId: string;
  readonly caseNumber: number;         // sequential within the guild
  readonly type: CaseType;
  readonly status: CaseStatus;
  readonly targetUserId: string;
  readonly moderatorId: string;        // bot id when source = AUTOMOD
  readonly source: CaseSource;
  readonly reason: string | null;
  readonly points: number;             // infraction points contributed
  readonly evidence: ReadonlyArray<string>;
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
  readonly expiresAt: Date | null;     // null = permanent / non-expiring
  readonly revokedById: string | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type CaseSource = 'MANUAL' | 'AUTOMOD' | 'API' | 'DASHBOARD';
```

```typescript
// src/modules/moderation/api/moderation.public.ts
export interface CaseHistory {
  readonly userId: string;
  readonly guildId: string;
  readonly activePoints: number;
  readonly totalCases: number;
  readonly cases: ReadonlyArray<ModerationCase>;
}

/**
 * The ONLY surface other modules may consume.
 * Resolved through DI by token MODERATION_PUBLIC_API.
 */
export abstract class ModerationPublicApi {
  /** Read-only infraction history for a user in a guild (cached). */
  abstract getUserHistory(guildId: string, userId: string): Promise<CaseHistory>;

  /** Current active infraction points for escalation decisions. */
  abstract getActivePoints(guildId: string, userId: string): Promise<number>;

  /** True if the user currently has an active jail/mute/timeout/ban case. */
  abstract isCurrentlyRestricted(guildId: string, userId: string): Promise<boolean>;

  /** Programmatically open a case (e.g. from another module via event). */
  abstract recordExternalCase(input: RecordExternalCaseInput): Promise<ModerationCase>;
}

export interface RecordExternalCaseInput {
  readonly guildId: string;
  readonly targetUserId: string;
  readonly type: CaseType;
  readonly reasonKey: string;
  readonly points: number;
  readonly source: 'API';
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}
```

```typescript
// Representative application-service contracts (internal, DI-injected)
export interface IBanService {
  ban(dto: BanDto): Promise<ModerationCase>;
  tempBan(dto: TempBanDto): Promise<ModerationCase>;
  softBan(dto: SoftBanDto): Promise<ModerationCase>;
  unban(dto: UnbanDto): Promise<ModerationCase>;
}

export interface ICaseService {
  open(dto: CreateCaseDto): Promise<ModerationCase>;
  revoke(guildId: string, caseNumber: number, byUserId: string): Promise<ModerationCase>;
  setReason(guildId: string, caseNumber: number, reason: string): Promise<ModerationCase>;
  softDelete(guildId: string, caseNumber: number, byUserId: string): Promise<void>;
  findByNumber(guildId: string, caseNumber: number): Promise<ModerationCase | null>;
}

export interface IAutoModEngineService {
  evaluateMessage(ctx: NormalizedMessageContext): Promise<void>;
  evaluateJoin(ctx: NormalizedJoinContext): Promise<void>;
  evaluateDeletion(ctx: NormalizedDeletionContext): Promise<void>;
}
```

---

## 6. Events

All events flow through the Core **Event Bus** (never direct module imports). Names are namespaced `moderation.*`.

### Emitted

```typescript
// src/modules/moderation/api/moderation.events.ts
export const MODERATION_EVENTS = {
  CaseCreated: 'moderation.case.created',
  CaseRevoked: 'moderation.case.revoked',
  CaseDeleted: 'moderation.case.deleted',
  UserBanned: 'moderation.user.banned',
  UserUnbanned: 'moderation.user.unbanned',
  UserKicked: 'moderation.user.kicked',
  UserWarned: 'moderation.user.warned',
  UserTimedOut: 'moderation.user.timed_out',
  UserMuted: 'moderation.user.muted',
  UserJailed: 'moderation.user.jailed',
  AutoModTriggered: 'moderation.automod.triggered',
  EscalationApplied: 'moderation.escalation.applied',
  RaidDetected: 'moderation.automod.raid_detected',
  VerificationPassed: 'moderation.verification.passed',
} as const;

export interface CaseCreatedPayload {
  readonly guildId: string;
  readonly caseNumber: number;
  readonly caseId: string;
  readonly type: CaseType;
  readonly targetUserId: string;
  readonly moderatorId: string;
  readonly source: CaseSource;
  readonly points: number;
  readonly occurredAt: string; // ISO-8601
}

export interface AutoModTriggeredPayload {
  readonly guildId: string;
  readonly ruleType: AutoModRuleType;
  readonly targetUserId: string;
  readonly channelId: string | null;
  readonly reasonKey: string;
  readonly actionTaken: CaseType | 'DELETE_MESSAGE' | 'NONE';
  readonly caseNumber: number | null;
  readonly occurredAt: string;
}

export interface RaidDetectedPayload {
  readonly guildId: string;
  readonly joinCount: number;
  readonly windowSeconds: number;
  readonly mitigation: 'LOCKDOWN' | 'KICK_NEW' | 'VERIFICATION_FORCED';
  readonly occurredAt: string;
}
```

### Consumed (from the gateway adapter / other modules)

| Event | Source | Reaction |
|-------|--------|----------|
| `discord.messageCreate` | Gateway adapter | Feed `AutoModEngineService.evaluateMessage` |
| `discord.messageUpdate` | Gateway adapter | Re-evaluate edited content (anti-link/scam/invite) |
| `discord.messageDelete` | Gateway adapter | Anti-ghost-ping detection |
| `discord.guildMemberAdd` | Gateway adapter | Anti-raid + verification gate |
| `guild.settings.updated` | Config module (public event) | Invalidate cached mod settings for guild |

---

## 7. Dependencies

Only **CORE** systems — never another feature module directly.

| Core system | Usage |
|-------------|-------|
| **Event Bus** | Emit all `moderation.*` events; consume normalized gateway events. |
| **Cache layer** | Cache per-guild AutoMod rule configs, mod settings, and per-user active points. Namespaced keys, TTL. No direct Redis. |
| **Permissions** | Resolve actor claims (`moderation.*`) before any command executes; check Discord role hierarchy via `HierarchyGuard`. |
| **Database (Prisma)** | Through repositories only. |
| **Queue (BullMQ)** | `moderation` queue for delayed reversals (unban/unmute/untimeout/unjail) and a recurring points-decay job. DLQ on repeated failure. |
| **i18n** | Translate DM notifications, command replies, AutoMod reasons (PT/EN, namespaces `moderation`, `automod`). |
| **Logging (Pino)** | Structured logs + audit hooks. |
| **Config** | Loads guild + global settings with priority ENV -> DB -> Defaults. |
| **Discord adapter (Necord)** | Issue actual ban/kick/timeout/role changes; the bot's own permission/hierarchy is validated first. |

The module exposes `ModerationPublicApi` for other modules (e.g. a Tickets module that wants to show a user's history).

---

## 8. Configuration

All settings are guild-scoped (with global fallbacks) and validated with Zod. Priority: **ENV -> Database -> Defaults**.

```typescript
// src/modules/moderation/config/moderation.config.schema.ts
import { z } from 'zod';

export const exemptionsSchema = z.object({
  roleIds: z.array(z.string()).default([]),
  channelIds: z.array(z.string()).default([]),
  userIds: z.array(z.string()).default([]),
});

const automodActionSchema = z.enum([
  'NONE',
  'DELETE_MESSAGE',
  'WARN',
  'TIMEOUT',
  'MUTE',
  'KICK',
  'TEMP_BAN',
  'BAN',
]);

export const antiSpamSchema = z.object({
  enabled: z.boolean().default(false),
  maxMessages: z.number().int().min(2).max(50).default(6),
  perSeconds: z.number().int().min(1).max(60).default(5),
  maxDuplicates: z.number().int().min(2).max(20).default(4),
  action: automodActionSchema.default('TIMEOUT'),
  timeoutSeconds: z.number().int().min(10).max(2419200).default(300),
  points: z.number().int().min(0).max(100).default(10),
  exemptions: exemptionsSchema.default({}),
});

export const antiRaidSchema = z.object({
  enabled: z.boolean().default(false),
  joinThreshold: z.number().int().min(2).max(200).default(10),
  windowSeconds: z.number().int().min(5).max(300).default(30),
  mitigation: z.enum(['LOCKDOWN', 'KICK_NEW', 'VERIFICATION_FORCED']).default('VERIFICATION_FORCED'),
  newAccountAgeHours: z.number().int().min(0).max(8760).default(72),
  points: z.number().int().min(0).max(100).default(0),
});

export const antiLinkSchema = z.object({
  enabled: z.boolean().default(false),
  allowList: z.array(z.string()).default([]), // allowed domains
  blockList: z.array(z.string()).default([]),
  action: automodActionSchema.default('DELETE_MESSAGE'),
  points: z.number().int().min(0).max(100).default(3),
  exemptions: exemptionsSchema.default({}),
});

export const antiMentionSchema = z.object({
  enabled: z.boolean().default(false),
  maxMentions: z.number().int().min(1).max(50).default(5),
  maxRoleMentions: z.number().int().min(0).max(20).default(2),
  action: automodActionSchema.default('TIMEOUT'),
  points: z.number().int().min(0).max(100).default(15),
  exemptions: exemptionsSchema.default({}),
});

export const antiScamSchema = z.object({
  enabled: z.boolean().default(true),
  useBlocklistFeed: z.boolean().default(true), // known scam-domain feed
  heuristics: z.boolean().default(true),       // nitro/steam-gift patterns
  action: automodActionSchema.default('BAN'),
  points: z.number().int().min(0).max(100).default(60),
  exemptions: exemptionsSchema.default({}),
});

export const antiInviteSchema = z.object({
  enabled: z.boolean().default(false),
  allowOwnGuild: z.boolean().default(true),
  whitelistedGuildIds: z.array(z.string()).default([]),
  action: automodActionSchema.default('DELETE_MESSAGE'),
  points: z.number().int().min(0).max(100).default(5),
  exemptions: exemptionsSchema.default({}),
});

export const antiGhostPingSchema = z.object({
  enabled: z.boolean().default(false),
  notifyChannelId: z.string().nullable().default(null),
  action: automodActionSchema.default('WARN'),
  points: z.number().int().min(0).max(100).default(2),
});

export const verificationSchema = z.object({
  enabled: z.boolean().default(false),
  mode: z.enum(['BUTTON', 'CAPTCHA', 'REACTION']).default('BUTTON'),
  verifiedRoleId: z.string().nullable().default(null),
  unverifiedRoleId: z.string().nullable().default(null),
  gateChannelId: z.string().nullable().default(null),
  kickAfterMinutes: z.number().int().min(0).max(1440).default(0), // 0 = never
});

export const escalationStepSchema = z.object({
  atPoints: z.number().int().min(1).max(1000),
  action: automodActionSchema,
  durationSeconds: z.number().int().min(0).max(2419200).default(0),
});

export const moderationConfigSchema = z.object({
  // Manual moderation defaults
  dmOnAction: z.boolean().default(true),
  defaultTempBanSeconds: z.number().int().min(60).max(31536000).default(86400),
  softBanDeleteDays: z.number().int().min(0).max(7).default(1),
  defaultTimeoutSeconds: z.number().int().min(10).max(2419200).default(600),
  modLogChannelId: z.string().nullable().default(null),
  jailRoleId: z.string().nullable().default(null),
  muteRoleId: z.string().nullable().default(null),
  requireReason: z.boolean().default(false),
  purgeMaxMessages: z.number().int().min(1).max(1000).default(100),

  // Escalation
  escalation: z.object({
    enabled: z.boolean().default(true),
    pointDecayPerDay: z.number().int().min(0).max(100).default(5),
    steps: z.array(escalationStepSchema).default([
      { atPoints: 20, action: 'MUTE', durationSeconds: 3600 },
      { atPoints: 50, action: 'TEMP_BAN', durationSeconds: 86400 },
      { atPoints: 100, action: 'BAN', durationSeconds: 0 },
    ]),
  }).default({}),

  // AutoMod
  automod: z.object({
    dryRun: z.boolean().default(false),
    antiSpam: antiSpamSchema.default({}),
    antiRaid: antiRaidSchema.default({}),
    antiLink: antiLinkSchema.default({}),
    antiMention: antiMentionSchema.default({}),
    antiScam: antiScamSchema.default({}),
    antiInvite: antiInviteSchema.default({}),
    antiGhostPing: antiGhostPingSchema.default({}),
    verification: verificationSchema.default({}),
  }).default({}),
});

export type ModerationConfig = z.infer<typeof moderationConfigSchema>;
```

---

## 9. Database

Prisma models. All money-less, all guild-aware, soft-delete via `status = DELETED` + `deletedAt`. Indexes cover all searchable/filterable fields.

```prisma
// prisma/schema.prisma (moderation additions)

enum CaseType {
  BAN
  TEMP_BAN
  SOFT_BAN
  UNBAN
  KICK
  WARN
  TIMEOUT
  UNTIMEOUT
  MUTE
  UNMUTE
  JAIL
  UNJAIL
  NOTE
}

enum CaseStatus {
  ACTIVE
  EXPIRED
  REVOKED
  DELETED
}

enum CaseSource {
  MANUAL
  AUTOMOD
  API
  DASHBOARD
}

enum AutoModRuleType {
  ANTI_SPAM
  ANTI_RAID
  ANTI_LINK
  ANTI_MENTION
  ANTI_SCAM
  ANTI_INVITE
  ANTI_GHOST_PING
  VERIFICATION
}

model ModerationCase {
  id           String     @id @default(cuid())
  guildId      String
  caseNumber   Int
  type         CaseType
  status       CaseStatus @default(ACTIVE)
  source       CaseSource @default(MANUAL)
  targetUserId String
  moderatorId  String
  reason       String?    @db.Text
  points       Int        @default(0)
  evidence     Json       @default("[]")
  metadata     Json       @default("{}")
  expiresAt    DateTime?
  revokedById  String?
  revokedAt    DateTime?
  deletedAt    DateTime?
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt

  @@unique([guildId, caseNumber])
  @@index([guildId, targetUserId, status])
  @@index([guildId, type])
  @@index([guildId, status, expiresAt])
  @@index([guildId, createdAt])
  @@map("moderation_cases")
}

// Atomic per-guild case-number sequence
model ModerationCaseCounter {
  guildId String @id
  current Int    @default(0)

  @@map("moderation_case_counters")
}

model AutoModRule {
  id        String          @id @default(cuid())
  guildId   String
  type      AutoModRuleType
  enabled   Boolean         @default(false)
  config    Json            @default("{}")  // validated by Zod on read/write
  createdAt DateTime        @default(now())
  updatedAt DateTime        @updatedAt

  @@unique([guildId, type])
  @@index([guildId, enabled])
  @@map("automod_rules")
}

model ModerationSettings {
  guildId   String   @id
  config    Json     @default("{}") // moderationConfigSchema-validated
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("moderation_settings")
}

// Tracks short-lived join bursts for anti-raid (also mirrored in cache)
model RaidWindowEntry {
  id        String   @id @default(cuid())
  guildId   String
  userId    String
  joinedAt  DateTime @default(now())

  @@index([guildId, joinedAt])
  @@map("raid_window_entries")
}
```

**Notes**

- `caseNumber` is allocated atomically from `ModerationCaseCounter` inside the same transaction as the case insert (see `case-number.allocator.ts`) using `UPDATE ... SET current = current + 1` then read, preventing gaps/races.
- Soft delete: `status = DELETED` + `deletedAt` set. Queries default to excluding `DELETED`. Case numbers are never reused.
- `evidence` and `metadata` are typed `Json` but always written through DTOs with strict types — never `any`.
- `RaidWindowEntry` is pruned by the recurring points-decay/cleanup job.

---

## 10. API

REST under `/api/v1/guilds/:guildId/moderation`, Swagger-documented, JWT + permission guarded. WS used for live mod-log streaming.

| Method | Path | Permission | Description |
|--------|------|-----------|-------------|
| GET | `/cases` | `moderation.case.view` | Paginated, filterable case list |
| GET | `/cases/:caseNumber` | `moderation.case.view` | Single case |
| PATCH | `/cases/:caseNumber/reason` | `moderation.case.edit` | Edit reason |
| POST | `/cases/:caseNumber/revoke` | `moderation.case.revoke` | Revoke (unban/unmute/etc.) |
| DELETE | `/cases/:caseNumber` | `moderation.case.delete` | Soft-delete |
| GET | `/users/:userId/history` | `moderation.case.view` | Full infraction history |
| POST | `/actions/ban` | `moderation.ban` | Issue ban from dashboard |
| POST | `/actions/warn` | `moderation.warn` | Issue warn |
| POST | `/actions/timeout` | `moderation.timeout` | Issue timeout |
| GET | `/automod` | `moderation.automod.view` | All rule configs |
| PUT | `/automod/:type` | `moderation.automod.manage` | Update a rule config |
| GET | `/settings` | `moderation.settings.view` | Module settings |
| PUT | `/settings` | `moderation.settings.manage` | Update settings |
| WS | `/ws/modlog` | `moderation.case.view` | Live stream of `moderation.case.*` |

```typescript
// src/modules/moderation/application/dto/query-cases.dto.ts
export class QueryCasesDto {
  page = 1;
  pageSize = 25;          // max enforced server-side at 100
  type?: CaseType;
  status?: CaseStatus;
  targetUserId?: string;
  moderatorId?: string;
  source?: CaseSource;
  from?: string;          // ISO date
  to?: string;            // ISO date
}

// src/modules/moderation/application/dto/ban.dto.ts
export class BanDto {
  readonly guildId!: string;
  readonly targetUserId!: string;
  readonly moderatorId!: string;
  readonly reasonKey?: string;
  readonly reason?: string;
  readonly deleteMessageSeconds?: number; // 0..604800
  readonly source: CaseSource = 'DASHBOARD';
}

export class TempBanDto extends BanDto {
  readonly durationSeconds!: number;      // > 0
}

export class PaginatedCasesResponseDto {
  readonly items!: ModerationCase[];
  readonly page!: number;
  readonly pageSize!: number;
  readonly total!: number;
}
```

All responses use the unified error envelope from Core; internals are never leaked.

### Discord Slash Commands

```
/ban <user> [reason] [delete_days]
/tempban <user> <duration> [reason]
/softban <user> [reason]
/unban <user_id> [reason]
/kick <user> [reason]
/warn <user> <reason>
/timeout <user> <duration> [reason]
/untimeout <user> [reason]
/mute <user> [duration] [reason]
/unmute <user> [reason]
/jail <user> [reason]
/unjail <user> [reason]
/slowmode <seconds> [channel]
/lock [channel] [reason]
/unlock [channel]
/purge <count> [user] [contains]
/massrole add|remove <role> [filter]
/case <number>
/history <user>
/reason <number> <text>
/delcase <number>
/automod <rule> enable|disable|config
/automod status
```

---

## 11. Permissions

Wildcard-aware claims (supports `moderation.*`). Defined by this module:

```
moderation.ban
moderation.tempban
moderation.softban
moderation.unban
moderation.kick
moderation.warn
moderation.timeout
moderation.mute
moderation.jail
moderation.slowmode
moderation.lock
moderation.purge
moderation.massrole
moderation.case.view
moderation.case.edit
moderation.case.revoke
moderation.case.delete
moderation.automod.view
moderation.automod.manage
moderation.settings.view
moderation.settings.manage
```

Beyond claims, every action passes `HierarchyGuard`:
- Actor must outrank the target's highest Discord role.
- Bot's highest role must outrank the target.
- Guild owner is never actionable.
- Actor cannot moderate themselves (except `/history` self).
- AutoMod (`source = AUTOMOD`) bypasses claim checks but still respects exemptions and bot hierarchy.

---

## 12. Logging

Structured Pino logs with categories; plus durable audit hooks (every case is itself an audit record).

| Category | Logged |
|----------|--------|
| `moderation.action` | Every manual action: actor, target, type, caseNumber, guildId, traceId. |
| `moderation.automod` | Rule type, verdict, action taken, dryRun flag, channel, target. |
| `moderation.escalation` | Points before/after, step applied, resulting action. |
| `moderation.job` | Scheduled reversal enqueued/executed/failed, jobId, caseNumber. |
| `moderation.error` | Categorised, traceable; user-facing message separated from internal detail. |

- No PII beyond Discord IDs and reason text. DM contents are never logged.
- Audit hook: `CaseCreated`/`CaseRevoked`/`CaseDeleted` events are mirrored to the Core audit log with actor and trace id.
- Every log line carries `guildId` and `traceId` (OpenTelemetry span) for correlation.

---

## 13. Testing

Vitest for unit/integration, Playwright for dashboard e2e. Coverage target ≥ 90% on domain + application layers.

**Unit (pure, no Discord/DB):**
- `RuleEvaluator` and each detector: spam thresholds, mention counts, link allow/block, invite detection, scam heuristics, ghost-ping, raid window — boundary cases (exactly at threshold, one below/above).
- `EscalationPolicy`: correct step selection across point boundaries; decay math.
- `HierarchyGuard`: owner/self/role-ranking permutations.
- `CaseNumberAllocator`: monotonic increment under simulated concurrency.

**Integration (with test DB + in-memory cache + mocked Discord adapter):**
- `BanService.tempBan` creates case, enqueues unban job with stable jobId; `unban` cancels it.
- `CaseService.softDelete` excludes case from default queries but preserves number.
- AutoMod end-to-end: message event -> verdict -> case + event emitted; `dryRun` records nothing destructive.
- Config priority ENV -> DB -> Defaults resolves correctly; invalid config rejected by Zod.

**E2E (Playwright, dashboard):**
- Issue a ban from dashboard, see case appear in list and live mod-log WS.
- Edit reason, revoke case, soft-delete; verify permission gating (403 without claim).

---

## 14. Dashboard Integration

- **Cases view:** paginated, filterable table (type, status, moderator, target, date range) backed by `GET /cases`; row detail drawer with evidence and metadata.
- **User history:** searchable user lookup showing timeline, active points, and current restrictions (`getUserHistory`).
- **Live mod-log:** WS stream (`/ws/modlog`) rendering `moderation.case.*` events in real time.
- **AutoMod editor:** per-rule forms generated from the Zod schemas (toggles, thresholds, action dropdowns, exemption pickers), with a **dry-run** switch and a live "what would happen" preview.
- **Escalation ladder editor:** drag-to-order steps with point thresholds and durations.
- **Actions:** quick ban/warn/timeout dialogs gated by permission claims, all writing through the REST API (which delegates to the same application services as slash commands).

---

## 15. Future Extensions

- ML-assisted scam/toxicity classifier as an optional detector behind the same `RuleEvaluator` contract.
- Cross-guild ban-sync / shared blocklists for partnered servers (opt-in).
- Appeal workflow: users submit appeals tied to a case; staff approve/deny in dashboard.
- Temporary role grants with auto-revoke (generalize the jail/mute scheduling).
- Configurable per-channel AutoMod overrides.
- Webhook export of cases to external SIEM.

---

## 16. Tasks for Claude

Execute in order. Each phase ends with passing tests and a commit (Conventional Commits, feature branch).

1. **Phase 1 — Schema:** Add Prisma models (`ModerationCase`, `ModerationCaseCounter`, `AutoModRule`, `ModerationSettings`, `RaidWindowEntry`) + enums. Create migration. Implement `CaseNumberAllocator`.
2. **Phase 2 — Config:** Implement `moderation.config.schema.ts` (all Zod schemas + defaults) and `ModSettingsRepository`/`AutoModRuleRepository` with cache-through reads.
3. **Phase 3 — Domain:** Implement `HierarchyGuard`, `InfractionPolicy`, `EscalationPolicy`, `RuleEvaluator`, and all detectors as pure functions with full unit tests.
4. **Phase 4 — Services:** Implement `CaseService`, `EscalationService`, then action services (`BanService`, `KickService`, `WarnService`, `TimeoutService`, `MuteService`, `JailService`, `ChannelStateService`, `PurgeService`, `MassRoleService`). Each emits events and writes cases via repositories.
5. **Phase 5 — Jobs:** Implement BullMQ processors (`unban`, `unmute`, `untimeout`, `unjail`) with stable jobIds for cancellation, plus recurring `points-decay`/raid-cleanup. Wire DLQ.
6. **Phase 6 — AutoMod:** Implement `AutoModEngineService` + `automod.listener.ts` + `verification.listener.ts`. Honor `dryRun`, exemptions, and emit `AutoModTriggered`/`RaidDetected`.
7. **Phase 7 — Commands:** Implement Necord controllers for all slash commands; parse to DTOs, enforce permissions, translate replies (i18n).
8. **Phase 8 — Dashboard/API:** Implement REST controllers, DTOs, Swagger annotations, and the mod-log WS gateway.
9. **Phase 9 — Public API:** Implement `ModerationPublicApi` provider, export only via `index.ts`.
10. **Phase 10 — Tests:** Complete integration + Playwright e2e per section 13.
11. **Phase 11 — Docs:** Update module README, i18n keys (PT + EN), and changelog.

---

## 17. Acceptance Criteria

- [ ] All listed slash commands exist, are permission-gated, and produce a `Case` with a unique guild-scoped `caseNumber`.
- [ ] `/tempban`, `/timeout`, `/mute`, `/jail` schedule reversal via BullMQ; `/unban` etc. cancel the pending job and write a reversal case.
- [ ] Each AutoMod protection can be independently enabled/configured per guild and respects role/channel/user exemptions.
- [ ] Anti-raid detects join bursts and applies the configured mitigation; emits `RaidDetected`.
- [ ] Verification gate assigns the verified role and (optionally) kicks unverified members after the configured timeout.
- [ ] Escalation applies the correct action at configured point thresholds; points decay over time.
- [ ] `dryRun` mode records intended actions in logs/events but performs no destructive operation.
- [ ] Case history is paginated, filterable, cached, and exposed via REST + dashboard + `ModerationPublicApi`.
- [ ] `HierarchyGuard` blocks acting on the owner, higher-ranked users, and self.
- [ ] All user-facing text is translated (PT + EN). No internal errors leak to users.
- [ ] No `any` in the codebase; ESLint/Prettier clean; Controllers never touch Prisma.

---

## 18. Definition of Done

- [ ] All unit, integration, and e2e tests pass; coverage ≥ 90% on domain + application layers.
- [ ] Prisma migration created, reviewed, and applied cleanly.
- [ ] ESLint + Prettier clean; TypeScript strict with zero `any`; Commitlint-compliant commits.
- [ ] Swagger/OpenAPI updated for all new endpoints; DTOs documented.
- [ ] i18n namespaces `moderation` + `automod` complete for PT and EN.
- [ ] Module exposes only its public API via `index.ts`; no cross-module internal imports.
- [ ] All events documented and emitted through the Event Bus; cache and queue used through Core layers only.
- [ ] Dashboard screens implemented and permission-gated.
- [ ] Docs (this spec + README + changelog) updated.
- [ ] PR opened against `develop` (never direct to `main`), CI green, reviewed.
