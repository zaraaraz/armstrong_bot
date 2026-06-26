# Audit Module

> ## Claude Instructions
> - Never modify another module. Do not change architecture decisions from `00-project.md`.
> - This module is **append-only and read-only by contract**: it NEVER mutates or deletes existing audit records, and it NEVER calls into other modules' internal services.
> - It consumes the Event Bus **globally** (wildcard subscription) — it is a passive sink. It must degrade gracefully and never block or break the emitting module.
> - Keep backwards compatibility. Create Prisma migrations. Generate tests and docs.
> - Generate DTOs. Use the Repository Pattern. Use the Event Bus. Use Dependency Injection.
> - No `any`. Keep methods small (<50 lines where reasonable). Follow existing naming.
> - Create indexes for searchable fields (guildId, actorId, action, correlationId, occurredAt). Support pagination, caching of read queries, translations of action labels, and dashboard surfacing.
> - Tamper-evidence is a hard requirement: every record carries a hash chained to its predecessor. Never recompute or rewrite the chain in place.
> - Distinguish **Audit** (immutable compliance ledger, internal + external actions) from **Logs** (Discord-facing, human-readable, mutable channel messages). Do not duplicate the Logs module's responsibilities.

---

## 1. Purpose

The Audit Module provides a **tamper-evident, append-only ledger** recording *everything the bot does* — both user-triggered actions (commands, dashboard mutations, API calls) and internal actions (job execution, config changes, permission grants, cache invalidations, system events). It answers the compliance questions **who / what / when / where / why / how**, links related actions via **correlation IDs**, and exposes a constrained **query + export API** for auditors.

It exists to satisfy enterprise compliance, incident forensics, and accountability requirements. It is deliberately separate from:

- **Logs module** — Discord-facing, channel-posted, human-friendly, configurable, *deletable* event notifications.
- **Pino application logs** — ephemeral operational telemetry for engineers and observability pipelines.

Audit records are the **system of record**. They outlive both of the above and cannot be edited.

## 2. Goals

- Capture a complete, structured record of every meaningful action across all modules without each module having to opt in individually.
- Guarantee **append-only** semantics: no updates, no hard deletes, enforced at the repository and database layers.
- Provide **tamper evidence** via a per-guild hash chain (each entry hashes its content + previous entry's hash).
- Preserve full context: actor, target, action, guild, channel, correlation ID, causation ID, before/after diffs, request metadata.
- Offer a **paginated, filterable query API** (REST + dashboard) restricted by permission claims.
- Support **retention policies** (per-guild, ENV-overridable) and **verifiable archival/export** (JSON / CSV / NDJSON) before any compaction.
- Never block, slow, or break the action being audited — ingestion is asynchronous and fault-isolated.
- Be fully guild-aware, with an explicit `GLOBAL` scope for system-wide actions.

## 3. Architecture

The module is a **global Event Bus sink** plus a constrained read/query surface. It strictly follows the layer flow from `00-project.md`:

```
Event Bus (global wildcard)  ─┐
REST Controller (read/export) ┼─> Application Service ─> Domain Service ─> Repository ─> MySQL
Dashboard (read/export)      ─┘        (AuditService)      (AuditChain,      (AuditRepo)
                                                            Retention)
```

Key decisions:

- **Ingestion path** is event-driven and asynchronous. `AuditEventConsumer` subscribes to the Event Bus with a wildcard, normalises any domain event into an `AuditEntryDraft`, and enqueues it onto a **BullMQ `audit-ingest` queue**. A worker drains the queue and persists via the repository. This decouples write throughput from emitting modules and gives retries + DLQ for durability.
- **Hash chaining** is computed inside `AuditChainService` at persist time, serialised per guild via a Redis lock (through the Cache/lock layer) so the chain has a deterministic order.
- **Read path** is synchronous: Controller -> `AuditService` -> Repository, with cached query results (short TTL) via the Cache layer.
- Controllers and consumers NEVER touch Prisma. Only `AuditRepository` does.
- The module exposes ONLY its public API (query/verify/export contracts) — other modules emit events; they never import audit internals.

## 4. Folder Structure

```
src/modules/audit/
├── audit.module.ts
├── index.ts                         # public API barrel (ONLY exported surface)
├── application/
│   ├── audit.service.ts             # query, verify, export orchestration
│   ├── audit-ingest.service.ts      # draft normalisation + enqueue
│   └── dto/
│       ├── query-audit.dto.ts
│       ├── audit-entry.dto.ts
│       ├── export-audit.dto.ts
│       └── verify-chain.dto.ts
├── domain/
│   ├── audit-chain.service.ts       # hash computation + chain verification
│   ├── retention.service.ts         # policy evaluation + archival
│   ├── audit-action.enum.ts
│   ├── audit-scope.enum.ts
│   └── audit-entry.model.ts         # domain model (not Prisma)
├── infrastructure/
│   ├── audit.repository.ts          # ONLY Prisma access here
│   ├── audit.repository.interface.ts
│   └── audit-export.writer.ts       # streaming JSON/CSV/NDJSON serialisers
├── events/
│   ├── audit-event.consumer.ts      # global wildcard subscriber
│   └── audit.events.ts              # events this module emits
├── jobs/
│   ├── audit-ingest.processor.ts    # BullMQ worker: drains audit-ingest
│   └── audit-retention.processor.ts # scheduled retention/archival job
├── api/
│   └── audit.controller.ts          # REST read/verify/export endpoints
├── config/
│   └── audit.config.ts              # Zod schema + defaults
└── audit.constants.ts               # queue names, cache namespaces, claim ids
```

## 5. Public Interfaces

Real, strict TypeScript. These are the ONLY surfaces other parts of the system may depend on (re-exported from `index.ts`).

```typescript
import type { Pagination, Page } from '../../shared/pagination';

/** Scope of an audited action. */
export enum AuditScope {
  Guild = 'GUILD',
  Global = 'GLOBAL',
}

/** Origin channel through which the action entered the system. */
export enum AuditSource {
  Command = 'COMMAND',
  Dashboard = 'DASHBOARD',
  Api = 'API',
  Job = 'JOB',
  System = 'SYSTEM',
  Event = 'EVENT',
}

/** Immutable draft handed to the ingest pipeline. No id/hash yet. */
export interface AuditEntryDraft {
  readonly scope: AuditScope;
  readonly guildId: string | null;        // null only when scope === Global
  readonly action: string;                 // e.g. "tickets.ticket.closed"
  readonly source: AuditSource;
  readonly actorId: string | null;         // Discord user id, or null for SYSTEM
  readonly actorType: 'USER' | 'SYSTEM' | 'BOT';
  readonly targetType: string | null;      // e.g. "ticket", "member", "config"
  readonly targetId: string | null;
  readonly channelId: string | null;       // Discord channel where it happened
  readonly correlationId: string;          // groups a logical operation
  readonly causationId: string | null;     // the entry that caused this one
  readonly summary: string;                // short, translatable label key
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly before: Readonly<Record<string, unknown>> | null;
  readonly after: Readonly<Record<string, unknown>> | null;
  readonly occurredAt: Date;
}

/** A persisted, hash-chained, immutable audit record. */
export interface AuditEntry extends AuditEntryDraft {
  readonly id: string;
  readonly seq: bigint;                    // monotonic per guild scope
  readonly previousHash: string | null;
  readonly hash: string;                   // sha256 of canonical content + previousHash
  readonly createdAt: Date;
}

export interface AuditQuery {
  readonly guildId?: string;
  readonly scope?: AuditScope;
  readonly actorId?: string;
  readonly action?: string;                // exact or prefix (e.g. "tickets.")
  readonly targetType?: string;
  readonly targetId?: string;
  readonly correlationId?: string;
  readonly source?: AuditSource;
  readonly from?: Date;
  readonly to?: Date;
  readonly pagination: Pagination;
}

export interface ChainVerificationResult {
  readonly guildId: string | null;
  readonly scope: AuditScope;
  readonly checked: number;
  readonly valid: boolean;
  readonly firstBrokenSeq: bigint | null;  // null when valid
  readonly verifiedAt: Date;
}

export type AuditExportFormat = 'json' | 'ndjson' | 'csv';

/** Public application service contract. */
export abstract class AuditPublicApi {
  abstract record(draft: AuditEntryDraft): Promise<void>;        // enqueue only
  abstract query(query: AuditQuery): Promise<Page<AuditEntry>>;
  abstract getByCorrelation(correlationId: string): Promise<readonly AuditEntry[]>;
  abstract verifyChain(scope: AuditScope, guildId: string | null): Promise<ChainVerificationResult>;
  abstract export(query: AuditQuery, format: AuditExportFormat): Promise<NodeJS.ReadableStream>;
}

/** Repository contract — ONLY implementation touches Prisma. */
export interface IAuditRepository {
  append(draft: AuditEntryDraft, seq: bigint, previousHash: string | null, hash: string): Promise<AuditEntry>;
  findLast(scope: AuditScope, guildId: string | null): Promise<AuditEntry | null>;
  find(query: AuditQuery): Promise<Page<AuditEntry>>;
  findByCorrelation(correlationId: string): Promise<readonly AuditEntry[]>;
  streamForExport(query: AuditQuery): AsyncIterable<AuditEntry>;
  iterateChain(scope: AuditScope, guildId: string | null): AsyncIterable<AuditEntry>;
  countOlderThan(cutoff: Date): Promise<number>;
}
```

## 6. Events

The Audit Module **consumes the Event Bus globally** and emits a small set of its own events.

### Consumed (wildcard)

```typescript
// audit-event.consumer.ts subscribes to "**" (all events).
// Every event on the bus is normalised into an AuditEntryDraft.
interface BusEnvelope<T = unknown> {
  readonly name: string;               // e.g. "permissions.role.granted"
  readonly guildId: string | null;
  readonly correlationId: string;      // propagated from origin
  readonly causationId: string | null;
  readonly actorId: string | null;
  readonly source: AuditSource;
  readonly occurredAt: string;         // ISO-8601
  readonly payload: Readonly<T>;
}
```

Mapping rules: `name` -> `action`; payload `before`/`after` keys (if present) become diffs; everything else lands in `metadata`. Events explicitly flagged `audit: false` in their envelope (transient/high-volume noise such as heartbeat ticks) are skipped via an allow/deny list in config.

### Emitted

```typescript
export const AuditEvents = {
  EntryRecorded: 'audit.entry.recorded',
  ChainVerified: 'audit.chain.verified',
  ChainBroken: 'audit.chain.broken',       // critical — fans out to alerting
  RetentionArchived: 'audit.retention.archived',
  ExportRequested: 'audit.export.requested',
} as const;

interface ChainBrokenPayload {
  readonly scope: AuditScope;
  readonly guildId: string | null;
  readonly expectedHash: string;
  readonly actualHash: string;
  readonly seq: string;                    // bigint serialised
  readonly detectedAt: string;
}
```

`audit.entry.recorded` is **not** re-audited (guarded against recursion via the deny list) to prevent an infinite loop.

## 7. Dependencies

Relies ONLY on CORE systems — never on another module directly.

| Core system | Usage |
|-------------|-------|
| **Event Bus** | Global wildcard subscription (ingestion) + emitting audit's own events. |
| **Queue (BullMQ)** | `audit-ingest` queue (async persist, retries, DLQ); `audit-retention` recurring job. |
| **Database (Prisma/MySQL)** | Via `AuditRepository` only. |
| **Cache** | Short-TTL caching of read queries; distributed lock for per-guild chain serialisation. Never touches Redis directly. |
| **Permissions** | Guards on the query/verify/export controller and dashboard. |
| **Config** | Zod-validated retention + ingestion settings (ENV -> DB -> defaults). |
| **i18n** | Translating `summary`/action labels for dashboard display (PT primary, EN secondary). |
| **Logging (Pino)** | Operational telemetry of the audit pipeline itself (not a substitute for the ledger). |

Crucially, audit holds **no dependency on the modules whose events it records** — it learns about them solely through the bus envelope.

## 8. Configuration

Guild-scoped and global settings, Zod-validated, with defaults. Priority ENV -> Database -> Defaults.

```typescript
import { z } from 'zod';

export const AuditConfigSchema = z.object({
  // Ingestion
  ingestEnabled: z.boolean().default(true),
  ingestConcurrency: z.number().int().min(1).max(50).default(4),
  denyActionPrefixes: z.array(z.string()).default([
    'audit.entry.recorded',
    'system.heartbeat',
    'cache.hit',
  ]),
  redactMetadataKeys: z.array(z.string()).default(['password', 'token', 'secret', 'authorization']),

  // Tamper evidence
  hashAlgorithm: z.enum(['sha256', 'sha512']).default('sha256'),

  // Retention (guild-scoped overridable)
  retentionDays: z.number().int().min(30).max(3650).default(365),
  archiveBeforeDelete: z.boolean().default(true),
  archiveFormat: z.enum(['json', 'ndjson', 'csv']).default('ndjson'),

  // Query
  maxPageSize: z.number().int().min(1).max(500).default(100),
  queryCacheTtlSeconds: z.number().int().min(0).max(300).default(15),
});

export type AuditConfig = z.infer<typeof AuditConfigSchema>;
```

`retentionDays`, `archiveBeforeDelete`, and `denyActionPrefixes` are resolvable per guild; `hashAlgorithm` and `ingestConcurrency` are global only. ENV keys are prefixed `AUDIT_` (e.g. `AUDIT_RETENTION_DAYS`).

## 9. Database

Prisma models. The ledger is **append-only** and **never soft-deleted via flags** during its retention window — rows are only removed by the retention job *after* verified archival. There is intentionally **no `updatedAt`** on `AuditEntry` because rows are immutable.

```prisma
enum AuditScope {
  GUILD
  GLOBAL
}

enum AuditSource {
  COMMAND
  DASHBOARD
  API
  JOB
  SYSTEM
  EVENT
}

enum AuditActorType {
  USER
  SYSTEM
  BOT
}

model AuditEntry {
  id            String          @id @default(cuid())
  scope         AuditScope
  guildId       String?         // null when scope = GLOBAL
  seq           BigInt          // monotonic within (scope, guildId)
  action        String          @db.VarChar(191)
  source        AuditSource
  actorId       String?         @db.VarChar(32)
  actorType     AuditActorType
  targetType    String?         @db.VarChar(64)
  targetId      String?         @db.VarChar(191)
  channelId     String?         @db.VarChar(32)
  correlationId String          @db.VarChar(64)
  causationId   String?         @db.VarChar(64)
  summary       String          @db.VarChar(255)
  metadata      Json
  before        Json?
  after         Json?
  previousHash  String?         @db.Char(128)
  hash          String          @db.Char(128)
  occurredAt    DateTime
  createdAt     DateTime        @default(now())

  @@unique([scope, guildId, seq])
  @@unique([hash])
  @@index([guildId, occurredAt])
  @@index([guildId, action])
  @@index([actorId])
  @@index([correlationId])
  @@index([targetType, targetId])
  @@map("audit_entries")
}

model AuditArchive {
  id          String   @id @default(cuid())
  scope       AuditScope
  guildId     String?
  format      String   @db.VarChar(16)
  fromSeq     BigInt
  toSeq       BigInt
  entryCount  Int
  byteSize    Int
  storageRef  String   @db.VarChar(512)   // object-store key / path
  rootHash    String   @db.Char(128)      // hash of last archived entry (chain anchor)
  createdAt   DateTime @default(now())

  @@index([guildId, createdAt])
  @@map("audit_archives")
}
```

The `(scope, guildId, seq)` unique constraint plus the unique `hash` enforce ordering and detect duplicate/replayed inserts at the DB level. `metadata` is stored redacted (per `redactMetadataKeys`) before persist.

## 10. API

REST under `/api/v1/audit`. All endpoints are read-only or export-only; there is **no create/update/delete endpoint** by design (creation happens via the bus). Swagger-documented, permission-guarded, guild-scoped via path.

```typescript
class QueryAuditDto {
  scope?: AuditScope;
  actorId?: string;
  action?: string;          // exact or "prefix." match
  targetType?: string;
  targetId?: string;
  correlationId?: string;
  source?: AuditSource;
  from?: string;            // ISO-8601
  to?: string;
  page?: number;            // default 1
  pageSize?: number;        // default 25, max = config.maxPageSize
}

class AuditEntryResponseDto {
  id!: string;
  seq!: string;             // bigint serialised
  action!: string;
  source!: AuditSource;
  actorId!: string | null;
  actorType!: AuditActorType;
  target!: { type: string | null; id: string | null };
  channelId!: string | null;
  correlationId!: string;
  causationId!: string | null;
  summary!: string;
  metadata!: Record<string, unknown>;
  before!: Record<string, unknown> | null;
  after!: Record<string, unknown> | null;
  hash!: string;
  occurredAt!: string;
}
```

| Method | Path | Body / Query | Permission | Notes |
|--------|------|--------------|------------|-------|
| GET | `/api/v1/guilds/:guildId/audit` | `QueryAuditDto` | `audit.read` | Paginated, cached (TTL from config). |
| GET | `/api/v1/guilds/:guildId/audit/correlations/:correlationId` | — | `audit.read` | Full ordered trace of one operation. |
| GET | `/api/v1/guilds/:guildId/audit/verify` | — | `audit.verify` | Returns `ChainVerificationResult`. |
| POST | `/api/v1/guilds/:guildId/audit/export` | `ExportAuditDto` | `audit.export` | Streams file (`json`/`ndjson`/`csv`); emits `audit.export.requested`. |
| GET | `/api/v1/audit/global` | `QueryAuditDto` | `audit.read.global` | GLOBAL-scope entries (system actions). |

Export streams use chunked transfer; large result sets are never buffered fully in memory.

## 11. Permissions

Wildcard-compatible claims defined by this module:

- `audit.read` — query guild-scoped audit entries.
- `audit.read.global` — query GLOBAL-scope (system) entries.
- `audit.verify` — run chain verification.
- `audit.export` — export/download audit data.
- `audit.retention.manage` — change retention policy (dashboard/config).
- `audit.*` — full audit access (grants all above).

No claim grants the ability to create, edit, or delete entries — that capability does not exist by design.

## 12. Logging

The module logs its own *operational* telemetry via Pino (category `audit`), distinct from the ledger it maintains:

- `audit.ingest` — draft enqueued, persisted, redaction applied, deny-listed skip.
- `audit.chain` — hash computed, verification run + result.
- `audit.chain.broken` — **error level**; also emits `audit.chain.broken` event for alerting/Prometheus.
- `audit.retention` — entries archived/pruned, with counts and seq ranges.
- `audit.export` — who exported what (this is itself recorded as an `AuditEntry`: action `audit.export.performed`).

Audit hooks: query, verify, and export actions are themselves audited (meta-audit) so reads of the ledger are accountable. OpenTelemetry spans wrap ingest persist and export streaming; the `correlationId` is propagated as a span attribute.

## 13. Testing

- **Unit** (`Vitest`):
  - `AuditChainService` — hash determinism, chain linkage, tamper detection (mutate a record -> verification fails at correct seq).
  - `AuditIngestService` — envelope -> draft normalisation, redaction of sensitive keys, deny-list filtering, recursion guard for `audit.entry.recorded`.
  - `RetentionService` — cutoff computation, archive-before-delete ordering, per-guild override resolution.
- **Integration**:
  - `AuditRepository` against a test MySQL — `(scope,guildId,seq)` uniqueness, monotonic seq under concurrent appends (lock correctness), pagination + index usage.
  - Ingest worker draining `audit-ingest` with retries and DLQ on persist failure.
- **E2E** (`Playwright` / Nest e2e):
  - Trigger a real command -> assert a corresponding `AuditEntry` appears with correct correlationId.
  - `GET /audit` permission enforcement (403 without `audit.read`).
  - Export endpoint streams valid NDJSON whose entries re-verify.
- **Property test**: appending N random entries then verifying the chain always passes; flipping any byte fails.
- Coverage target: ≥ 90% on `domain/` and `application/`.

## 14. Dashboard Integration

The dashboard exposes (read-only, gated by claims):

- **Audit Explorer** — filterable, paginated table (actor, action, target, time, source) with translated action labels (i18n). Click a row to expand `before`/`after` diff.
- **Correlation Trace** — timeline view grouping all entries sharing a `correlationId`.
- **Chain Integrity** widget — green/red badge showing last `verifyChain` result; "Verify now" button (`audit.verify`).
- **Export** dialog — choose filters + format, triggers `/audit/export`.
- **Retention Settings** — per-guild `retentionDays` / archive toggle (`audit.retention.manage`).

The dashboard never mutates entries; it only reads, verifies, exports, and configures retention.

## 15. Future Extensions

- **Merkle-tree anchoring** — periodically publish the chain's root hash to an external immutable store (or blockchain) for third-party-verifiable tamper evidence.
- **Cryptographic signing** — sign each batch with a rotating key (KMS) in addition to hashing.
- **SIEM streaming** — push entries to external SIEM (Splunk/ELK) via a sink adapter.
- **Anomaly detection** — flag unusual actor/action patterns (e.g. mass deletions) and raise events.
- **Object-store archival** — pluggable S3/GCS backends for `AuditArchive.storageRef`.
- **GDPR subject access / erasure-aware redaction** within compliance constraints (redaction-on-export, never in-place edit).

## 16. Tasks for Claude

1. **Schema** — add `AuditEntry`, `AuditArchive`, and enums to Prisma; generate migration; add all indexes/constraints.
2. **Config** — implement `AuditConfigSchema` (Zod) with ENV/DB/defaults resolution; wire guild overrides.
3. **Repository** — implement `IAuditRepository` (`append`, `findLast`, `find`, `findByCorrelation`, `streamForExport`, `iterateChain`, `countOlderThan`). Prisma only here.
4. **Domain** — implement `AuditChainService` (hash + verify) and `RetentionService`; add canonical-JSON serialisation for hashing.
5. **Application** — implement `AuditService` (query/verify/export) and `AuditIngestService` (normalise + redact + enqueue), behind `AuditPublicApi`.
6. **Events** — implement `AuditEventConsumer` (wildcard subscribe, deny-list, recursion guard); define emitted `AuditEvents`.
7. **Jobs** — implement `audit-ingest.processor` (drain + persist with chain lock) and `audit-retention.processor` (archive-then-prune, recurring).
8. **Commands** — N/A as primary surface; ensure command-originated events carry `source = COMMAND` and correlationId.
9. **Dashboard** — expose Audit Explorer, Correlation Trace, Chain Integrity, Export, Retention Settings.
10. **API** — implement `AuditController` endpoints + DTOs + Swagger; apply permission guards.
11. **Tests** — unit, integration, e2e, property tests per section 13.
12. **Docs** — update module README and ensure `index.ts` exports only the public API.

## 17. Acceptance Criteria

- Every event on the bus (except deny-listed) results in exactly one `AuditEntry`, asynchronously, without blocking the emitter.
- Entries are immutable: no code path updates or hard-deletes an entry outside the retention job.
- `seq` is strictly monotonic per `(scope, guildId)` even under concurrent ingestion.
- Each entry's `hash` correctly chains to `previousHash`; `verifyChain` returns `valid: true` for an untampered chain and pinpoints `firstBrokenSeq` on tampering.
- Sensitive metadata keys are redacted before persist.
- `GET /audit` is paginated, filterable, cached, and rejects callers lacking `audit.read`.
- Export streams valid `json`/`ndjson`/`csv`; exported entries re-verify against their hashes.
- Retention job archives before pruning when `archiveBeforeDelete` is true and records an `AuditArchive` row.
- Read/verify/export actions are themselves audited (meta-audit).
- `audit.entry.recorded` never triggers a recursive audit entry.

## 18. Definition of Done

- All Vitest unit + integration tests pass; e2e suite green; coverage ≥ 90% on domain/application.
- Prisma migration created, applied cleanly, and reversible-checked.
- ESLint/Prettier clean; no `any`; Commitlint-valid Conventional Commits.
- Swagger/OpenAPI documents all endpoints + DTOs; i18n keys added for action labels (PT + EN).
- `index.ts` exports only the public API; no module imports audit internals.
- Prometheus metrics + OpenTelemetry spans for ingest/verify/export emitted.
- Docs (this file + module README) updated; PR opened against `develop` (never direct to `main`) with passing CI.
