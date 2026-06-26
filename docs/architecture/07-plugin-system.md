# Plugin System (SDK)

> ## Claude Instructions
> - Never modify another module. Do not change architecture decisions from `00-project.md`.
> - This is a CORE system (`src/core/plugins`), not a feature module. It exposes the **Plugin SDK** that third parties consume — treat its public surface as a versioned contract and keep backwards compatibility.
> - Plugins MUST NOT touch Prisma, Redis, or another module's internals. They reach everything through the sandboxed `PluginApi` surface only.
> - Keep backwards compatibility. Create Prisma migrations. Generate tests and docs.
> - Generate DTOs. Use Repository Pattern. Use the Event Bus. Use Dependency Injection.
> - No `any`. Keep methods small (<50 lines where reasonable). Follow existing naming.
> - Create indexes for searchable fields (`name`, `guildId`, `status`). Support pagination, caching, translations, and dashboard.
> - Validate every plugin manifest and plugin config with Zod before doing anything else. Reject on failure — never partially load.

---

## 1. Purpose

The Plugin System provides a first-class **SDK and runtime loader** that lets first- and third-party developers extend Ghost Bot **without touching `core` or any existing module**. A plugin is a self-contained, versioned, signed (optional) package that declares a **manifest**, ships **lifecycle hooks**, and interacts with the bot only through a **sandboxed Plugin API surface**.

The system is responsible for:

- Discovering, validating, and resolving plugins and their dependencies.
- Enforcing version compatibility against the host SDK version (semver).
- Driving the plugin lifecycle (`install -> enable -> disable -> update -> remove`) — including **hot enable/disable** without restarting the bot.
- Granting plugins a **least-privilege, capability-scoped API** (`registerCommand`, `on(event)`, `getService` via published public contracts only, cache, logger, config, i18n).
- Making everything **guild-aware**: a plugin can be enabled per guild while its code is loaded once globally.

This document defines the `PluginManifest` and `Plugin` contracts that everything else builds on.

## 2. Goals

- **Zero core coupling.** Plugins import only `@ghost/plugin-sdk` types; they never import from `src/modules/*` or `src/core/*` internals.
- **Safe by default.** A plugin gets exactly the capabilities its manifest declares and its granted permission claims allow — nothing more.
- **Deterministic loading.** Dependency resolution is topologically ordered; cycles and missing/incompatible deps fail fast with actionable errors.
- **Hot lifecycle.** Enable/disable/update a plugin at runtime per guild without dropping the process.
- **Versioned SDK.** The host advertises an SDK semver range; plugins declare the range they support. Incompatible plugins are rejected, never silently broken.
- **Observable.** Every lifecycle transition is logged, audited, traced (OpenTelemetry), and surfaced to the dashboard.
- **Recoverable.** A throwing plugin is isolated, marked `errored`, and disabled — it never takes down the host or other plugins.

## 3. Architecture

The Plugin System lives in `src/core/plugins` and follows the strict layer flow. The dashboard/API call an **Application Service** which orchestrates **Domain Services** (loader, resolver, registry) and persists through a **Repository**. Plugins themselves never see Prisma — they only see the **PluginApi** facade.

```
Controller (PluginsController)
   -> PluginApplicationService        (use-cases: install/enable/disable/update/remove/list)
      -> PluginLifecycleService        (domain: drives hooks, state machine)
      -> PluginLoaderService           (domain: load/unload module into runtime)
      -> PluginDependencyResolver      (domain: topo sort + semver checks)
      -> PluginRegistry                (in-memory live registry of loaded plugins)
      -> PluginRepository              (Prisma) -> Database
```

Key building blocks:

- **PluginHost** — composition root that wires a `PluginApiFactory` per plugin.
- **PluginApiFactory** — builds a per-plugin, capability-scoped `PluginApi`. Wraps the Event Bus, Cache layer, Permission service, i18n, config, and a **public-contract-only service locator**.
- **PluginSandbox** — a `vm`-backed isolation boundary (Node `node:vm` + frozen `module` graph) plus a hard rule: the only objects passed into plugin code are the `PluginApi` and its declared config. Plugins run in-process (no separate worker by default) but with a restricted `require` shim that whitelists `@ghost/plugin-sdk` and the plugin's own declared `dependencies`.
- **ServiceContract registry** — modules publish typed public contracts (e.g. `TicketsPublicApi`) under a string token. `getService(token)` returns the contract or throws if the plugin lacks the `plugins.service.<token>` claim.

Event-driven: lifecycle transitions emit on the Event Bus so other systems (audit, metrics, dashboard live updates) react without coupling.

## 4. Folder Structure

```text
src/core/plugins/
├── plugins.module.ts                  # NestJS module (CORE, global)
├── application/
│   ├── plugin.application-service.ts  # orchestrates use-cases
│   └── dto/
│       ├── install-plugin.dto.ts
│       ├── update-plugin-state.dto.ts
│       └── list-plugins.query.ts
├── domain/
│   ├── plugin-lifecycle.service.ts    # state machine + hook invocation
│   ├── plugin-loader.service.ts       # load/unload runtime module
│   ├── plugin-dependency.resolver.ts  # topo sort + semver compat
│   ├── plugin-registry.ts             # live in-memory registry
│   └── plugin-sandbox.ts              # isolation + require shim
├── api/
│   ├── plugin-api.factory.ts          # builds per-plugin PluginApi
│   ├── plugin-api.ts                  # the sandboxed facade impl
│   └── service-contract.registry.ts   # public contract tokens
├── infrastructure/
│   └── plugin.repository.ts           # Prisma access (ONLY here)
├── controllers/
│   └── plugins.controller.ts          # REST + Swagger
├── contracts/                         # the SDK (published as @ghost/plugin-sdk)
│   ├── plugin.interface.ts            # Plugin
│   ├── plugin-manifest.interface.ts   # PluginManifest
│   ├── plugin-api.interface.ts        # PluginApi surface
│   ├── plugin-context.interface.ts    # PluginContext (per guild)
│   ├── lifecycle-hooks.interface.ts   # PluginHooks
│   └── plugin.enums.ts                # PluginStatus, PluginScope
├── config/
│   └── plugin.config.ts               # Zod schema for system config
├── errors/
│   └── plugin.errors.ts               # categorised plugin errors
└── events/
    └── plugin.events.ts               # event name constants + payloads
```

## 5. Public Interfaces

These are the contracts shipped as `@ghost/plugin-sdk`. Strict TypeScript, no `any`.

```ts
// contracts/plugin.enums.ts
export enum PluginStatus {
  Installed = 'installed',
  Enabled = 'enabled',
  Disabled = 'disabled',
  Errored = 'errored',
  Updating = 'updating',
  Removed = 'removed',
}

export enum PluginScope {
  Guild = 'guild',   // enabled per guild
  Global = 'global', // enabled bot-wide
}
```

```ts
// contracts/plugin-manifest.interface.ts
import type { ZodTypeAny } from 'zod';
import type { PluginScope } from './plugin.enums';

export interface PluginPermissionClaim {
  /** Claim this plugin DEFINES, e.g. `weather.forecast`. */
  readonly claim: string;
  /** Human-readable description for the dashboard. */
  readonly description: string;
}

export interface PluginDependency {
  /** Plugin name OR a published service contract token. */
  readonly name: string;
  /** Semver range the dependency must satisfy, e.g. `^1.2.0`. */
  readonly range: string;
  /** When true the host loads order it first; default true. */
  readonly required?: boolean;
}

export interface PluginManifest<TConfig = unknown> {
  /** Unique kebab-case identifier, e.g. `weather-plugin`. */
  readonly name: string;
  /** Semver of the plugin itself. */
  readonly version: string;
  readonly displayName: string;
  readonly description: string;
  readonly author: string;
  /** Default activation scope. */
  readonly scope: PluginScope;
  /** Semver range of the host SDK this plugin supports, e.g. `>=1.0.0 <2.0.0`. */
  readonly sdkRange: string;
  /** Other plugins / service contracts required, topologically resolved. */
  readonly dependencies: readonly PluginDependency[];
  /** Permission claims this plugin defines and may request to grant. */
  readonly permissions: readonly PluginPermissionClaim[];
  /** Service contract tokens the plugin needs `getService` access to. */
  readonly services: readonly string[];
  /** Zod schema validating this plugin's config (guild-scoped). */
  readonly configSchema: ZodTypeAny;
  /** i18n namespaces this plugin contributes. */
  readonly i18nNamespaces: readonly string[];
  /** SHA-256 of the bundle, verified at load when signing is enabled. */
  readonly checksum?: string;
}
```

```ts
// contracts/lifecycle-hooks.interface.ts
import type { PluginContext } from './plugin-context.interface';

export interface PluginHooks {
  /** Run once when the plugin is first installed (migrations, seed). */
  onInstall?(ctx: PluginContext): Promise<void>;
  /** Run when enabled for a guild/global scope. Register commands/listeners here. */
  onEnable(ctx: PluginContext): Promise<void>;
  /** Run when disabled. MUST release everything onEnable acquired. */
  onDisable(ctx: PluginContext): Promise<void>;
  /** Run when upgrading from a previous version; receives the old version. */
  onUpdate?(ctx: PluginContext, fromVersion: string): Promise<void>;
  /** Run once when fully removed (cleanup persistent state). */
  onRemove?(ctx: PluginContext): Promise<void>;
}
```

```ts
// contracts/plugin.interface.ts
import type { PluginManifest } from './plugin-manifest.interface';
import type { PluginHooks } from './lifecycle-hooks.interface';

export interface Plugin<TConfig = unknown> extends PluginHooks {
  readonly manifest: PluginManifest<TConfig>;
}

/** A plugin bundle's default export is a factory returning a Plugin. */
export type PluginFactory = () => Plugin | Promise<Plugin>;
```

```ts
// contracts/plugin-api.interface.ts
import type { SlashCommandBuilder } from 'discord.js';
import type { ZodTypeAny, infer as ZInfer } from 'zod';

export interface PluginCommandHandler {
  (interaction: import('discord.js').ChatInputCommandInteraction): Promise<void>;
}

export interface PluginCommandRegistration {
  readonly builder: SlashCommandBuilder;
  /** Permission claim required to run this command (must be plugin-defined). */
  readonly requires?: string;
  readonly handler: PluginCommandHandler;
}

export interface ScopedCache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
}

export interface ScopedLogger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/**
 * The ONLY surface a plugin may touch. Capability-scoped per plugin
 * and namespaced per guild via PluginContext.
 */
export interface PluginApi {
  /** Register a slash command owned by this plugin. */
  registerCommand(reg: PluginCommandRegistration): void;
  /** Subscribe to a domain event. Auto-unsubscribed on disable. */
  on<TPayload>(event: string, handler: (payload: TPayload) => Promise<void> | void): void;
  /** Emit a namespaced event onto the bus (prefixed `plugin.<name>.`). */
  emit<TPayload>(event: string, payload: TPayload): Promise<void>;
  /** Resolve a published public contract by token; throws if not granted. */
  getService<T>(token: string): T;
  /** Namespaced cache (memory + Redis behind the Cache layer). */
  readonly cache: ScopedCache;
  /** Structured logger pre-tagged with plugin + guild. */
  readonly logger: ScopedLogger;
  /** Translate using the plugin's namespaces. */
  t(key: string, vars?: Record<string, string | number>): string;
  /** Check a permission claim for a Discord member. */
  can(memberId: string, claim: string): Promise<boolean>;
  /** Validated, typed plugin config for the current scope. */
  config<S extends ZodTypeAny>(schema: S): ZInfer<S>;
}
```

```ts
// contracts/plugin-context.interface.ts
import type { PluginApi } from './plugin-api.interface';
import type { PluginScope } from './plugin.enums';

export interface PluginContext {
  readonly api: PluginApi;
  readonly scope: PluginScope;
  /** Null when scope is Global. */
  readonly guildId: string | null;
  readonly pluginName: string;
  readonly pluginVersion: string;
}
```

```ts
// domain/plugin-registry.ts (host-side, NOT in SDK)
import type { Plugin, PluginStatus } from '../contracts';

export interface LoadedPluginEntry {
  readonly plugin: Plugin;
  status: PluginStatus;
  readonly enabledGuilds: Set<string>;
  readonly registeredCommandIds: string[];
  readonly disposers: Array<() => void>;
}

export abstract class PluginRegistry {
  abstract get(name: string): LoadedPluginEntry | undefined;
  abstract set(name: string, entry: LoadedPluginEntry): void;
  abstract remove(name: string): void;
  abstract all(): readonly LoadedPluginEntry[];
}
```

## 6. Events

All events are emitted via the CORE Event Bus. Plugins consume them through `api.on(...)`; the host emits lifecycle events for audit/metrics/dashboard.

**Emitted by the Plugin System:**

| Event | When | Payload |
| --- | --- | --- |
| `plugin.installed` | After successful install | `PluginInstalledPayload` |
| `plugin.enabled` | After `onEnable` succeeds | `PluginScopePayload` |
| `plugin.disabled` | After `onDisable` succeeds | `PluginScopePayload` |
| `plugin.updated` | After `onUpdate` succeeds | `PluginUpdatedPayload` |
| `plugin.removed` | After `onRemove` succeeds | `PluginRemovedPayload` |
| `plugin.errored` | A hook threw / load failed | `PluginErroredPayload` |

```ts
// events/plugin.events.ts
export interface PluginInstalledPayload {
  readonly name: string;
  readonly version: string;
  readonly actorId: string;
  readonly at: string; // ISO-8601
}

export interface PluginScopePayload {
  readonly name: string;
  readonly version: string;
  readonly guildId: string | null;
  readonly actorId: string;
  readonly at: string;
}

export interface PluginUpdatedPayload {
  readonly name: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly actorId: string;
  readonly at: string;
}

export interface PluginRemovedPayload {
  readonly name: string;
  readonly actorId: string;
  readonly at: string;
}

export interface PluginErroredPayload {
  readonly name: string;
  readonly phase: 'load' | 'install' | 'enable' | 'disable' | 'update' | 'remove' | 'runtime';
  readonly guildId: string | null;
  readonly message: string;
  readonly at: string;
}

export const PLUGIN_EVENTS = {
  Installed: 'plugin.installed',
  Enabled: 'plugin.enabled',
  Disabled: 'plugin.disabled',
  Updated: 'plugin.updated',
  Removed: 'plugin.removed',
  Errored: 'plugin.errored',
} as const;
```

**Consumed:** The Plugin System listens to `core.shutdown` to gracefully disable all plugins, and to `guild.removed` to disable all plugins enabled for that guild.

## 7. Dependencies

The Plugin System depends ONLY on CORE systems — never on feature modules:

- **Event Bus** — emits lifecycle events; mediates plugin `on/emit` (namespaced).
- **Cache layer** — backs `ScopedCache`; plugins never touch Redis directly. Keys are namespaced `plugin:<name>:<guildId>:<key>`.
- **Permissions** — registers plugin-defined claims; enforces `can()` and `getService` grants.
- **Database (PluginRepository)** — persists installed plugins, versions, per-guild enablement, config. Only the repository touches Prisma.
- **Queue (BullMQ)** — long-running `install`/`update` (bundle download, migration) run as jobs with retries + DLQ.
- **i18n** — registers plugin namespaces; backs `api.t()`.
- **Config** — ENV -> DB -> defaults resolution for both system config and per-plugin config.

Plugins reach feature modules **only** via `getService(token)` against published `ServiceContract`s — never by import.

## 8. Configuration

System-level config (global) and per-plugin config (guild-scoped), all Zod-validated. Priority: ENV -> Database -> Defaults.

```ts
// config/plugin.config.ts
import { z } from 'zod';

export const PluginSystemConfigSchema = z.object({
  /** Directory plugins are loaded from. */
  pluginsDir: z.string().default('./plugins'),
  /** Allow third-party (unsigned) plugins. */
  allowUnsigned: z.boolean().default(false),
  /** Require checksum verification on load. */
  verifyChecksum: z.boolean().default(true),
  /** Max plugins loaded per guild. */
  maxPluginsPerGuild: z.number().int().positive().default(50),
  /** Host SDK version advertised to manifests. */
  sdkVersion: z.string().default('1.0.0'),
  /** Hard timeout for any single lifecycle hook (ms). */
  hookTimeoutMs: z.number().int().positive().default(15_000),
  /** Auto-disable a plugin after this many runtime errors. */
  errorThreshold: z.number().int().positive().default(5),
});

export type PluginSystemConfig = z.infer<typeof PluginSystemConfigSchema>;
```

Per-plugin config is validated against the plugin's own `manifest.configSchema`. The host stores the **raw JSON** and re-validates on every read, rejecting and marking `errored` if the schema no longer matches after an update.

```ts
export const StoredPluginConfigSchema = z.object({
  pluginName: z.string(),
  guildId: z.string().nullable(),
  values: z.record(z.unknown()), // validated against manifest.configSchema at read time
});
```

## 9. Database

Prisma models. Guild-aware, soft-delete via `deletedAt`, indexed on searchable fields.

```prisma
model Plugin {
  id          String        @id @default(cuid())
  name        String        @unique
  displayName String
  version     String
  author      String
  scope       PluginScope   @default(GUILD)
  status      PluginStatus  @default(INSTALLED)
  sdkRange    String
  checksum    String?
  manifest    Json          // full validated manifest snapshot
  installedAt DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
  deletedAt   DateTime?

  enablements PluginEnablement[]
  configs     PluginConfig[]
  versions    PluginVersionHistory[]

  @@index([name])
  @@index([status])
  @@index([scope])
}

model PluginEnablement {
  id        String   @id @default(cuid())
  pluginId  String
  guildId   String?  // null => global
  enabled   Boolean  @default(true)
  enabledBy String
  enabledAt DateTime @default(now())
  deletedAt DateTime?

  plugin    Plugin   @relation(fields: [pluginId], references: [id], onDelete: Cascade)

  @@unique([pluginId, guildId])
  @@index([guildId])
  @@index([pluginId])
}

model PluginConfig {
  id        String   @id @default(cuid())
  pluginId  String
  guildId   String?  // null => global config
  values    Json
  updatedAt DateTime @updatedAt

  plugin    Plugin   @relation(fields: [pluginId], references: [id], onDelete: Cascade)

  @@unique([pluginId, guildId])
  @@index([pluginId])
}

model PluginVersionHistory {
  id          String   @id @default(cuid())
  pluginId    String
  fromVersion String?
  toVersion   String
  actorId     String
  appliedAt   DateTime @default(now())

  plugin      Plugin   @relation(fields: [pluginId], references: [id], onDelete: Cascade)

  @@index([pluginId])
}

enum PluginScope {
  GUILD
  GLOBAL
}

enum PluginStatus {
  INSTALLED
  ENABLED
  DISABLED
  ERRORED
  UPDATING
  REMOVED
}
```

Soft-delete: `removePlugin` sets `deletedAt` and `status = REMOVED`; physical deletion of bundle files is a separate, audited job. All read queries filter `deletedAt: null`.

## 10. API

REST under `/api/v1/plugins`, Swagger-documented. DTOs validated with Zod via a pipe.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/plugins` | List plugins (paginated, filter by status/scope/guildId) |
| `GET` | `/plugins/:name` | Get one plugin + manifest + enablement state |
| `POST` | `/plugins` | Install a plugin (bundle ref / registry name) |
| `PATCH` | `/plugins/:name/state` | Enable / disable for a guild or globally |
| `PATCH` | `/plugins/:name/config` | Update guild-scoped config (validated) |
| `POST` | `/plugins/:name/update` | Update to a new version |
| `DELETE` | `/plugins/:name` | Remove (soft delete) |

```ts
// application/dto/install-plugin.dto.ts
import { z } from 'zod';

export const InstallPluginSchema = z.object({
  source: z.string().min(1),            // registry name or bundle URL/path
  scope: z.enum(['guild', 'global']),
  guildId: z.string().nullable(),
});
export type InstallPluginDto = z.infer<typeof InstallPluginSchema>;

export const UpdatePluginStateSchema = z.object({
  enabled: z.boolean(),
  guildId: z.string().nullable(),
});
export type UpdatePluginStateDto = z.infer<typeof UpdatePluginStateSchema>;

export const ListPluginsQuerySchema = z.object({
  status: z.nativeEnum({ INSTALLED: 'INSTALLED', ENABLED: 'ENABLED', DISABLED: 'DISABLED', ERRORED: 'ERRORED' } as const).optional(),
  guildId: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});
export type ListPluginsQuery = z.infer<typeof ListPluginsQuerySchema>;
```

WS: lifecycle events are pushed to the dashboard over the existing realtime gateway channel `plugins:<guildId>` so state badges update live.

## 11. Permissions

The Plugin System DEFINES these host-level claims (wildcards supported, e.g. `plugins.*`):

| Claim | Allows |
| --- | --- |
| `plugins.view` | List/inspect plugins |
| `plugins.install` | Install a new plugin |
| `plugins.enable` | Enable a plugin for a guild |
| `plugins.disable` | Disable a plugin |
| `plugins.update` | Update a plugin version |
| `plugins.remove` | Remove a plugin |
| `plugins.config` | Edit a plugin's config |
| `plugins.service.<token>` | Grant a plugin `getService` access to a contract token |

Each installed plugin **registers its own claims** from `manifest.permissions` into the Permissions system (namespaced under the plugin name), with groups/inheritance/Discord-role mapping handled by CORE. A plugin command's `requires` claim must be one the plugin defined, or registration is rejected.

## 12. Logging

- **Categories:** `plugin.lifecycle`, `plugin.runtime`, `plugin.security`, `plugin.resolver`.
- Every lifecycle transition logs at `info` with `{ pluginName, version, scope, guildId, actorId }`.
- Hook failures log at `error` with the categorised `PluginError` code and a redacted stack (never leak host internals to the dashboard).
- The per-plugin `ScopedLogger` auto-tags `pluginName`, `guildId`, and a `traceId` (OpenTelemetry span) so plugin logs are filterable.
- **Audit hooks:** install/enable/disable/update/remove emit audit records via the Event Bus consumed by the Audit module — recording actor, before/after status, and timestamp.
- Security category logs checksum mismatches, unsigned-plugin loads (when allowed), and denied `getService`/claim attempts.

## 13. Testing

- **Unit (Vitest):**
  - `PluginDependencyResolver`: topo ordering, cycle detection, semver compat (`sdkRange` + dependency `range`), missing/optional deps.
  - Manifest Zod validation: rejects malformed manifests; accepts valid ones.
  - `PluginApiFactory`: `getService` throws without the `plugins.service.<token>` grant; cache keys are namespaced; `on()` registers disposers.
  - Lifecycle state machine: illegal transitions rejected (e.g. enable from `REMOVED`).
- **Integration:** load a fixture plugin from a temp dir, install -> enable -> disable -> update -> remove against a test DB; assert events emitted and DB state.
- **e2e (Playwright):** dashboard install/enable/disable flow updates the live badge; REST endpoints enforce permission claims (401/403).
- Coverage MUST include the error path: a throwing `onEnable` marks `ERRORED`, rolls back, and never leaves dangling command registrations.

## 14. Dashboard Integration

- **Plugins page:** searchable, paginated table (name, version, author, scope, status badge) with live updates via the `plugins:<guildId>` WS channel.
- **Detail drawer:** manifest summary, declared permissions (with grant toggles gated by `plugins.service.*`), dependency tree, version history.
- **Per-guild enablement toggle** with optimistic UI and rollback on error.
- **Config editor:** auto-generated from `manifest.configSchema` (Zod -> form), validated client- and server-side.
- **Install dialog:** source input, scope selector, compatibility pre-check (shows SDK/dependency mismatches before installing).
- All labels translated (PT primary, EN secondary) using the plugin system's i18n namespace `plugins`.

## 15. Future Extensions

- **Out-of-process sandbox** (worker threads / separate process) for untrusted third-party plugins with resource quotas (CPU/memory).
- **Plugin marketplace/registry** with signed bundles, ratings, and one-click install.
- **Capability marketplace:** modules publish more granular contracts; plugins request fine-grained scopes.
- **Per-plugin rate limiting** on `emit` and command usage.
- **Hot module reload** for plugin development (`onReload` hook).
- **Plugin-to-plugin contracts:** a plugin publishing its own `ServiceContract` for others to consume.

## 16. Tasks for Claude

1. **Phase 1 — Schema:** Add `Plugin`, `PluginEnablement`, `PluginConfig`, `PluginVersionHistory` models + enums; create Prisma migration. Implement `PluginRepository` (soft-delete aware).
2. **Phase 2 — Contracts/SDK:** Implement all `contracts/*` interfaces and enums; export as `@ghost/plugin-sdk`. Add Zod schemas in `config/`.
3. **Phase 3 — Domain services:** `PluginDependencyResolver` (topo + semver), `PluginRegistry`, `PluginLoaderService`, `PluginSandbox`, `PluginLifecycleService` (state machine).
4. **Phase 4 — API surface:** `PluginApiFactory`, `PluginApi` impl, `ServiceContractRegistry`. Wire cache/events/permissions/i18n/config.
5. **Phase 5 — Events:** Define `PLUGIN_EVENTS` + payloads; emit on every transition; consume `core.shutdown` and `guild.removed`.
6. **Phase 6 — Commands:** Implement plugin command registration into Necord; ensure disable cleanly deregisters.
7. **Phase 7 — Application + Controller:** `PluginApplicationService` use-cases; `PluginsController` REST endpoints with DTOs, Swagger, permission guards.
8. **Phase 8 — Dashboard:** Plugins page, detail drawer, config editor, install dialog, live WS updates.
9. **Phase 9 — Tests:** Unit + integration + e2e per section 13.
10. **Phase 10 — Docs:** SDK author guide + update this spec's references.

## 17. Acceptance Criteria

- A valid third-party plugin can be installed, enabled per guild, disabled, updated, and removed **without restarting the bot or modifying core/modules**.
- Installing a plugin whose `sdkRange` excludes the host SDK version is **rejected** with a clear error and no DB write.
- Dependency cycles and missing required dependencies fail installation with actionable messages.
- A plugin calling `getService('tickets')` without the `plugins.service.tickets` grant throws and is logged under `plugin.security`.
- Disabling a plugin removes all its slash commands and event listeners (verified — no leaks).
- A throwing `onEnable` leaves the plugin `ERRORED`, emits `plugin.errored`, and does not affect other plugins.
- All endpoints enforce the correct `plugins.*` claims; unauthorized requests return 403.
- Plugin config is Zod-validated against `manifest.configSchema` on every write and read.
- Dashboard reflects state changes live via WS.

## 18. Definition of Done

- All 18 sections implemented and reflected in code.
- Prisma migration created and applied; `prisma generate` clean.
- Vitest unit + integration suites pass; Playwright e2e for the plugin flow passes; coverage meets project threshold.
- ESLint/Prettier clean; no `any`; Commitlint-compliant Conventional Commits.
- Swagger docs generated for all `/api/v1/plugins` endpoints.
- i18n keys added for PT + EN under the `plugins` namespace.
- `@ghost/plugin-sdk` package exports compile and are documented with a sample plugin.
- Feature branch `feature/plugin-system` opened as a PR into `develop` (never directly to `main`), CI green.
