# Dashboard

> ## Claude Instructions
> - Never modify another module. Do not change architecture decisions from `00-project.md`.
> - Keep backwards compatibility. Create Prisma migrations. Generate tests and docs.
> - Generate DTOs. Use the Repository Pattern. Use the Event Bus. Use Dependency Injection.
> - Controllers NEVER touch Prisma — only Repositories do. The dashboard backend follows the strict
>   layer flow: Controller -> Application Service -> Domain Service (when needed) -> Repository -> Database.
> - No `any`. Keep methods small (<50 lines where reasonable). Follow existing naming conventions.
> - Never let the dashboard import another module's internal services. Consume only published public
>   APIs/contracts or react to Event Bus events.
> - No module touches Redis directly — sessions, realtime fan-out and caching go through the Cache layer.
> - Create indexes for searchable fields. Support pagination, caching, translations and multi-guild scoping.
> - All inputs validated with Zod. Never leak internal errors to the browser. Encrypt secrets and API keys.

---

## 1. Purpose

The Dashboard is the web control plane for Ghost Bot. It lets guild administrators authenticate with
Discord, select a guild where they hold the `Manage Guild` permission, and manage every aspect of the
bot for that guild: enable/disable modules, edit configuration, browse logs, inspect analytics, manage
permission claims and groups, edit translations, install/manage plugins, manage API keys and trigger or
download backups.

The Dashboard is **not** a module in the Discord sense — it is a cross-cutting surface that consumes the
public APIs and contracts of every module and the CORE systems. It owns no business logic of other
modules; it orchestrates, presents and authorizes. All bot behaviour stays in its module; the dashboard
only reads/writes through published interfaces and reacts to the Event Bus for realtime updates.

This document covers two cooperating pieces:
- **Dashboard Backend** — a NestJS feature living under `src/dashboard` that exposes the dashboard-only
  REST + WebSocket surface, OAuth2/session handling and aggregation logic.
- **Dashboard Frontend** — a **Next.js (App Router)** SPA, served as a separate deployable, tested with
  Playwright.

## 2. Goals

- One coherent, guild-scoped admin UI for the entire platform.
- Secure Discord OAuth2 login with server-side sessions; no Discord token ever reaches the browser.
- Guild selector restricted to guilds where the user has `Manage Guild` (or is bot owner).
- Live, low-latency updates (job progress, log tails, module state) via WebSocket.
- Every write validated with Zod, authorized against the Permissions system, and audit-logged.
- Fully internationalized UI (PT primary, EN secondary) using the same translation namespaces as the bot.
- Reuse CORE systems only — never reach into another module's internals.
- Frontend and backend independently deployable, both containerized, both covered by tests.

## 3. Architecture

**Frontend framework decision — Next.js (App Router), justified:**
We recommend **Next.js** over a NestJS-served static SPA. Reasons tied to the contract:
- The dashboard is data-dense and SEO-irrelevant but benefits from server components for fast first paint
  of large config/log views and from streaming. Next.js gives RSC + route-level code splitting for free.
- It keeps the frontend a **separate, independently deployable** artifact, reinforcing the "every unit is
  independent and exposes only a public API" rule — the frontend consumes the backend's REST/WS contract
  and nothing else.
- A NestJS-served SPA would couple the bot runtime's lifecycle and memory to asset serving; separating them
  keeps the bot process lean and lets the dashboard scale horizontally on its own.
- Built-in middleware lets us guard routes via the session cookie before any data fetch.

The Next.js app calls **only** the Dashboard Backend REST API (BFF pattern). It never talks to Discord,
Prisma, Redis or other modules directly. The backend is the single trust boundary.

```
Browser (Next.js SPA, RSC + client components)
        │  HTTPS (httpOnly session cookie)  /  WSS (ticket-authenticated)
        ▼
Dashboard Backend (NestJS, src/dashboard)
  Controllers ── Application Services ── Domain Services ── Repositories ── MySQL (Prisma)
        │                  │                                   │
        │                  ├── Cache layer (sessions, aggregates)   (no direct Redis)
        │                  ├── Permissions service (claim checks)
        │                  ├── Event Bus (subscribe for realtime; emit dashboard.* events)
        │                  └── Queue (BullMQ) for backups/long tasks
        ▼
Module Public APIs / Contracts (modules, plugins, i18n, config, logging)
```

Layer rules: dashboard controllers validate + authorize + delegate; application services aggregate across
module public APIs and CORE; repositories own all Prisma access for dashboard-owned tables
(`DashboardSession`, `ApiKey`, `Backup`, audit entries). No dashboard controller touches Prisma.

## 4. Folder Structure

```
src/dashboard/
├── dashboard.module.ts                # NestJS feature module (DI wiring)
├── backend/
│   ├── controllers/
│   │   ├── auth.controller.ts          # /auth/* OAuth2 + session
│   │   ├── guilds.controller.ts        # /guilds, /guilds/:id
│   │   ├── modules.controller.ts       # enable/disable, status
│   │   ├── config.controller.ts        # config editors
│   │   ├── logs.controller.ts          # log viewer (paginated, filtered)
│   │   ├── analytics.controller.ts     # aggregated metrics
│   │   ├── permissions.controller.ts   # claim/group editor
│   │   ├── translations.controller.ts  # i18n editor
│   │   ├── plugins.controller.ts       # plugin manager
│   │   ├── api-keys.controller.ts      # API key CRUD
│   │   └── backups.controller.ts       # backup trigger/list/download
│   ├── services/                       # application services (aggregation)
│   │   ├── auth.service.ts
│   │   ├── session.service.ts
│   │   ├── guild-access.service.ts
│   │   ├── dashboard-aggregation.service.ts
│   │   ├── api-key.service.ts
│   │   └── backup.service.ts
│   ├── repositories/                   # ONLY layer touching Prisma here
│   │   ├── session.repository.ts
│   │   ├── api-key.repository.ts
│   │   └── backup.repository.ts
│   ├── gateway/
│   │   └── dashboard.gateway.ts        # WebSocket (Socket.IO/ws) realtime hub
│   ├── guards/
│   │   ├── session.guard.ts            # validates session cookie
│   │   ├── guild-manage.guard.ts       # requires Manage Guild on :guildId
│   │   └── claim.guard.ts              # requires a specific permission claim
│   ├── dto/                            # request/response DTOs + Zod schemas
│   ├── interfaces/                     # public TS contracts (this doc §5)
│   ├── events/                         # dashboard.* event definitions
│   └── config/                         # dashboard Zod config schema + defaults
└── frontend/                           # Next.js app (separate deployable)
    ├── app/
    │   ├── (auth)/login/page.tsx
    │   ├── (auth)/callback/page.tsx
    │   ├── guild-select/page.tsx
    │   └── g/[guildId]/
    │       ├── layout.tsx              # guild shell + nav + WS provider
    │       ├── overview/page.tsx
    │       ├── modules/page.tsx
    │       ├── config/[module]/page.tsx
    │       ├── logs/page.tsx
    │       ├── analytics/page.tsx
    │       ├── permissions/page.tsx
    │       ├── translations/page.tsx
    │       ├── plugins/page.tsx
    │       ├── api-keys/page.tsx
    │       └── backups/page.tsx
    ├── lib/api/                        # typed BFF client (generated from OpenAPI)
    ├── lib/realtime/                   # WS client + hooks
    ├── components/
    ├── middleware.ts                   # session-cookie route guard
    └── tests/e2e/                      # Playwright specs
```

## 5. Public Interfaces

Real strict TypeScript exposed by the Dashboard Backend. Consumed by controllers, the gateway and tests.

```ts
// src/dashboard/backend/interfaces/session.interface.ts
export interface DashboardUser {
  readonly discordId: string;
  readonly username: string;
  readonly globalName: string | null;
  readonly avatarHash: string | null;
  readonly isBotOwner: boolean;
}

export interface ManageableGuild {
  readonly guildId: string;
  readonly name: string;
  readonly iconHash: string | null;
  readonly botPresent: boolean;       // is Ghost Bot in this guild
  readonly hasManage: boolean;        // user holds Manage Guild here
}

export interface DashboardSessionData {
  readonly sessionId: string;
  readonly user: DashboardUser;
  readonly guilds: ReadonlyArray<ManageableGuild>;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface ISessionService {
  create(user: DashboardUser, refreshToken: string, guilds: ManageableGuild[]): Promise<string>;
  resolve(sessionId: string): Promise<DashboardSessionData | null>;
  refreshGuilds(sessionId: string): Promise<ReadonlyArray<ManageableGuild>>;
  destroy(sessionId: string): Promise<void>;
}
```

```ts
// src/dashboard/backend/interfaces/guild-access.interface.ts
export interface IGuildAccessService {
  // Throws ForbiddenDashboardError when the user lacks Manage Guild on the guild.
  assertManage(sessionId: string, guildId: string): Promise<void>;
  // Resolves the effective permission claims for the user within a guild.
  resolveClaims(sessionId: string, guildId: string): Promise<ReadonlyArray<string>>;
}
```

```ts
// src/dashboard/backend/interfaces/api-key.interface.ts
export interface ApiKeyView {
  readonly id: string;
  readonly guildId: string;
  readonly name: string;
  readonly prefix: string;            // first 8 chars, safe to show
  readonly scopes: ReadonlyArray<string>;
  readonly lastUsedAt: Date | null;
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
}

export interface CreatedApiKey extends ApiKeyView {
  readonly plaintext: string;         // returned ONCE on creation, never stored
}

export interface IApiKeyService {
  list(guildId: string, page: number, pageSize: number): Promise<Paginated<ApiKeyView>>;
  create(guildId: string, name: string, scopes: string[], expiresAt: Date | null): Promise<CreatedApiKey>;
  revoke(guildId: string, id: string): Promise<void>;
}
```

```ts
// src/dashboard/backend/interfaces/pagination.interface.ts
export interface Paginated<T> {
  readonly items: ReadonlyArray<T>;
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}
```

```ts
// src/dashboard/backend/interfaces/realtime.interface.ts
export type DashboardChannel =
  | `guild:${string}:logs`
  | `guild:${string}:modules`
  | `guild:${string}:jobs`
  | `guild:${string}:analytics`;

export interface IDashboardGateway {
  // Validates a short-lived WS ticket and binds the socket to its session + guild scope.
  authenticate(ticket: string): Promise<{ sessionId: string; user: DashboardUser }>;
  broadcast<T>(channel: DashboardChannel, event: string, payload: T): void;
}
```

## 6. Events

The dashboard **consumes** events from CORE/other modules to push realtime updates, and **emits**
`dashboard.*` events when admins perform actions. All payloads are guild-scoped.

**Consumed (fan-out to WS subscribers):**

```ts
// Reacted to and forwarded onto the matching DashboardChannel.
export interface LogEmittedEvent {       // from logging core
  guildId: string; category: string; level: 'debug'|'info'|'warn'|'error'; message: string; at: string;
}
export interface JobProgressEvent {       // from queue core
  guildId: string; jobId: string; queue: string; progress: number; state: string;
}
export interface ModuleStateChangedEvent { // from modules core
  guildId: string; moduleKey: string; enabled: boolean; changedBy: string;
}
```

**Emitted (`dashboard.*`):**

```ts
export interface DashboardModuleToggledEvent {
  guildId: string; moduleKey: string; enabled: boolean; actorDiscordId: string; at: string;
}
export interface DashboardConfigUpdatedEvent {
  guildId: string; module: string; keys: string[]; actorDiscordId: string; at: string;
}
export interface DashboardApiKeyCreatedEvent {
  guildId: string; apiKeyId: string; actorDiscordId: string; at: string;
}
export interface DashboardBackupRequestedEvent {
  guildId: string; backupId: string; actorDiscordId: string; at: string;
}
```

Consumers of `dashboard.*`: the Logging/Audit core (writes audit entries) and any module that needs to
invalidate its own cache when its config changes (it subscribes; the dashboard does not call it).

## 7. Dependencies

The dashboard relies **only** on CORE systems and published module contracts:

- **Cache** — server-side session store (namespaced `dash:sess:*`), aggregation caches, WS ticket store.
  Never touches Redis directly.
- **Event Bus** — subscribes to log/job/module events for realtime; emits `dashboard.*`.
- **Permissions** — `assertManage`, claim resolution and `claim.guard` checks.
- **Database (Prisma via Repositories)** — dashboard-owned tables only (sessions, API keys, backups).
- **Queue (BullMQ)** — enqueues backup and other long-running tasks; reads job state for progress.
- **Config** — reads guild/global settings through the Config public API (ENV -> DB -> defaults).
- **i18n** — reads/writes translations through the i18n module's public contract.
- **Module Registry / Plugin public API** — module list, enable/disable, plugin lifecycle.

It NEVER imports another module's internal service class. Cross-module reads happen through their public
API; cross-module reactions happen through the Event Bus.

## 8. Configuration

Guild-scoped and global settings, all validated with Zod (ENV -> DB -> defaults).

```ts
// src/dashboard/backend/config/dashboard.config.schema.ts
import { z } from 'zod';

export const dashboardGlobalConfigSchema = z.object({
  baseUrl: z.string().url(),
  frontendOrigin: z.string().url(),
  oauth: z.object({
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
    redirectUri: z.string().url(),
    scopes: z.array(z.string()).default(['identify', 'guilds']),
  }),
  session: z.object({
    ttlSeconds: z.number().int().positive().default(60 * 60 * 12), // 12h
    cookieName: z.string().default('ghost_dash_sid'),
    sameSite: z.enum(['lax', 'strict', 'none']).default('lax'),
    secure: z.boolean().default(true),
  }),
  realtime: z.object({
    ticketTtlSeconds: z.number().int().positive().default(30),
    maxConnectionsPerUser: z.number().int().positive().default(5),
  }),
});

export const dashboardGuildConfigSchema = z.object({
  enabled: z.boolean().default(true),
  logRetentionDays: z.number().int().min(1).max(365).default(30),
  analyticsEnabled: z.boolean().default(true),
  allowApiKeys: z.boolean().default(true),
  maxApiKeys: z.number().int().min(0).max(100).default(20),
  backupsEnabled: z.boolean().default(true),
});

export type DashboardGlobalConfig = z.infer<typeof dashboardGlobalConfigSchema>;
export type DashboardGuildConfig = z.infer<typeof dashboardGuildConfigSchema>;
```

Secrets (`clientSecret`) come from ENV only and are never persisted to the DB or exposed via API.

## 9. Database

Prisma models owned by the dashboard. Sessions live in Cache/Redis for hot access, but a durable record
is kept for audit/revocation. Soft-delete via `revokedAt` / `deletedAt` where relevant.

```prisma
model DashboardSession {
  id            String    @id @default(cuid())
  discordId     String
  username      String
  refreshToken  String    // encrypted at rest (AES-GCM via secret manager)
  createdAt     DateTime  @default(now())
  lastSeenAt    DateTime  @default(now())
  expiresAt     DateTime
  revokedAt     DateTime?

  @@index([discordId])
  @@index([expiresAt])
  @@map("dashboard_sessions")
}

model ApiKey {
  id          String    @id @default(cuid())
  guildId     String
  name        String
  prefix      String    // first 8 chars, shown in UI
  hash        String    // argon2id hash of full key; plaintext never stored
  scopes      Json      // string[]
  lastUsedAt  DateTime?
  expiresAt   DateTime?
  revokedAt   DateTime?
  createdAt   DateTime  @default(now())
  createdBy   String    // actor Discord ID

  @@unique([guildId, name])
  @@index([guildId])
  @@index([prefix])
  @@map("dashboard_api_keys")
}

model Backup {
  id          String    @id @default(cuid())
  guildId     String
  status      String    // pending | running | completed | failed
  jobId       String?   // BullMQ job id
  sizeBytes   BigInt?
  storageKey  String?   // object storage path; signed-url download
  error       String?
  requestedBy String
  createdAt   DateTime  @default(now())
  completedAt DateTime?
  deletedAt   DateTime?

  @@index([guildId, status])
  @@index([createdAt])
  @@map("dashboard_backups")
}

model DashboardAuditEntry {
  id          String   @id @default(cuid())
  guildId     String
  actorId     String   // Discord ID
  action      String   // e.g. module.toggle, config.update, apikey.create
  target      String?
  metadata    Json?
  createdAt   DateTime @default(now())

  @@index([guildId, createdAt])
  @@index([actorId])
  @@map("dashboard_audit_entries")
}
```

## 10. API

REST under `/api/dashboard`. All non-auth routes require the session cookie (`SessionGuard`); guild routes
add `GuildManageGuard`; sensitive writes add `ClaimGuard`. Responses are DTOs; inputs Zod-validated.
Fully documented in Swagger/OpenAPI (the frontend client is generated from it).

| Method | Path | Body / Query DTO | Notes |
| --- | --- | --- | --- |
| GET | `/auth/login` | — | 302 to Discord OAuth2 authorize URL with state |
| GET | `/auth/callback` | `?code&state` | Exchanges code, creates session, sets httpOnly cookie |
| POST | `/auth/logout` | — | Destroys session, clears cookie |
| GET | `/auth/me` | — | `DashboardUser` |
| GET | `/guilds` | — | `ManageableGuild[]` (Manage-filtered) |
| GET | `/guilds/:guildId/overview` | — | counts, module summary, recent activity |
| GET | `/guilds/:guildId/modules` | pagination | module list + enabled state |
| PATCH | `/guilds/:guildId/modules/:key` | `ToggleModuleDto` | enable/disable; claim `dashboard.modules.manage` |
| GET | `/guilds/:guildId/config/:module` | — | current effective config + schema |
| PUT | `/guilds/:guildId/config/:module` | `UpdateConfigDto` | Zod-validated; claim `dashboard.config.write` |
| GET | `/guilds/:guildId/logs` | `LogQueryDto` | paginated, filter by category/level/time |
| GET | `/guilds/:guildId/analytics` | `AnalyticsQueryDto` | aggregated metrics, cached |
| GET | `/guilds/:guildId/permissions` | — | claims, groups, inheritance |
| PUT | `/guilds/:guildId/permissions` | `UpdatePermissionsDto` | claim `dashboard.permissions.write` |
| GET | `/guilds/:guildId/translations` | `?namespace&locale` | namespace entries |
| PUT | `/guilds/:guildId/translations` | `UpsertTranslationsDto` | claim `dashboard.translations.write` |
| GET | `/guilds/:guildId/plugins` | — | installed plugins + lifecycle state |
| POST | `/guilds/:guildId/plugins/:key/:lifecycle` | — | install/enable/disable/update/remove |
| GET | `/guilds/:guildId/api-keys` | pagination | `ApiKeyView[]` |
| POST | `/guilds/:guildId/api-keys` | `CreateApiKeyDto` | returns `CreatedApiKey` (plaintext once) |
| DELETE | `/guilds/:guildId/api-keys/:id` | — | revoke |
| GET | `/guilds/:guildId/backups` | pagination | `Backup[]` |
| POST | `/guilds/:guildId/backups` | — | enqueue backup; returns job/backup id |
| GET | `/guilds/:guildId/backups/:id/download` | — | 302 to signed URL |
| GET | `/realtime/ticket` | — | short-lived WS ticket (Cache-stored) |

Example DTOs:

```ts
// src/dashboard/backend/dto/toggle-module.dto.ts
import { z } from 'zod';
export const toggleModuleSchema = z.object({ enabled: z.boolean() });
export type ToggleModuleDto = z.infer<typeof toggleModuleSchema>;

// src/dashboard/backend/dto/create-api-key.dto.ts
export const createApiKeySchema = z.object({
  name: z.string().min(3).max(64),
  scopes: z.array(z.string().regex(/^[a-z0-9.*_-]+$/)).min(1),
  expiresAt: z.string().datetime().nullable().default(null),
});
export type CreateApiKeyDto = z.infer<typeof createApiKeySchema>;

// src/dashboard/backend/dto/log-query.dto.ts
export const logQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  category: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type LogQueryDto = z.infer<typeof logQuerySchema>;
```

**WebSocket:** client requests `GET /realtime/ticket`, opens `WSS /realtime?ticket=...`, the gateway
validates the ticket against Cache, binds the socket to the session, then the client subscribes to
`guild:<id>:<channel>` (authorized against Manage on that guild).

## 11. Permissions

Claims this unit defines (checked by `ClaimGuard`; wildcard `dashboard.*` grants all):

- `dashboard.access` — can open the dashboard at all (implied by Manage Guild).
- `dashboard.modules.manage` — enable/disable modules.
- `dashboard.config.write` — edit module configuration.
- `dashboard.logs.view` — read logs.
- `dashboard.analytics.view` — read analytics.
- `dashboard.permissions.write` — edit claims/groups/inheritance.
- `dashboard.translations.write` — edit translations.
- `dashboard.plugins.manage` — plugin lifecycle actions.
- `dashboard.apikeys.manage` — create/revoke API keys.
- `dashboard.backups.manage` — trigger/download backups.

Baseline gate: every guild route requires `Manage Guild` on Discord (`GuildManageGuard`). Bot owners
bypass guild filtering. Fine-grained writes additionally require the matching claim above.

## 12. Logging

- **Audit hooks:** every write (module toggle, config update, permission/translation change, API key
  create/revoke, backup request) writes a `DashboardAuditEntry` and emits the matching `dashboard.*` event.
- **Categories:** `dashboard.auth`, `dashboard.access`, `dashboard.action`, `dashboard.security`,
  `dashboard.error`, `dashboard.realtime`.
- **Security logging:** failed OAuth callbacks, invalid/expired sessions, ticket misuse, forbidden guild
  access, API-key auth failures — all logged at `warn`/`error` with the actor and request context.
- **No secret leakage:** refresh tokens, client secret and API-key plaintext/hashes are never logged.
- Logs flow through the Logging core (Pino) with trace IDs (OpenTelemetry) for correlation across the BFF
  and module calls. User-facing errors are mapped to safe messages by the unified error system.

## 13. Testing

- **Unit (Vitest):** session service (create/resolve/expire/revoke), guild-access (Manage filtering,
  owner bypass), API-key hashing/verification (argon2id, plaintext returned once), Zod DTO validation,
  guards (`SessionGuard`, `GuildManageGuard`, `ClaimGuard`). Mock CORE via interfaces.
- **Integration:** controllers against an in-memory/SQLite-substitute Prisma + fake Cache/Event Bus;
  OAuth callback flow with a stubbed Discord token endpoint; backup enqueue interacts with a test BullMQ.
- **E2E (Playwright):** login flow (mocked Discord OAuth), guild selector shows only Manage guilds,
  module toggle reflects via WS, config editor validates and saves, logs viewer paginates/filters,
  permission editor round-trips, translation editor saves, API key shown once then masked, backup trigger
  shows progress to completion. Tests run against a seeded test guild.
- **Coverage gates:** services and guards must be covered; security paths (forbidden access, expired
  session, invalid ticket) must have explicit negative tests.

## 14. Dashboard Integration

This document *is* the dashboard. Pages and what each consumes:

- **Overview** — `GET /overview`; counts, recent audit activity, live job/log widgets via WS.
- **Modules** — list + toggle; live `module:state` updates.
- **Config** — per-module editor driven by the module's published Zod schema (form auto-rendered).
- **Logs** — paginated/filterable table + live tail (`guild:<id>:logs`).
- **Analytics** — charts from cached aggregates; range selector.
- **Permissions** — claim/group/inheritance editor with wildcard support.
- **Translations** — namespace + locale editor (PT/EN and any added locale), missing-key highlighting,
  plural/variable preview.
- **Plugins** — install/enable/disable/update/remove with manifest/version/permissions display.
- **API Keys** — list, create (plaintext shown once), revoke.
- **Backups** — trigger, live progress (`guild:<id>:jobs`), download via signed URL.
All pages are i18n-rendered and guarded by the session cookie at the Next.js `middleware.ts` layer plus
backend guards.

## 15. Future Extensions

- GraphQL gateway alongside REST (contract already allows it).
- Multi-factor / passkey step-up for sensitive actions (API keys, backups, permission edits).
- Role-delegated sub-admin access below `Manage Guild` using fine-grained claims only.
- Scheduled/automatic backups and backup restore from the UI.
- Audit-log export and SIEM webhook streaming.
- Theming and white-label per guild; embeddable read-only status widgets.
- Mobile-optimized PWA shell.

## 16. Tasks for Claude

1. **Schema** — add `DashboardSession`, `ApiKey`, `Backup`, `DashboardAuditEntry` Prisma models; create
   migration; add indexes.
2. **Config** — implement `dashboard.config.schema.ts` (global + guild) with Zod and defaults; wire
   ENV -> DB -> defaults.
3. **Repositories** — `session`, `api-key`, `backup` repositories (only Prisma access).
4. **Services** — `auth`, `session`, `guild-access`, `api-key`, `backup`, `dashboard-aggregation`.
5. **Auth/OAuth2** — Discord authorize/callback, session creation, httpOnly cookie, logout, `/auth/me`.
6. **Guards** — `SessionGuard`, `GuildManageGuard`, `ClaimGuard`.
7. **Events** — define `dashboard.*` events; subscribe to log/job/module events for fan-out.
8. **Gateway** — WebSocket hub with ticket auth and channel subscription.
9. **Controllers** — all routes in §10 with DTOs + Swagger annotations.
10. **Frontend** — Next.js app: middleware guard, login/callback, guild selector, all guild pages,
    generated typed API client, WS hooks.
11. **API client generation** — generate the frontend client from the backend OpenAPI spec.
12. **Tests** — Vitest unit/integration, Playwright e2e per §13.
13. **Docs** — finalize this doc; document env vars and deployment.

## 17. Acceptance Criteria

- A user logs in with Discord; no Discord token is ever exposed to the browser.
- The guild selector lists only guilds where the user has `Manage Guild`; owners see all bot guilds.
- Module toggle, config save, permission/translation edits, API key create/revoke and backup trigger all
  work, are Zod-validated, authorized by claim, and produce audit entries + `dashboard.*` events.
- Realtime: a log/job/module change appears in the UI without refresh.
- API key plaintext is returned exactly once and is unrecoverable afterward.
- All endpoints documented in Swagger; the frontend client is generated from it.
- Forbidden/expired-session/invalid-ticket requests are rejected and logged; no internal error leaks.
- UI renders in PT and EN.

## 18. Definition of Done

- All unit, integration and Playwright tests pass; security negative-paths covered.
- Prisma migration created and applied; seeders updated where needed.
- Lint/format clean (ESLint/Prettier); Commitlint-compliant Conventional Commits.
- Backend builds under TypeScript strict mode with no `any`; frontend type-checks clean.
- Swagger/OpenAPI complete; generated client committed.
- This document committed under `docs/architecture/09-dashboard.md`.
- No other module modified; only CORE/public APIs consumed.
- Feature branch `feature/dashboard` opened as a PR into `develop` (no direct commits to `main`).
