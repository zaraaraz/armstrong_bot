# FiveM Module

> ## Claude Instructions
> - Never modify another module. Do not change architecture decisions from `00-project.md`.
> - Keep backwards compatibility. Create Prisma migrations for every schema change. Generate tests and docs.
> - Generate DTOs for every endpoint. Use the Repository Pattern. Use the Event Bus. Use Dependency Injection.
> - No `any`. Keep methods small (<50 lines where reasonable). Follow existing naming conventions.
> - Create indexes for searchable fields (license, steamId, discordId, guildId). Support pagination, caching, translations, and dashboard exposure.
> - Never touch Prisma outside repositories. Never touch Redis outside the Cache layer. Never call another module's internal services — use the Event Bus or its published public API.
> - All RCON/txAdmin credentials are secrets: never log them, never return them in DTOs, never cache them in plaintext. Encrypt at rest, redact in logs.
> - Every dangerous action (restart, execute, kick, ban) is permission-gated AND audit-logged. No exceptions.

---

## 1. Purpose

The **FiveM Module** is the bridge between a Ghost Bot guild and one or more FiveM/GTA-V game servers. It lets staff and players query and operate the game server directly from Discord and the dashboard, without ever exposing raw RCON or txAdmin credentials.

It covers three broad capability groups:

1. **Read / lookup** — server status, online player list, queue, online staff, individual player lookup by Steam / Discord / license identifiers, character & vehicle inspection, in-game economy (cash/bank/jobs), and an MDT (Mobile Data Terminal) view of a player's record.
2. **Operate** — restart the server, execute arbitrary console/RCON commands, kick players, send in-game messages, run txAdmin actions (announce, restart schedule, resource control).
3. **Govern** — punishments (warn/kick/ban), whitelist management, and **ban synchronization** between Discord, the Ghost Bot moderation module (via events), and the FiveM server's ban store.

The module is multi-guild aware: every guild configures its own set of FiveM servers, each with its own connection adapter (txAdmin REST, RCON UDP, or a custom in-game resource HTTP callback). Dangerous operations are wildcard-permission gated (`fivem.restart`, `fivem.execute`, `fivem.ban`) and always written to the audit log.

This document is the single source of truth for the module's architecture, contracts, schema, API, and the ordered build tasks for Claude.

---

## 2. Goals

- **Unify multiple connection methods** behind one abstraction: txAdmin REST API, raw RCON (UDP), and an optional in-game HTTP resource. A guild may register several servers, each using a different adapter, and the module behaves identically.
- **Secure credential handling**: RCON passwords and txAdmin tokens are encrypted at rest (AES-256-GCM via the core secrets service), decrypted only in-memory at call time, never logged, never serialised into DTOs or cache.
- **Permission-gated dangerous actions**: reads are broadly available; mutating/dangerous actions require specific wildcard claims and are blocked + audited if missing.
- **Fast lookups**: player/character/economy lookups are cached (namespaced, short TTL) through the Cache layer; live status is polled and cached so Discord commands never hammer the game server.
- **Resilience**: every adapter call is wrapped with timeouts, retries (where idempotent), and circuit-breaking. Long-running or scheduled actions (scheduled restarts, ban-sync sweeps) go through BullMQ.
- **Ban synchronization**: a ban placed in Discord (moderation module) can propagate to FiveM, and an in-game ban can surface back into Ghost Bot, all via the Event Bus — never by importing the moderation module.
- **Full observability**: structured Pino logs, Prometheus metrics (adapter latency, command counts, restart events), OpenTelemetry spans across the adapter calls.
- **i18n**: all user-facing command output and embeds are translatable (PT primary, EN secondary), with namespaces `fivem.*`.
- **Dashboard parity**: everything available as a slash command is also available on the dashboard with the same permission checks.

---

## 3. Architecture

The module follows the strict layer flow from the contract:

```
Discord (Necord) / REST Controller
        │
        ▼
Application Service  (FivemServerService, FivemPlayerService, FivemModerationService, FivemAdminService)
        │
        ▼
Domain Service       (FivemIdentityResolver, FivemPunishmentPolicy, BanSyncCoordinator)
        │
        ▼
Adapter Layer        (FivemAdapter abstraction → TxAdminAdapter | RconAdapter | InGameHttpAdapter)
        │                                   ▲
        ▼                                   │
Repository           (Prisma)        Secrets / Cache / Events / Queue (CORE)
        │
        ▼
Database (MySQL)
```

### 3.1 Adapter sub-architecture (the core of this module)

The defining design decision is the **integration adapter layer**. The application/domain layers never speak txAdmin or RCON. They depend on a single abstract contract, `FivemAdapter`, resolved per-server at runtime by a factory.

```
FivemAdapterFactory.resolve(server) ──► FivemAdapter
                                          ├── TxAdminAdapter   (HTTP REST + cookie/JWT session)
                                          ├── RconAdapter      (UDP rcon protocol, fivem flavour)
                                          └── InGameHttpAdapter (signed HTTP to a custom resource)
```

- **`FivemAdapter`** is an abstract class declaring the full operation surface (status, players, kick, ban, execute, restart, whitelist, economy lookup, etc.). Each concrete adapter implements what its transport supports and throws `UnsupportedFivemOperationError` for the rest (callers check `adapter.supports(op)`).
- **Capability negotiation**: each adapter exposes a `capabilities: FivemCapabilitySet`. The application service consults capabilities before offering an action, so the dashboard/commands degrade gracefully (e.g. economy lookup only when an in-game resource is configured).
- **Credential injection**: the factory pulls the encrypted credentials from the repository, decrypts them via `SecretsService` (core), and hands a short-lived, in-memory `FivemConnection` to the adapter. Credentials are never stored on the adapter instance beyond the call scope.
- **Resilience wrapper**: every adapter is wrapped by a `ResilientFivemAdapter` decorator that adds timeout, retry (idempotent ops only), circuit breaker, latency metrics, and OTel spans — so concrete adapters stay thin.

### 3.2 Identity resolution

FiveM identifiers come in many shapes (`steam:110000...`, `license:abcd...`, `discord:123...`, `fivem:456...`, `ip:...`). `FivemIdentityResolver` (domain service) maps any incoming identifier (a Discord user, a Steam ID, a license) to a canonical `FivemPlayerIdentity` and back, persisting the link in `FivemPlayerLink` so subsequent lookups are O(1) and cached.

### 3.3 Ban sync coordinator

`BanSyncCoordinator` reacts to `moderation.member.banned` events (consumed) and to in-game ban detections (produced by polling/adapter callbacks), reconciles them against `FivemBan`, and emits `fivem.ban.synced`. It never imports the moderation module — it only listens to the published event contract.

---

## 4. Folder Structure

```
src/modules/fivem/
├── fivem.module.ts                      # NestJS module wiring (providers, exports = public API only)
├── index.ts                             # PUBLIC API barrel (contracts + public service tokens only)
│
├── api/
│   ├── fivem-server.controller.ts       # REST: status, restart, execute
│   ├── fivem-player.controller.ts       # REST: lookup, list, character, economy, vehicles
│   ├── fivem-moderation.controller.ts   # REST: punishments, whitelist, bans
│   └── dto/
│       ├── server-status.dto.ts
│       ├── execute-command.dto.ts
│       ├── player-lookup.dto.ts
│       ├── player-list.dto.ts
│       ├── punishment.dto.ts
│       ├── whitelist.dto.ts
│       └── pagination.dto.ts
│
├── application/
│   ├── fivem-server.service.ts          # status, queue, restart, execute, online staff
│   ├── fivem-player.service.ts          # lookup, list, character, vehicle, economy, MDT
│   ├── fivem-moderation.service.ts      # warn/kick/ban/unban, whitelist
│   └── fivem-admin.service.ts           # server registration, credential rotation, capabilities
│
├── domain/
│   ├── fivem-identity-resolver.service.ts
│   ├── fivem-punishment-policy.service.ts
│   ├── ban-sync-coordinator.service.ts
│   ├── entities/
│   │   ├── fivem-player-identity.ts
│   │   ├── fivem-server.entity.ts
│   │   └── fivem-punishment.entity.ts
│   └── value-objects/
│       ├── fivem-identifier.vo.ts        # parses steam:/license:/discord:/fivem:/ip:
│       └── server-status.vo.ts
│
├── adapters/                            # INTEGRATION SUB-ARCHITECTURE
│   ├── fivem-adapter.abstract.ts        # abstract class contract
│   ├── fivem-adapter.factory.ts
│   ├── resilient-fivem-adapter.ts       # decorator: timeout/retry/breaker/metrics/otel
│   ├── txadmin/
│   │   ├── txadmin.adapter.ts
│   │   ├── txadmin.client.ts             # thin HTTP client (session, CSRF)
│   │   └── txadmin.types.ts
│   ├── rcon/
│   │   ├── rcon.adapter.ts
│   │   └── rcon.client.ts                # UDP rcon protocol
│   └── ingame-http/
│       ├── ingame-http.adapter.ts
│       └── ingame-http.client.ts         # HMAC-signed requests to in-game resource
│
├── repositories/
│   ├── fivem-server.repository.ts
│   ├── fivem-player-link.repository.ts
│   ├── fivem-ban.repository.ts
│   ├── fivem-punishment.repository.ts
│   └── fivem-whitelist.repository.ts
│
├── events/
│   ├── fivem.events.ts                  # event name constants + payload types
│   └── handlers/
│       ├── on-member-banned.handler.ts  # consumes moderation.member.banned
│       └── on-member-unbanned.handler.ts
│
├── jobs/
│   ├── status-poll.job.ts               # recurring: poll status → cache + emit
│   ├── ban-sync-sweep.job.ts            # recurring: reconcile bans
│   └── scheduled-restart.job.ts         # delayed/cron restart
│
├── commands/
│   ├── fivem-status.command.ts
│   ├── fivem-players.command.ts
│   ├── fivem-lookup.command.ts
│   ├── fivem-restart.command.ts
│   ├── fivem-execute.command.ts
│   ├── fivem-punish.command.ts
│   ├── fivem-whitelist.command.ts
│   └── fivem-mdt.command.ts
│
├── config/
│   └── fivem.config.ts                  # Zod schemas (global + guild-scoped)
│
├── permissions/
│   └── fivem.permissions.ts             # claim definitions
│
└── i18n/
    ├── pt.json
    └── en.json
```

---

## 5. Public Interfaces

These are the **only** symbols exported from `src/modules/fivem/index.ts`. Other modules consume the FiveM module exclusively through these contracts (or via events).

```typescript
// fivem-adapter.abstract.ts ─ the integration contract

/** Canonical, parsed FiveM identifier. */
export interface FivemIdentifier {
  readonly kind: 'steam' | 'license' | 'discord' | 'fivem' | 'live' | 'xbl' | 'ip';
  readonly value: string;
  /** Original raw form, e.g. "steam:110000112345678". */
  readonly raw: string;
}

export interface FivemServerStatus {
  readonly online: boolean;
  readonly hostname: string;
  readonly players: number;
  readonly maxPlayers: number;
  readonly queue: number;
  readonly uptimeSeconds: number | null;
  readonly resourcesLoaded: number | null;
  readonly fetchedAt: string; // ISO-8601
}

export interface FivemOnlinePlayer {
  readonly serverPlayerId: number; // in-game id
  readonly name: string;
  readonly identifiers: ReadonlyArray<FivemIdentifier>;
  readonly ping: number | null;
  readonly job: string | null;
  readonly isStaff: boolean;
}

export interface FivemCharacter {
  readonly characterId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly job: string | null;
  readonly jobGrade: number | null;
  readonly lastSeenAt: string | null;
}

export interface FivemEconomySnapshot {
  readonly characterId: string;
  readonly cash: number;
  readonly bank: number;
  readonly currency: string; // ISO-like code from config, default "USD"
  readonly job: string | null;
  readonly fetchedAt: string;
}

export interface FivemVehicle {
  readonly plate: string;
  readonly model: string;
  readonly garage: string | null;
  readonly stored: boolean;
}

export type FivemOperation =
  | 'status' | 'players' | 'kick' | 'ban' | 'unban'
  | 'execute' | 'restart' | 'message' | 'whitelist'
  | 'character' | 'economy' | 'vehicles' | 'mdt';

export interface FivemCapabilitySet {
  readonly supports: ReadonlySet<FivemOperation>;
}

/** Result of a mutating/console action. */
export interface FivemActionResult {
  readonly ok: boolean;
  readonly rawResponse: string | null; // redacted of secrets before return
  readonly executedAt: string;
}

/** Short-lived decrypted connection handed to an adapter at call time. */
export interface FivemConnection {
  readonly host: string;
  readonly port: number;
  readonly transport: 'txadmin' | 'rcon' | 'ingame-http';
  /** Decrypted in-memory only. Never logged, never serialised. */
  readonly secret: string;
  readonly extra?: Readonly<Record<string, string>>;
}

/**
 * The single integration contract. Application/domain layers depend ONLY on this.
 * Concrete adapters implement what their transport supports; otherwise throw
 * UnsupportedFivemOperationError. Callers gate on `capabilities`.
 */
export abstract class FivemAdapter {
  abstract readonly capabilities: FivemCapabilitySet;
  supports(op: FivemOperation): boolean {
    return this.capabilities.supports.has(op);
  }
  abstract getStatus(conn: FivemConnection): Promise<FivemServerStatus>;
  abstract listPlayers(conn: FivemConnection): Promise<ReadonlyArray<FivemOnlinePlayer>>;
  abstract kick(conn: FivemConnection, target: FivemIdentifier, reason: string): Promise<FivemActionResult>;
  abstract ban(conn: FivemConnection, target: FivemIdentifier, reason: string, expiresAt: Date | null): Promise<FivemActionResult>;
  abstract unban(conn: FivemConnection, target: FivemIdentifier): Promise<FivemActionResult>;
  abstract execute(conn: FivemConnection, command: string): Promise<FivemActionResult>;
  abstract restart(conn: FivemConnection, reason: string): Promise<FivemActionResult>;
  abstract broadcast(conn: FivemConnection, message: string): Promise<FivemActionResult>;
  abstract setWhitelist(conn: FivemConnection, target: FivemIdentifier, enabled: boolean): Promise<FivemActionResult>;
  abstract getCharacter(conn: FivemConnection, target: FivemIdentifier): Promise<FivemCharacter | null>;
  abstract getEconomy(conn: FivemConnection, characterId: string): Promise<FivemEconomySnapshot | null>;
  abstract getVehicles(conn: FivemConnection, characterId: string): Promise<ReadonlyArray<FivemVehicle>>;
}

/** Public service contract other modules may depend on (token: FIVEM_PUBLIC_API). */
export interface FivemPublicApi {
  getServerStatus(guildId: string, serverId: string): Promise<FivemServerStatus>;
  resolveIdentity(guildId: string, identifier: string): Promise<FivemPlayerIdentitySnapshot | null>;
  isBanned(guildId: string, identifier: string): Promise<boolean>;
}

export interface FivemPlayerIdentitySnapshot {
  readonly playerLinkId: string;
  readonly discordId: string | null;
  readonly steamId: string | null;
  readonly license: string | null;
  readonly lastKnownName: string | null;
}

export class UnsupportedFivemOperationError extends Error {
  constructor(public readonly operation: FivemOperation, public readonly transport: string) {
    super(`Operation "${operation}" is not supported by transport "${transport}".`);
    this.name = 'UnsupportedFivemOperationError';
  }
}
```

```typescript
// fivem-adapter.factory.ts (signature)
export abstract class FivemAdapterFactory {
  abstract resolve(server: FivemServerEntity): Promise<{
    adapter: FivemAdapter;
    connection: FivemConnection; // decrypted, in-memory, call-scoped
  }>;
}
```

---

## 6. Events

All events flow through the core **Event Bus** with namespaced names. Payloads are typed in `fivem.events.ts`. The module never imports another module to emit/consume — only the event contract.

### 6.1 Emitted (produced)

```typescript
export const FIVEM_EVENTS = {
  STATUS_CHANGED: 'fivem.status.changed',
  SERVER_RESTARTED: 'fivem.server.restarted',
  COMMAND_EXECUTED: 'fivem.command.executed',
  PLAYER_PUNISHED: 'fivem.player.punished',
  BAN_SYNCED: 'fivem.ban.synced',
  WHITELIST_CHANGED: 'fivem.whitelist.changed',
  IDENTITY_LINKED: 'fivem.identity.linked',
} as const;

export interface FivemStatusChangedPayload {
  guildId: string;
  serverId: string;
  previous: FivemServerStatus | null;
  current: FivemServerStatus;
}

export interface FivemServerRestartedPayload {
  guildId: string;
  serverId: string;
  actorDiscordId: string;
  reason: string;
  scheduled: boolean;
  at: string;
}

export interface FivemCommandExecutedPayload {
  guildId: string;
  serverId: string;
  actorDiscordId: string;
  command: string;     // redacted of secrets
  success: boolean;
  at: string;
}

export interface FivemPlayerPunishedPayload {
  guildId: string;
  serverId: string;
  punishmentId: string;
  type: 'warn' | 'kick' | 'ban';
  targetIdentifier: string;
  actorDiscordId: string;
  reason: string;
  expiresAt: string | null;
}

export interface FivemBanSyncedPayload {
  guildId: string;
  serverId: string;
  banId: string;
  direction: 'discord_to_game' | 'game_to_discord';
  targetIdentifier: string;
}
```

### 6.2 Consumed

| Event | Source (contract) | Handler | Action |
|-------|-------------------|---------|--------|
| `moderation.member.banned` | Moderation module public contract | `OnMemberBannedHandler` | If guild config `banSync.discordToGame` is on, resolve identity and ban in all configured servers; create `FivemBan`; emit `fivem.ban.synced`. |
| `moderation.member.unbanned` | Moderation module public contract | `OnMemberUnbannedHandler` | Lift matching `FivemBan` and call `adapter.unban`; emit `fivem.ban.synced`. |
| `guild.deleted` | Core | internal | Soft-delete all FiveM data for the guild. |

> Payloads of consumed events are validated with Zod at the handler boundary; a malformed payload is logged (`fivem.event.invalid`) and dropped, never thrown into the bus.

---

## 7. Dependencies

The module depends **only** on CORE systems — never on another module directly.

| Core system | Used for |
|-------------|----------|
| **Cache layer** (memory + Redis) | Cached server status (`fivem:status:{guildId}:{serverId}`, TTL 15s), identity resolution (`fivem:identity:{guildId}:{hash}`, TTL 300s), economy/character snapshots (TTL 30s). Namespaced keys. No module touches Redis directly. |
| **Event Bus** | Emit/consume the events in §6. |
| **Permissions** | Wildcard claim checks (`fivem.*`) before every command/endpoint. |
| **Database (Prisma)** | Via repositories only. |
| **Queue (BullMQ)** | `status-poll`, `ban-sync-sweep`, `scheduled-restart` jobs; retries + DLQ. |
| **Secrets service** (core) | Encrypt/decrypt RCON passwords & txAdmin tokens (AES-256-GCM). |
| **Config service** (core) | ENV → DB → defaults resolution, Zod validation. |
| **Logger (Pino)** | Structured logs + audit hooks. |
| **i18n service** | Translate command/embed output (`fivem.*` namespace). |
| **Telemetry** (OTel + Prometheus) | Spans + metrics around adapter calls. |

> The module **publishes** `FivemPublicApi` (token `FIVEM_PUBLIC_API`) so other modules (e.g. a dashboard-stats module) can read status/identity/ban-state without importing internals.

---

## 8. Configuration

Config priority is **ENV → Database → Defaults**, all validated with Zod. There is a small **global** section and a rich **guild-scoped** section (one config block per registered server lives in the DB; this Zod schema validates the editable settings).

```typescript
import { z } from 'zod';

/** Global (ENV/bootstrap) — secrets master key + transport defaults. */
export const fivemGlobalConfigSchema = z.object({
  FIVEM_ENABLED: z.coerce.boolean().default(true),
  FIVEM_DEFAULT_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(8_000),
  FIVEM_MAX_SERVERS_PER_GUILD: z.coerce.number().int().min(1).max(50).default(5),
  FIVEM_STATUS_POLL_INTERVAL_MS: z.coerce.number().int().min(5_000).default(15_000),
  FIVEM_CIRCUIT_BREAKER_THRESHOLD: z.coerce.number().int().min(1).default(5),
});
export type FivemGlobalConfig = z.infer<typeof fivemGlobalConfigSchema>;

/** Guild-scoped per-server settings (stored in DB, edited via dashboard). */
export const fivemServerConfigSchema = z.object({
  label: z.string().min(1).max(64),
  transport: z.enum(['txadmin', 'rcon', 'ingame-http']),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65_535),
  currency: z.string().min(1).max(8).default('USD'),
  staffJobs: z.array(z.string()).default(['police', 'ambulance', 'admin']),
  banSync: z.object({
    discordToGame: z.boolean().default(false),
    gameToDiscord: z.boolean().default(false),
    defaultBanDays: z.number().int().min(0).max(3650).default(0), // 0 = permanent
  }).default({}),
  restart: z.object({
    requireReason: z.boolean().default(true),
    announceSeconds: z.number().int().min(0).max(600).default(60),
    allowScheduled: z.boolean().default(true),
  }).default({}),
  execute: z.object({
    enabled: z.boolean().default(false),
    blocklist: z.array(z.string()).default(['quit', 'sv_licenseKey', 'set steam_webApiKey']),
  }).default({}),
  cacheTtlSeconds: z.object({
    status: z.number().int().min(5).default(15),
    identity: z.number().int().min(30).default(300),
    economy: z.number().int().min(5).default(30),
  }).default({}),
}).strict();
export type FivemServerConfig = z.infer<typeof fivemServerConfigSchema>;
```

> **Credentials are NOT in this schema.** The RCON password / txAdmin token / in-game HMAC key are written through a dedicated, write-only endpoint into the encrypted `FivemServer.encryptedSecret` column and never read back into config DTOs.

---

## 9. Database

Prisma models (additions). All are guild-aware. Soft-delete via `deletedAt` where data is user-meaningful. Indexes on every searchable identifier.

```prisma
model FivemServer {
  id              String    @id @default(cuid())
  guildId         String
  label           String
  transport       FivemTransport
  host            String
  port            Int
  /// AES-256-GCM ciphertext (rcon pw / txadmin token / hmac key). Never returned in DTOs.
  encryptedSecret String    @db.Text
  /// non-secret config (FivemServerConfig minus credentials), validated by Zod on write
  config          Json
  enabled         Boolean   @default(true)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  deletedAt       DateTime?

  playerLinks  FivemPlayerLink[]
  bans         FivemBan[]
  punishments  FivemPunishment[]
  whitelist    FivemWhitelist[]

  @@index([guildId])
  @@index([guildId, enabled])
  @@map("fivem_servers")
}

enum FivemTransport {
  TXADMIN
  RCON
  INGAME_HTTP
}

model FivemPlayerLink {
  id            String    @id @default(cuid())
  guildId       String
  serverId      String
  discordId     String?
  steamId       String?
  license       String?
  fivemId       String?
  lastKnownName String?
  lastSeenAt    DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  server FivemServer @relation(fields: [serverId], references: [id])

  @@unique([serverId, license])
  @@index([guildId, discordId])
  @@index([guildId, steamId])
  @@index([guildId, license])
  @@index([guildId, lastKnownName])
  @@map("fivem_player_links")
}

model FivemPunishment {
  id               String        @id @default(cuid())
  guildId          String
  serverId         String
  type             PunishmentType
  targetIdentifier String        // canonical raw identifier
  targetLinkId     String?
  actorDiscordId   String
  reason           String        @db.Text
  expiresAt        DateTime?
  createdAt        DateTime      @default(now())
  deletedAt        DateTime?

  server FivemServer @relation(fields: [serverId], references: [id])

  @@index([guildId, serverId])
  @@index([guildId, targetIdentifier])
  @@index([guildId, type])
  @@map("fivem_punishments")
}

enum PunishmentType {
  WARN
  KICK
  BAN
}

model FivemBan {
  id               String    @id @default(cuid())
  guildId          String
  serverId         String
  targetIdentifier String
  reason           String    @db.Text
  actorDiscordId   String
  source           BanSource
  active           Boolean   @default(true)
  expiresAt        DateTime?
  syncedAt         DateTime?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt
  deletedAt        DateTime?

  server FivemServer @relation(fields: [serverId], references: [id])

  @@unique([serverId, targetIdentifier, active])
  @@index([guildId, targetIdentifier])
  @@index([guildId, active])
  @@map("fivem_bans")
}

enum BanSource {
  DISCORD
  GAME
  DASHBOARD
}

model FivemWhitelist {
  id               String    @id @default(cuid())
  guildId          String
  serverId         String
  targetIdentifier String
  addedByDiscordId String
  enabled          Boolean   @default(true)
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt
  deletedAt        DateTime?

  server FivemServer @relation(fields: [serverId], references: [id])

  @@unique([serverId, targetIdentifier])
  @@index([guildId, enabled])
  @@map("fivem_whitelist")
}

model FivemAuditLog {
  id             String   @id @default(cuid())
  guildId        String
  serverId       String?
  action         String   // e.g. "restart", "execute", "ban"
  actorDiscordId String
  metadata       Json     // redacted of secrets
  createdAt      DateTime @default(now())

  @@index([guildId, action])
  @@index([guildId, createdAt])
  @@map("fivem_audit_logs")
}
```

> Soft-delete: `FivemServer`, `FivemPunishment`, `FivemBan`, `FivemWhitelist`, `FivemPlayerLink` history are retained; repositories filter `deletedAt: null` by default. `FivemAuditLog` is append-only (no deletes).

---

## 10. API

All endpoints are under `/api/v1/guilds/:guildId/fivem`, guarded by auth + per-claim permission guards, documented with Swagger. List endpoints paginate. Responses go through DTO serializers that strip secrets.

| Method | Path | Permission | Body / Query (DTO) | Notes |
|--------|------|------------|--------------------|-------|
| `GET` | `/servers` | `fivem.view` | — | List registered servers (no secrets). |
| `POST` | `/servers` | `fivem.admin` | `RegisterServerDto` | Credentials encrypted on write. |
| `PATCH` | `/servers/:serverId/credentials` | `fivem.admin` | `RotateCredentialDto` | Write-only secret rotation. |
| `GET` | `/servers/:serverId/status` | `fivem.view` | — | Cached `ServerStatusDto`. |
| `POST` | `/servers/:serverId/restart` | `fivem.restart` | `RestartDto` | Audited; optional `scheduleAt`. |
| `POST` | `/servers/:serverId/execute` | `fivem.execute` | `ExecuteCommandDto` | Blocklist-checked; audited. |
| `POST` | `/servers/:serverId/broadcast` | `fivem.broadcast` | `BroadcastDto` | In-game message. |
| `GET` | `/servers/:serverId/players` | `fivem.players.view` | `PaginationDto` | Online player list (cached). |
| `GET` | `/servers/:serverId/staff` | `fivem.players.view` | — | Online staff (filtered by `staffJobs`). |
| `GET` | `/servers/:serverId/players/lookup` | `fivem.lookup` | `PlayerLookupDto` | By steam/discord/license. |
| `GET` | `/servers/:serverId/players/:linkId/character` | `fivem.lookup` | — | `CharacterDto`. |
| `GET` | `/servers/:serverId/players/:linkId/economy` | `fivem.economy.view` | — | `EconomyDto` (cached). |
| `GET` | `/servers/:serverId/players/:linkId/vehicles` | `fivem.lookup` | — | `VehicleDto[]`. |
| `GET` | `/servers/:serverId/players/:linkId/mdt` | `fivem.mdt.view` | — | Aggregated record (punishments + bans + character). |
| `POST` | `/servers/:serverId/punishments` | `fivem.warn` / `fivem.kick` / `fivem.ban` | `PunishmentDto` | Permission depends on `type`. |
| `DELETE` | `/servers/:serverId/bans/:banId` | `fivem.unban` | — | Lifts ban + syncs. |
| `GET` | `/servers/:serverId/whitelist` | `fivem.whitelist.view` | `PaginationDto` | — |
| `POST` | `/servers/:serverId/whitelist` | `fivem.whitelist.manage` | `WhitelistDto` | — |

```typescript
// dto/execute-command.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';

export class ExecuteCommandDto {
  @ApiProperty({ example: 'refresh', description: 'Raw console/RCON command. Blocklist-enforced.' })
  @IsString() @MinLength(1) @MaxLength(512)
  readonly command!: string;
}

// dto/punishment.dto.ts
export class PunishmentDto {
  @ApiProperty({ enum: ['warn', 'kick', 'ban'] })
  @IsString() readonly type!: 'warn' | 'kick' | 'ban';

  @ApiProperty({ example: 'steam:110000112345678 | discord:123 | license:abcd' })
  @IsString() @MinLength(1) readonly targetIdentifier!: string;

  @ApiProperty() @IsString() @MinLength(3) @MaxLength(512)
  readonly reason!: string;

  @ApiProperty({ required: false, description: 'ISO date; omit for permanent (ban only).' })
  readonly expiresAt?: string;
}
```

> **WS**: the dashboard subscribes to `ws /api/v1/guilds/:guildId/fivem/stream` which relays `fivem.status.changed` and `fivem.player.punished` events (permission `fivem.view`) for live status tiles.

---

## 11. Permissions

Wildcard claims under the `fivem.*` namespace. Groups/roles/inheritance handled by the core permission system; this module only **defines** the claims.

```typescript
export const FIVEM_PERMISSIONS = {
  VIEW:             'fivem.view',
  PLAYERS_VIEW:     'fivem.players.view',
  LOOKUP:           'fivem.lookup',
  ECONOMY_VIEW:     'fivem.economy.view',
  MDT_VIEW:         'fivem.mdt.view',
  WHITELIST_VIEW:   'fivem.whitelist.view',
  WHITELIST_MANAGE: 'fivem.whitelist.manage',
  WARN:             'fivem.warn',
  KICK:             'fivem.kick',
  BAN:              'fivem.ban',
  UNBAN:            'fivem.unban',
  BROADCAST:        'fivem.broadcast',
  // DANGEROUS — must be granted explicitly, never via a broad wildcard by default
  RESTART:          'fivem.restart',
  EXECUTE:          'fivem.execute',
  ADMIN:            'fivem.admin', // register servers, rotate credentials
} as const;
```

- `fivem.*` grants everything (super-admin). Dashboard SHOULD warn before granting `fivem.execute`, `fivem.restart`, `fivem.admin`.
- Dangerous actions (`restart`, `execute`, `ban`, `admin`) require the **exact** claim or `fivem.*` — they are intentionally excluded from any "staff bundle" default.
- Every denied dangerous action is logged (`fivem.permission.denied`) with actor + claim.

---

## 12. Logging

Structured Pino logs, namespaced `fivem`. Categories:

| Category | Level | When |
|----------|-------|------|
| `fivem.adapter.call` | debug | Every adapter operation (op, transport, latencyMs) — **secrets redacted**. |
| `fivem.adapter.error` | warn/error | Adapter timeout, circuit open, transport failure. |
| `fivem.command.executed` | info | Console/RCON execute (command string redacted of blocklisted tokens). |
| `fivem.server.restarted` | warn | Restart triggered (actor, reason, scheduled). |
| `fivem.player.punished` | info | warn/kick/ban created. |
| `fivem.ban.synced` | info | Ban propagated in either direction. |
| `fivem.permission.denied` | warn | Dangerous action blocked by permissions. |
| `fivem.event.invalid` | warn | Malformed consumed event dropped. |

**Redaction**: a Pino redaction path list strips `secret`, `encryptedSecret`, `password`, `token`, `hmacKey`, and any `connection.secret`. Adapter clients pass credentials by reference only at call time and never include them in log objects.

**Audit hooks**: every mutating action writes a `FivemAuditLog` row (action, actorDiscordId, redacted metadata) in the same transaction as the state change, and emits the matching event.

---

## 13. Testing

Vitest for unit/integration, Playwright for dashboard e2e. Coverage targets: domain/application ≥ 90%, adapters ≥ 80%.

**Unit**
- `FivemIdentifier` VO: parses all identifier kinds; rejects malformed input.
- `FivemIdentityResolver`: resolves discord↔steam↔license; cache hit/miss paths.
- `FivemPunishmentPolicy`: enforces permission-by-type, expiry math, blocklist on execute.
- Each adapter: capability set correctness; `UnsupportedFivemOperationError` for unsupported ops; response parsing with fixtures.
- `ResilientFivemAdapter`: timeout, retry-on-idempotent-only, circuit breaker open/half-open/close.
- Redaction: no secret ever appears in serialized log/DTO objects (golden test).

**Integration**
- Repositories against a test MySQL (Testcontainers): soft-delete filters, unique constraints, index-backed lookups.
- Event handlers: `moderation.member.banned` → `FivemBan` created + `fivem.ban.synced` emitted; malformed payload dropped.
- Jobs: `status-poll` writes cache + emits `fivem.status.changed` only on change; `scheduled-restart` enqueues with delay and is idempotent.
- txAdmin/RCON adapters against mock servers (nock for HTTP, a stub UDP server for RCON).

**E2E (Playwright)**
- Dashboard: register server, status tile updates over WS, restart blocked without `fivem.restart`, restart succeeds with it (mock adapter), audit row appears.

---

## 14. Dashboard Integration

The dashboard surfaces, gated by the same claims:

- **Server cards**: live status (online/players/queue/uptime) via WS stream; per-server enable toggle.
- **Player explorer**: searchable, paginated online list + lookup by Steam/Discord/license; player drawer with character, economy (if `fivem.economy.view`), vehicles, and **MDT** tab (punishment + ban history).
- **Console panel** (`fivem.execute`): command input with blocklist hints; output stream; full audit trail.
- **Restart controls** (`fivem.restart`): immediate + scheduled, with announce countdown config.
- **Moderation**: punishment composer (warn/kick/ban), ban list with unban, ban-sync toggles.
- **Whitelist manager** (`fivem.whitelist.*`): add/remove, paginated.
- **Server admin** (`fivem.admin`): register servers, rotate credentials (write-only fields, never displays stored secret), capability matrix per transport.
- **Audit log viewer**: filterable by action/actor/date.

All labels/embeds use the i18n `fivem.*` namespace (PT/EN).

---

## 15. Future Extensions

- **Additional adapters**: VORP/QBox/ESX-specific economy resources; OneSync metadata; Discord-to-game role sync resource.
- **Live map**: stream player coordinates from an in-game resource for a dashboard mini-map.
- **Automated anti-cheat hooks**: consume in-game cheat-detection events and auto-punish via policy.
- **Cross-server ban federation**: share bans across a network of guilds (opt-in, signed).
- **Scheduled restart calendars** with maintenance windows and player-count guards.
- **Economy analytics**: time-series of cash/bank totals to Prometheus/Grafana.
- **In-game ticket bridge**: integrate with the tickets module via events.

---

## 16. Tasks for Claude

> Build in order. Each phase ends with a green build, lint clean, and a focused commit (Conventional Commits, feature branch `feature/fivem/<phase>`).

**Phase 1 — Schema & config**
1. Add Prisma models (§9), enums, indexes. Create the migration.
2. Implement `fivem.config.ts` Zod schemas (global + per-server). Wire into core config (ENV → DB → defaults).
3. Define `fivem.permissions.ts` claims and register them with the permission system.

**Phase 2 — Adapter sub-architecture**
4. Implement `FivemAdapter` abstract, `FivemCapabilitySet`, `UnsupportedFivemOperationError`, identifier VO.
5. Implement `TxAdminAdapter`, `RconAdapter`, `InGameHttpAdapter` + their thin clients.
6. Implement `ResilientFivemAdapter` decorator (timeout/retry/breaker/metrics/OTel) and `FivemAdapterFactory` (pull + decrypt via SecretsService).

**Phase 3 — Repositories & domain**
7. Implement all repositories (soft-delete aware, paginated). Prisma only here.
8. Implement `FivemIdentityResolver`, `FivemPunishmentPolicy`, `BanSyncCoordinator`.

**Phase 4 — Application services**
9. `FivemServerService`, `FivemPlayerService`, `FivemModerationService`, `FivemAdminService`. Use cache layer, emit events, write audit rows.

**Phase 5 — Events & jobs**
10. Event constants/types + `OnMemberBanned/Unbanned` handlers (Zod-validated boundary).
11. BullMQ jobs: `status-poll`, `ban-sync-sweep`, `scheduled-restart` (retries + DLQ).

**Phase 6 — Commands (Necord)**
12. Slash commands (see §17 for syntax), permission-gated, i18n output. `/fivem-restart` and `/fivem-execute` require confirmation buttons.

**Phase 7 — Dashboard & API**
13. Controllers + DTOs + Swagger + serializers (strip secrets). WS stream.
14. Dashboard pages (§14).

**Phase 8 — Tests & docs**
15. Unit + integration + e2e per §13. i18n PT/EN files. Update module README. Open PR.

---

## 17. Acceptance Criteria

Slash command surface (examples):

- `/fivem-status [server]` → cached status embed (online, players/max, queue, uptime).
- `/fivem-players [server]` → paginated online list; `/fivem-staff [server]` → online staff only.
- `/fivem-lookup <identifier> [server]` → resolves steam/discord/license to a player card.
- `/fivem-mdt <identifier> [server]` → punishment + ban history + character (needs `fivem.mdt.view`).
- `/fivem-restart [server] [reason] [schedule]` → blocked without `fivem.restart`; confirmation button; audited.
- `/fivem-execute <command> [server]` → blocked without `fivem.execute`; blocklist enforced; audited.
- `/fivem-punish <type> <identifier> <reason> [duration] [server]` → claim-by-type enforced.
- `/fivem-whitelist <add|remove> <identifier> [server]` → needs `fivem.whitelist.manage`.

Checklist:

- [ ] A guild can register a txAdmin, an RCON, and an in-game-HTTP server; capabilities differ correctly per transport.
- [ ] Credentials are encrypted at rest; no endpoint, log, DTO, or cache entry ever exposes them.
- [ ] Status is cached (≤ poll interval) and never calls the server more than once per interval per server.
- [ ] Lookup resolves any identifier kind to the same canonical player link, cached.
- [ ] `fivem.restart` / `fivem.execute` / `fivem.ban` are denied without the exact claim and the denial is audited.
- [ ] `execute` blocklist prevents dangerous commands (e.g. `quit`, key leaks).
- [ ] A Discord ban with `banSync.discordToGame` on propagates to all servers and emits `fivem.ban.synced`.
- [ ] An in-game ban detected by the sweep surfaces back and emits `fivem.ban.synced` (`game_to_discord`).
- [ ] Every mutating action writes a `FivemAuditLog` row in the same transaction.
- [ ] Adapter failures degrade gracefully (circuit breaker), never crash the command, and surface a user-friendly translated error.
- [ ] All command/embed text exists in PT and EN.
- [ ] Dashboard mirrors every command with identical permission checks.

---

## 18. Definition of Done

- [ ] All 8 phases complete; layer flow respected (Controller → App → Domain → Adapter/Repo → DB).
- [ ] Prisma migration created and applies cleanly; no schema drift.
- [ ] No `any`; TypeScript strict passes. ESLint/Prettier clean; Husky/Commitlint pass.
- [ ] Unit + integration + e2e green; coverage targets met (domain/app ≥ 90%, adapters ≥ 80%).
- [ ] Secret redaction golden test passes; no secret in any log/DTO/cache.
- [ ] Prometheus metrics + OTel spans present on adapter calls; Pino categories from §12 emitted.
- [ ] Public API (`FivemPublicApi`) exported from `index.ts`; no internal service leaked.
- [ ] i18n PT + EN complete for the `fivem.*` namespace.
- [ ] Swagger docs generated for all endpoints; DTOs validated with `class-validator`/Zod at boundaries.
- [ ] Module README/docs updated; PR opened against `develop` (no direct commit to `main`), Conventional Commit title, all CI checks green.
