# Permissions

> ## Claude Instructions
> - Never modify another module. Do not change architecture decisions from `00-project.md`.
> - This is a CORE system (`src/core/permissions`). Other modules consume it; it consumes nothing from modules.
> - Keep backwards compatibility. Create Prisma migrations. Generate tests and docs.
> - Generate DTOs. Use Repository Pattern. Use the Event Bus. Use Dependency Injection.
> - No `any`. Keep methods small (<50 lines where reasonable). Follow existing naming.
> - Create indexes for searchable fields (`guildId`, `discordRoleId`, `claim`). Support pagination, caching, translations, dashboard.
> - All permission reads MUST go through the Cache layer — never query Prisma on the hot path for `can()`.
> - Resolution must be deterministic, traceable, and guild-scoped. Wildcards and explicit DENY must be honoured.

---

## 1. Purpose

The Permissions core system is the single authority that decides **whether a Discord member is allowed to perform a claim-guarded action** inside a guild. It backs both the slash-command layer (Necord) and the REST API (NestJS controllers) through one shared resolution algorithm exposed as `PermissionService.can(member, claim)`.

It implements a **claim-based authorization model** rather than a raw Discord-role model:

- Actions are protected by **claims** — dot-namespaced strings such as `tickets.close`, `fivem.restart`, `admin.*`.
- Members never hold claims directly. Members hold **Discord roles**; roles are mapped to **permission groups**; groups grant **claims** (with optional explicit DENY).
- **Owner / Admin / Mod tiers** are built-in groups with sensible defaults that can be overridden per guild.
- Everything is **guild-scoped**. The same Discord user can be an admin in one guild and a plain member in another. Only a small set of **global** claims (bot owner / instance operator) cross guild boundaries.

This document is the engineering contract for the unit living under `src/core/permissions`. No module re-implements authorization; they declare claims and decorate handlers.

## 2. Goals

- **One algorithm, two entry points.** Slash commands and REST endpoints resolve permissions identically.
- **Wildcard claims.** `tickets.*` grants every `tickets.<x>` claim; `*` is full access (owner tier).
- **Explicit DENY wins.** A DENY entry overrides any GRANT, including a broader wildcard GRANT.
- **Groups + inheritance.** Groups can inherit from parent groups; claims resolve transitively with cycle protection.
- **Discord role mapping.** A member's effective groups are the union of groups mapped to the member's Discord roles, plus a guild-level default group.
- **Guild-scoped overrides.** A guild may override the claims of a built-in tier without touching another guild.
- **Fast.** `can()` resolves from cache (memory -> Redis) in O(roles + groups); DB only on cache miss.
- **Traceable.** Every decision can return a reason chain for the dashboard and audit log.
- **Type-safe.** No `any`. Claims are validated; decision results are discriminated unions.

## 3. Architecture

Strict layer flow, no deviations:

```
@RequirePermission(claim)  ──►  CommandPermissionGuard (Necord)
                                RestPermissionGuard (NestJS)
                                        │
                                        ▼
                              PermissionService (Application)
                                        │
                       ┌────────────────┼─────────────────┐
                       ▼                ▼                 ▼
              PermissionResolver   CacheService      EventBus
              (Domain Service)     (core/cache)      (core/events)
                       │
        ┌──────────────┼───────────────┐
        ▼              ▼                ▼
  GroupRepository  RoleMappingRepo  ClaimGrantRepo   ──►  Prisma  ──►  MySQL
```

- **Guards** extract the actor (Discord member or authenticated dashboard user) + the required claim from metadata, then call `PermissionService.can()`. They contain **no business logic**.
- **`PermissionService`** (Application Service) is the public facade. It owns caching, event emission, and audit hooks, and delegates pure resolution to the domain.
- **`PermissionResolver`** (Domain Service) is pure: given a fully-loaded `PermissionContext` (groups, mappings, grants), it computes a `PermissionDecision`. It never touches Prisma, cache, or Discord.
- **Repositories** are the only code touching Prisma.
- **CacheService** holds the resolved per-guild permission snapshot; invalidated on any mutation event.

CQRS is **not** used here — reads dominate and writes are simple CRUD. We use the Repository Pattern + an in-memory resolver.

## 4. Folder Structure

```
src/core/permissions/
├── permissions.module.ts
├── permissions.constants.ts            # metadata keys, default tier claims
├── application/
│   ├── permission.service.ts           # public facade: can(), explain(), assign/revoke
│   └── permission-cache.facade.ts      # snapshot load + invalidation
├── domain/
│   ├── permission-resolver.service.ts  # pure resolution algorithm
│   ├── claim.value-object.ts           # Claim parsing/validation, wildcard match
│   ├── permission-decision.ts          # Decision discriminated union + reason chain
│   └── permission-context.ts           # in-memory snapshot shape
├── infrastructure/
│   ├── group.repository.ts
│   ├── role-mapping.repository.ts
│   ├── claim-grant.repository.ts
│   └── group-inheritance.repository.ts
├── guards/
│   ├── command-permission.guard.ts     # Necord slash commands
│   └── rest-permission.guard.ts        # NestJS REST
├── decorators/
│   └── require-permission.decorator.ts # @RequirePermission(claim)
├── dto/
│   ├── assign-group.dto.ts
│   ├── upsert-group.dto.ts
│   ├── map-role.dto.ts
│   ├── set-claim-grant.dto.ts
│   └── permission-explain.dto.ts
├── events/
│   ├── permission.events.ts            # event names + payload types
│   └── permission-event.listener.ts    # cache invalidation on mutation
├── schemas/
│   └── permission-config.schema.ts     # Zod config
└── permissions.controller.ts           # REST admin surface
```

## 5. Public Interfaces

These are the only symbols other modules may import (re-exported from the module's public barrel).

```ts
// domain/claim.value-object.ts
export type ClaimString = string; // validated at the boundary by Claim.parse

/** Result of testing a member against a single claim. */
export type PermissionEffect = 'GRANT' | 'DENY' | 'UNSET';

/** Immutable, parsed, validated claim. */
export class Claim {
  private static readonly PATTERN = /^(?:\*|[a-z0-9]+(?:\.[a-z0-9]+)*(?:\.\*)?)$/;

  private constructor(public readonly value: ClaimString) {}

  static parse(raw: string): Claim {
    const v = raw.trim().toLowerCase();
    if (!Claim.PATTERN.test(v)) {
      throw new InvalidClaimError(raw);
    }
    return new Claim(v);
  }

  /** True if THIS claim (held/granted) covers the `required` claim. */
  covers(required: Claim): boolean {
    if (this.value === '*') return true;
    if (this.value === required.value) return true;
    if (this.value.endsWith('.*')) {
      const prefix = this.value.slice(0, -1); // keep trailing dot, e.g. "tickets."
      return required.value.startsWith(prefix);
    }
    return false;
  }

  /** Specificity score: higher wins on conflict (used for DENY/GRANT tie-breaks). */
  specificity(): number {
    if (this.value === '*') return 0;
    const depth = this.value.split('.').length;
    return this.value.endsWith('.*') ? depth - 1 + 0.5 : depth;
  }
}
```

```ts
// domain/permission-decision.ts
export interface DecisionReason {
  readonly source: 'group' | 'role-mapping' | 'tier-default' | 'global' | 'fallback';
  readonly groupKey?: string;
  readonly matchedClaim?: string;
  readonly effect: PermissionEffect;
}

export type PermissionDecision =
  | { readonly allowed: true; readonly reasons: readonly DecisionReason[] }
  | { readonly allowed: false; readonly reasons: readonly DecisionReason[] };
```

```ts
// domain/permission-context.ts
export interface ResolvedGroup {
  readonly key: string;            // e.g. "owner", "admin", "mod", "support"
  readonly priority: number;       // higher = evaluated as more authoritative
  readonly grants: ReadonlyArray<{ claim: string; effect: 'GRANT' | 'DENY' }>;
  readonly parents: readonly string[];
}

export interface PermissionContext {
  readonly guildId: string;
  readonly isGuildOwner: boolean;       // Discord guild owner id matches member
  readonly isBotOwner: boolean;         // global instance owner
  readonly memberRoleIds: readonly string[];
  readonly roleToGroups: Readonly<Record<string, readonly string[]>>; // roleId -> group keys
  readonly defaultGroupKeys: readonly string[];                       // guild default groups
  readonly groups: Readonly<Record<string, ResolvedGroup>>;           // key -> group
}
```

```ts
// application/permission.service.ts
import type { GuildMember } from 'discord.js';

export interface PermissionActor {
  readonly userId: string;
  readonly guildId: string;
  readonly discordRoleIds: readonly string[];
  readonly isGuildOwner: boolean;
}

export abstract class PermissionService {
  /** Hot-path check. True if the actor holds the required claim in this guild. */
  abstract can(actor: PermissionActor, claim: string): Promise<boolean>;

  /** Convenience overload for Necord guild members. */
  abstract canMember(member: GuildMember, claim: string): Promise<boolean>;

  /** Full decision with reason chain (dashboard / audit / debugging). */
  abstract explain(actor: PermissionActor, claim: string): Promise<PermissionDecision>;

  /** Throws PermissionDeniedError if the actor lacks the claim. */
  abstract assert(actor: PermissionActor, claim: string): Promise<void>;

  // ---- administration (guarded by `permissions.*` claims) ----
  abstract assignGroup(guildId: string, discordRoleId: string, groupKey: string): Promise<void>;
  abstract unassignGroup(guildId: string, discordRoleId: string, groupKey: string): Promise<void>;
  abstract setClaimGrant(
    guildId: string,
    groupKey: string,
    claim: string,
    effect: 'GRANT' | 'DENY',
  ): Promise<void>;
  abstract removeClaimGrant(guildId: string, groupKey: string, claim: string): Promise<void>;
  abstract listGroups(guildId: string): Promise<readonly ResolvedGroup[]>;
}
```

```ts
// decorators/require-permission.decorator.ts
export const PERMISSION_CLAIM_KEY = 'ghost:permission:claim';

/** Attaches the required claim to a slash command handler or REST route. */
export const RequirePermission = (claim: string): MethodDecorator =>
  SetMetadata(PERMISSION_CLAIM_KEY, Claim.parse(claim).value);
```

## 6. Events

All events flow through the core Event Bus (`core/events`). Names are namespaced `permission.*`.

**Emitted:**

```ts
// events/permission.events.ts
export const PermissionEvents = {
  GroupAssigned: 'permission.group.assigned',
  GroupUnassigned: 'permission.group.unassigned',
  ClaimGrantChanged: 'permission.claim.grant_changed',
  GroupUpserted: 'permission.group.upserted',
  DecisionDenied: 'permission.decision.denied',
} as const;

export interface GroupAssignedPayload {
  readonly guildId: string;
  readonly discordRoleId: string;
  readonly groupKey: string;
  readonly actorUserId: string;
  readonly at: string; // ISO-8601
}

export interface ClaimGrantChangedPayload {
  readonly guildId: string;
  readonly groupKey: string;
  readonly claim: string;
  readonly effect: 'GRANT' | 'DENY' | 'REMOVED';
  readonly actorUserId: string;
  readonly at: string;
}

export interface DecisionDeniedPayload {
  readonly guildId: string;
  readonly userId: string;
  readonly claim: string;
  readonly surface: 'command' | 'rest';
  readonly at: string;
}
```

**Consumed:**

- `permission.group.assigned`, `permission.group.unassigned`, `permission.claim.grant_changed`, `permission.group.upserted` -> internal listener invalidates the cached snapshot for that `guildId`.
- `guild.member.roles_updated` (from the gateway/events core) -> invalidates the per-member resolution cache key.
- `guild.created` -> seeds the default tier groups (owner/admin/mod/member) for the new guild.

## 7. Dependencies

Relies ONLY on CORE systems — never on another module.

| Core system | Usage |
|-------------|-------|
| **Cache** (`core/cache`) | Stores the resolved `PermissionContext` snapshot per guild (`perm:ctx:<guildId>`) and per-member decisions (`perm:dec:<guildId>:<userId>:<claim>`). Memory + Redis, namespaced, TTL 300s. Never touches Redis directly. |
| **Events** (`core/events`) | Emits mutation/denial events; consumes role-update + guild-created events for invalidation. |
| **Database** (`core/database`) | Prisma access via repositories only. |
| **Config** (`core/config`) | Zod-validated permission config (ENV -> DB -> defaults); bot-owner id list, cache TTL, fail-closed flag. |
| **Logging** (`core/logging`) | Pino structured logs + audit hooks. |
| **Queue** (`core/queue`) | N/A on hot path. Used only to enqueue async audit-export jobs (optional). |

Modules **declare** claims they own (via constants) but do not call repositories here; they consume `PermissionService` and `@RequirePermission`.

## 8. Configuration

Config priority: **ENV -> Database -> Defaults**, all Zod-validated.

```ts
// schemas/permission-config.schema.ts
import { z } from 'zod';

export const PermissionGlobalConfigSchema = z.object({
  /** Discord user ids that always resolve `*` across all guilds. */
  botOwnerIds: z.array(z.string().regex(/^\d{17,20}$/)).default([]),
  /** Deny when resolution errors (recommended). */
  failClosed: z.boolean().default(true),
  /** Cache TTL for resolved snapshots, seconds. */
  cacheTtlSeconds: z.number().int().min(30).max(3600).default(300),
  /** Max inheritance depth (cycle/abuse guard). */
  maxInheritanceDepth: z.number().int().min(1).max(16).default(8),
});

export const PermissionGuildConfigSchema = z.object({
  guildId: z.string().regex(/^\d{17,20}$/),
  /** Group keys applied to every member with no explicit mapping. */
  defaultGroupKeys: z.array(z.string().min(1)).default(['member']),
  /** Treat the Discord guild owner as the `owner` tier automatically. */
  guildOwnerIsOwnerTier: z.boolean().default(true),
  /** Allow Discord Administrator permission to imply `admin` tier. */
  discordAdminImpliesAdminTier: z.boolean().default(false),
});

export type PermissionGlobalConfig = z.infer<typeof PermissionGlobalConfigSchema>;
export type PermissionGuildConfig = z.infer<typeof PermissionGuildConfigSchema>;
```

**Default tier claims** (seeded per guild, overridable):

| Tier | Priority | Default grants |
|------|----------|----------------|
| `owner` | 1000 | `*` |
| `admin` | 800 | `admin.*`, `permissions.*`, `tickets.*`, `fivem.*` |
| `mod` | 500 | `tickets.*`, `moderation.*`, `fivem.restart` |
| `member` | 100 | `tickets.create`, `tickets.view.own` |

## 9. Database

Prisma models. Soft-delete via `deletedAt` on mutable config tables. Composite uniques + indexes on searchable fields.

```prisma
model PermissionGroup {
  id          String   @id @default(cuid())
  guildId     String
  key         String                       // "owner" | "admin" | "mod" | custom
  name        String
  priority    Int      @default(100)
  isSystem    Boolean  @default(false)      // built-in tier, not user-deletable
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  deletedAt   DateTime?

  grants      ClaimGrant[]
  roleMaps    RoleGroupMapping[]
  parents     GroupInheritance[] @relation("childGroup")
  children    GroupInheritance[] @relation("parentGroup")

  @@unique([guildId, key])
  @@index([guildId])
  @@index([guildId, deletedAt])
}

model ClaimGrant {
  id         String   @id @default(cuid())
  guildId    String
  groupId    String
  claim      String                         // "tickets.*", "fivem.restart", "*"
  effect     ClaimEffect @default(GRANT)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  group      PermissionGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)

  @@unique([groupId, claim])
  @@index([guildId])
  @@index([guildId, claim])
}

model RoleGroupMapping {
  id            String   @id @default(cuid())
  guildId       String
  discordRoleId String
  groupId       String
  createdAt     DateTime @default(now())

  group         PermissionGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)

  @@unique([guildId, discordRoleId, groupId])
  @@index([guildId])
  @@index([guildId, discordRoleId])
}

model GroupInheritance {
  id            String @id @default(cuid())
  guildId       String
  childGroupId  String
  parentGroupId String

  childGroup    PermissionGroup @relation("childGroup",  fields: [childGroupId],  references: [id], onDelete: Cascade)
  parentGroup   PermissionGroup @relation("parentGroup", fields: [parentGroupId], references: [id], onDelete: Cascade)

  @@unique([childGroupId, parentGroupId])
  @@index([guildId])
}

enum ClaimEffect {
  GRANT
  DENY
}
```

Notes:
- `@@unique([groupId, claim])` ensures one effect per claim per group; flipping GRANT<->DENY is an upsert.
- System tiers (`isSystem = true`) cannot be hard-deleted via the API; only their grants are editable.
- Cascade deletes clean up grants/mappings/inheritance when a group is removed.

## 10. API

REST surface under `/api/guilds/:guildId/permissions`. All routes guarded by `RestPermissionGuard` + `@RequirePermission`. DTOs validated with Zod pipes. Swagger-tagged `Permissions`.

| Method & Path | Required claim | Body DTO | Description |
|---|---|---|---|
| `GET /groups` | `permissions.view` | — | List groups (paginated, cached). |
| `POST /groups` | `permissions.group.manage` | `UpsertGroupDto` | Create/update a group. |
| `DELETE /groups/:key` | `permissions.group.manage` | — | Soft-delete a non-system group. |
| `PUT /groups/:key/claims` | `permissions.claim.manage` | `SetClaimGrantDto` | Add/update a claim grant. |
| `DELETE /groups/:key/claims/:claim` | `permissions.claim.manage` | — | Remove a grant. |
| `POST /roles/:roleId/groups` | `permissions.role.manage` | `MapRoleDto` | Map a Discord role to a group. |
| `DELETE /roles/:roleId/groups/:key` | `permissions.role.manage` | — | Unmap. |
| `GET /explain` | `permissions.view` | query: `userId,claim` | Return `PermissionDecision` reason chain. |

```ts
// dto/set-claim-grant.dto.ts
export const SetClaimGrantSchema = z.object({
  claim: z.string().min(1),
  effect: z.enum(['GRANT', 'DENY']),
});
export class SetClaimGrantDto extends createZodDto(SetClaimGrantSchema) {}

// dto/upsert-group.dto.ts
export const UpsertGroupSchema = z.object({
  key: z.string().regex(/^[a-z0-9_-]{2,32}$/),
  name: z.string().min(1).max(64),
  priority: z.number().int().min(0).max(10000).default(100),
  parents: z.array(z.string()).default([]),
});
export class UpsertGroupDto extends createZodDto(UpsertGroupSchema) {}

// dto/map-role.dto.ts
export const MapRoleSchema = z.object({ groupKey: z.string().min(1) });
export class MapRoleDto extends createZodDto(MapRoleSchema) {}
```

Pagination: `GET /groups` accepts `?page=&pageSize=` (default 1/25, max 100) and returns `{ items, page, pageSize, total }`.

## 11. Permissions

Claims this unit **defines** (owns the `permissions.*` namespace):

| Claim | Guards |
|---|---|
| `permissions.view` | Read groups, mappings, run `/perm explain`. |
| `permissions.group.manage` | Create/update/delete groups. |
| `permissions.claim.manage` | Add/remove claim grants. |
| `permissions.role.manage` | Map/unmap Discord roles to groups. |
| `permissions.assign` | Assign a tier group to a role via command. |
| `permissions.*` | Wildcard for full permission administration (default in `admin` tier). |

Slash commands (Necord), each `@RequirePermission`-guarded:

```
/perm groups                                  (permissions.view)
/perm grant <group> <claim>                   (permissions.claim.manage)
/perm deny <group> <claim>                    (permissions.claim.manage)
/perm map <role> <group>                      (permissions.role.manage)
/perm unmap <role> <group>                     (permissions.role.manage)
/perm explain <user> <claim>                   (permissions.view)
```

## 12. Logging

Pino, structured, category `permissions`.

- **Mutations** (assign/unassign/grant/deny/map) -> `info` + audit hook with `{ guildId, actorUserId, target, before, after }`.
- **Denied decisions** -> `warn` with `{ guildId, userId, claim, surface }`, also emits `permission.decision.denied`.
- **Resolution errors / fail-closed triggers** -> `error` with trace id (OpenTelemetry span context).
- **Cache** -> `debug` for snapshot load/miss/invalidate.
- Audit hooks write to the central audit log (consumed via the denial/mutation events) — the permissions unit does not own the audit store.
- Never log full member objects or tokens; only ids and claims.

## 13. Testing

Vitest (unit/integration) + Playwright (dashboard e2e).

**Unit (pure, no I/O):**
- `Claim.covers`: `*` covers all; `tickets.*` covers `tickets.close` but not `ticketsx.y`; exact match; no false prefix match (`tickets` vs `ticketsadmin`).
- `Claim.specificity`: ordering `* < a.* < a.b < a.b.c`.
- `PermissionResolver`: GRANT, DENY-overrides-GRANT, wildcard GRANT + specific DENY, inheritance transitivity, cycle detection (throws at `maxInheritanceDepth`), owner tier short-circuit, empty context -> deny (fail-closed).

**Integration (repos + cache, test MySQL + Redis):**
- Snapshot load from DB, cache hit on second `can()`, invalidation on `ClaimGrantChanged` event.
- Guild isolation: same role id in two guilds resolves independently.

**Guard tests:**
- `CommandPermissionGuard` and `RestPermissionGuard` deny with user-friendly error and emit `DecisionDenied`.

**Coverage gates:** resolver + claim VO at 100% branch; service >=90%.

## 14. Dashboard Integration

- **Roles & Permissions** page: matrix of groups × claims with GRANT/DENY/UNSET toggles (writes via `PUT /groups/:key/claims`).
- **Role mapping** panel: drag Discord roles onto tier/custom groups.
- **Inheritance graph**: visualise parent/child groups; cycle attempts blocked client- and server-side.
- **Explain tool**: pick a member + claim -> renders the `PermissionDecision.reasons` chain (which group/claim allowed or denied).
- All labels i18n (PT primary, EN secondary) via namespace `permissions`.
- Live updates: dashboard subscribes to `permission.*` events for optimistic refresh.

## 15. Future Extensions

- **Time-boxed grants** (temporary mod) via `expiresAt` on `ClaimGrant` + scheduled BullMQ revoke job.
- **Conditional claims** (e.g. only in certain channels) via a constraint expression engine.
- **Per-resource claims** (`tickets.close:#123`) with instance-level scoping.
- **Claim catalog auto-discovery** from module metadata for dashboard hints.
- **Approval workflows** for sensitive claims (`fivem.restart`) requiring a second approver.

## 16. Tasks for Claude

1. **Phase 1 — Schema:** Add Prisma models (`PermissionGroup`, `ClaimGrant`, `RoleGroupMapping`, `GroupInheritance`, `ClaimEffect`). Create migration. Seed default tiers on `guild.created`.
2. **Phase 2 — Domain:** Implement `Claim` value object, `PermissionContext`, `PermissionDecision`, and the pure `PermissionResolver` with full unit tests.
3. **Phase 3 — Repositories:** Implement the four repositories (Repository Pattern, Prisma only here).
4. **Phase 4 — Application + Cache:** Implement `PermissionService` (`can/explain/assert/assign...`) with the cache facade and snapshot loading.
5. **Phase 5 — Events:** Wire emission + the invalidation listener; subscribe to role/guild events.
6. **Phase 6 — Guards & Decorator:** Implement `@RequirePermission`, `CommandPermissionGuard`, `RestPermissionGuard`.
7. **Phase 7 — Commands:** Implement `/perm` subcommands (Necord), guarded.
8. **Phase 8 — REST API:** Controller + DTOs + Swagger + pagination.
9. **Phase 9 — Dashboard:** Matrix, mapping, inheritance, explain views (i18n).
10. **Phase 10 — Tests:** Unit, integration, guard, e2e. Meet coverage gates.
11. **Phase 11 — Docs:** Update module docs, claim catalog, ADR for the resolution algorithm.

## 17. Acceptance Criteria

- `PermissionService.can()` returns correct results for: exact claim, wildcard claim, DENY-over-GRANT, owner tier (`*`), and unknown claim (deny when fail-closed).
- Resolution is fully guild-scoped — verified by the two-guild isolation test.
- Inheritance resolves transitively and rejects cycles at `maxInheritanceDepth`.
- `@RequirePermission` works identically on a slash command and a REST route.
- Denied commands reply with a translated, user-friendly message; denied REST returns `403` with a categorised error body (no internals leaked).
- Cache: second identical `can()` within TTL hits cache; any mutation event invalidates the affected guild snapshot.
- All REST endpoints documented in Swagger; `/groups` paginated.
- No Prisma access outside repositories; no Redis access outside the Cache layer.

## 18. Definition of Done

- All Vitest suites pass; coverage gates met (resolver/VO 100% branch, service >=90%).
- Playwright dashboard e2e for the permissions matrix passes.
- Prisma migration created and applied cleanly; default-tier seed verified.
- ESLint/Prettier clean; no `any`; Commitlint-valid Conventional Commits.
- All public symbols exported via the module's public barrel; no module imports internals.
- Docs (this file, claim catalog, ADR) updated.
- Feature branch `feature/permissions` opened as a PR into `develop` (never direct to `main`), CI green.
