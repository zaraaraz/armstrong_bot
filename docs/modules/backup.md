# Backup Module

> ## Claude Instructions
> - Never modify another module. Do not change architecture decisions from `00-project.md`.
> - This module NEVER persists bytes itself — it MUST delegate all blob persistence to the **Storage** module via its published `StoragePort` contract. No direct filesystem / S3 access.
> - This module NEVER touches Redis or BullMQ directly. Scheduling goes through the **Queue** core abstraction; reads/writes of hot state go through the **Cache** layer.
> - Controllers NEVER touch Prisma. Only `BackupRepository` / `RestoreRepository` touch Prisma.
> - Keep backwards compatibility. Create Prisma migrations for every schema change. Generate tests and docs.
> - Generate DTOs (Zod-validated). Use the Repository Pattern, the Event Bus and Dependency Injection.
> - No `any`. Keep methods small (<50 lines where reasonable). Follow existing naming conventions.
> - Create indexes for searchable fields (`guildId`, `status`, `kind`, `createdAt`). Support pagination, caching, translations and dashboard surfaces.
> - Backups may contain secrets — encryption is mandatory and key material MUST come from the Secret Management layer, never inline.

---

## 1. Purpose

The Backup Module is the enterprise data-resilience unit of Ghost Bot. It produces, encrypts, stores, lists, restores and exports **point-in-time snapshots** of guild and platform state so that a guild owner — or a platform operator — can recover from accidental deletion, misconfiguration, corruption, or migrate state between environments.

It covers two distinct backup planes:

- **Per-guild config backups** — a logical, portable export of a single guild's settings, permission groups, translations overrides, module config, tickets templates, etc. These are the unit a guild owner downloads, restores or migrates.
- **Full DB snapshots** — operator-level, cross-guild logical dumps of selected Prisma models, used for disaster recovery and environment seeding.

Every artifact is **versioned**, **retention-governed**, **encrypted at rest** and **persisted exclusively through the Storage module contract**. Scheduling is handled by BullMQ via the Queue core abstraction. The module is fully guild-aware, multi-language and dashboard-driven.

## 2. Goals

- Provide **automatic scheduled backups** (cron-style, per-guild and global) and **manual on-demand** backups.
- Provide **deterministic restore** with dry-run, conflict strategy and selective scope.
- Provide **import/export** of portable, signed, encrypted backup bundles (`.ghostbak`).
- Treat snapshots as an **append-only, versioned timeline** per guild with a configurable **retention policy** (count + age based).
- Guarantee **encryption** (AES-256-GCM) of every artifact, with keys sourced from Secret Management and per-artifact data-encryption-key wrapping.
- Never store bytes directly: always go through the **Storage** module `StoragePort`.
- Be safe under multi-guild concurrency: a backup or restore for guild A never blocks or corrupts guild B.
- Emit a complete, traceable event + audit trail for every lifecycle transition.
- Keep restore **idempotent** and **transactional** where the target supports it.

## 3. Architecture

The module follows the strict layer flow defined in `00-project.md`:

```
Discord Command / REST Controller / Dashboard
        ↓
BackupApplicationService / RestoreApplicationService   (orchestration, transactions, events)
        ↓
BackupDomainService          (snapshot composition, versioning, retention rules)
EncryptionDomainService      (envelope encryption, integrity, manifest signing)
        ↓
BackupRepository / RestoreRepository   (the ONLY Prisma touch points)
        ↓
MySQL (metadata)        Storage module (blob bytes)        Queue (BullMQ jobs)
```

Key design points:

- **Metadata vs. bytes split.** Prisma stores only *metadata* (who/when/what/size/checksum/storage key). The actual encrypted blob lives wherever the Storage module decides (local, S3, GCS) — the Backup Module only holds a `storageKey`.
- **Producer/Consumer separation.** `BackupApplicationService` enqueues a job; a BullMQ worker (`backup.run` processor) executes the heavy snapshot work off the request path. Manual API calls return a `jobId` and a `pending` backup record immediately.
- **Snapshot composition is pluggable.** Each module may register a `BackupContributor` (public contract) describing which of *its* data belongs in a per-guild backup. The Backup Module never reaches into another module's internal services — contributors are resolved via the Event Bus / a published contributor registry.
- **Envelope encryption.** A random data encryption key (DEK) encrypts the blob; the DEK is wrapped by a key encryption key (KEK) resolved from Secret Management. The wrapped DEK is stored in the manifest, never the KEK.

## 4. Folder Structure

```
src/modules/backup/
├── backup.module.ts
├── application/
│   ├── backup-application.service.ts
│   ├── restore-application.service.ts
│   ├── import-export.service.ts
│   └── retention.service.ts
├── domain/
│   ├── backup-domain.service.ts
│   ├── encryption-domain.service.ts
│   ├── snapshot-composer.ts
│   ├── entities/
│   │   ├── backup.entity.ts
│   │   ├── backup-manifest.ts
│   │   └── restore-job.entity.ts
│   └── value-objects/
│       ├── backup-kind.vo.ts
│       ├── backup-status.vo.ts
│       └── retention-policy.vo.ts
├── infrastructure/
│   ├── backup.repository.ts
│   ├── restore.repository.ts
│   └── contributor.registry.ts
├── interface/
│   ├── controllers/
│   │   ├── backup.controller.ts          # REST
│   │   └── backup.commands.ts            # Necord slash commands
│   ├── dto/
│   │   ├── create-backup.dto.ts
│   │   ├── restore-backup.dto.ts
│   │   ├── list-backups.query.dto.ts
│   │   ├── import-backup.dto.ts
│   │   └── backup.response.dto.ts
│   └── jobs/
│       ├── backup-run.processor.ts
│       ├── backup-schedule.processor.ts
│       └── retention-sweep.processor.ts
├── contracts/                            # PUBLIC API of this module
│   ├── backup.contract.ts
│   ├── backup-contributor.contract.ts
│   └── backup.events.ts
├── validators/
│   └── backup.zod.ts
└── tests/
    ├── backup-application.service.spec.ts
    ├── restore-application.service.spec.ts
    ├── encryption-domain.service.spec.ts
    ├── retention.service.spec.ts
    └── backup.e2e-spec.ts
```

## 5. Public Interfaces

Real strict TypeScript exposed by `contracts/`. No `any`.

```typescript
// contracts/backup.contract.ts

export type BackupKind = 'guild_config' | 'full_db' | 'module_data';
export type BackupTrigger = 'manual' | 'scheduled' | 'pre_restore' | 'migration';
export type BackupStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'deleted';

export interface BackupMetadata {
  readonly id: string;
  readonly guildId: string | null; // null = global / full_db
  readonly kind: BackupKind;
  readonly trigger: BackupTrigger;
  readonly status: BackupStatus;
  readonly version: number; // monotonic per (guildId, kind)
  readonly sizeBytes: number;
  readonly checksum: string; // sha256 of plaintext payload
  readonly storageKey: string; // opaque key into the Storage module
  readonly encrypted: boolean;
  readonly schemaVersion: string; // payload schema version for restore compat
  readonly createdById: string | null;
  readonly createdAt: Date;
  readonly expiresAt: Date | null;
}

export interface CreateBackupRequest {
  readonly guildId: string | null;
  readonly kind: BackupKind;
  readonly trigger: BackupTrigger;
  readonly requestedById: string | null;
  readonly scope?: ReadonlyArray<string>; // contributor keys; empty = all
  readonly note?: string;
}

export interface RestoreRequest {
  readonly backupId: string;
  readonly guildId: string; // target guild
  readonly requestedById: string;
  readonly dryRun: boolean;
  readonly conflictStrategy: 'overwrite' | 'merge' | 'skip';
  readonly scope?: ReadonlyArray<string>;
}

export interface RestoreReport {
  readonly backupId: string;
  readonly dryRun: boolean;
  readonly applied: ReadonlyArray<RestoreEntryResult>;
  readonly conflicts: ReadonlyArray<RestoreConflict>;
  readonly durationMs: number;
}

export interface RestoreEntryResult {
  readonly contributorKey: string;
  readonly created: number;
  readonly updated: number;
  readonly skipped: number;
}

export interface RestoreConflict {
  readonly contributorKey: string;
  readonly entityId: string;
  readonly reason: string;
}

export interface PaginatedBackups {
  readonly items: ReadonlyArray<BackupMetadata>;
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

/** Published public API — other modules depend ONLY on this abstract class. */
export abstract class BackupPort {
  abstract create(request: CreateBackupRequest): Promise<{ jobId: string; backup: BackupMetadata }>;
  abstract restore(request: RestoreRequest): Promise<RestoreReport>;
  abstract list(guildId: string | null, page: number, pageSize: number): Promise<PaginatedBackups>;
  abstract get(backupId: string): Promise<BackupMetadata | null>;
  abstract delete(backupId: string, requestedById: string): Promise<void>;
  abstract export(backupId: string): Promise<{ stream: NodeJS.ReadableStream; filename: string }>;
}
```

```typescript
// contracts/backup-contributor.contract.ts
// Each module implements this to declare WHAT belongs in a guild backup.
// The Backup Module resolves contributors through the registry — it never
// imports another module's internal services.

export interface BackupContributor<T = unknown> {
  /** Stable namespaced key, e.g. "tickets", "permissions", "i18n". */
  readonly key: string;
  /** Schema version of this contributor's payload, for restore compat. */
  readonly schemaVersion: string;
  /** Produce the serialisable slice for a guild. MUST be pure-read. */
  collect(guildId: string): Promise<T>;
  /** Apply a previously-collected slice. MUST be idempotent & transactional. */
  apply(guildId: string, payload: T, strategy: ConflictStrategy): Promise<ApplyResult>;
}

export type ConflictStrategy = 'overwrite' | 'merge' | 'skip';

export interface ApplyResult {
  readonly created: number;
  readonly updated: number;
  readonly skipped: number;
  readonly conflicts: ReadonlyArray<{ entityId: string; reason: string }>;
}
```

```typescript
// domain/encryption-domain.service.ts (interface)

export interface EnvelopeResult {
  readonly ciphertext: Buffer;
  readonly iv: Buffer;
  readonly authTag: Buffer;
  readonly wrappedDek: string; // base64, DEK encrypted by KEK from Secret Mgmt
  readonly algorithm: 'aes-256-gcm';
}

export abstract class EncryptionDomainService {
  abstract seal(plaintext: Buffer, guildId: string | null): Promise<EnvelopeResult>;
  abstract open(envelope: EnvelopeResult): Promise<Buffer>;
  abstract sign(manifest: Buffer): Promise<string>; // HMAC over canonical manifest
  abstract verify(manifest: Buffer, signature: string): Promise<boolean>;
}
```

## 6. Events

All events flow over the core Event Bus. Names are namespaced `backup.*`.

**Emitted:**

```typescript
// contracts/backup.events.ts

export interface BackupRequestedEvent {
  readonly backupId: string;
  readonly guildId: string | null;
  readonly kind: BackupKind;
  readonly trigger: BackupTrigger;
  readonly at: Date;
}

export interface BackupCompletedEvent {
  readonly backupId: string;
  readonly guildId: string | null;
  readonly kind: BackupKind;
  readonly version: number;
  readonly sizeBytes: number;
  readonly storageKey: string;
  readonly at: Date;
}

export interface BackupFailedEvent {
  readonly backupId: string;
  readonly guildId: string | null;
  readonly reason: string; // user-friendly, never leaks internals
  readonly at: Date;
}

export interface RestoreCompletedEvent {
  readonly backupId: string;
  readonly guildId: string;
  readonly dryRun: boolean;
  readonly entries: number;
  readonly at: Date;
}

export interface BackupExpiredEvent {
  readonly backupId: string;
  readonly guildId: string | null;
  readonly at: Date;
}

export const BACKUP_EVENTS = {
  REQUESTED: 'backup.requested',
  COMPLETED: 'backup.completed',
  FAILED: 'backup.failed',
  RESTORE_COMPLETED: 'backup.restore.completed',
  EXPIRED: 'backup.expired',
} as const;
```

**Consumed:**

- `guild.deleted` — schedule a final `guild_config` backup (grace snapshot) and mark existing backups for retention sweep.
- `module.disabled` — optionally trigger a `module_data` backup before teardown (configurable).
- `storage.key.evicted` — mark the affected backup `status = 'deleted'` and alert via audit log.

## 7. Dependencies

Relies ONLY on CORE systems — never another module's internals:

| Core system        | Usage                                                                 |
|--------------------|-----------------------------------------------------------------------|
| **Storage**        | All blob persistence via `StoragePort` (`put`/`get`/`delete`/`stream`). Backup never touches a filesystem or bucket directly. |
| **Event Bus**      | Emits `backup.*`; consumes `guild.deleted`, `module.disabled`, `storage.key.evicted`. |
| **Queue (BullMQ)** | `backup.run`, `backup.schedule`, `retention.sweep` queues; retries, backoff, DLQ. |
| **Cache**          | Caches latest backup metadata per `(guildId, kind)` and list pages; namespaced keys `backup:<guildId>:*`. |
| **Database**       | Prisma via repositories only (metadata, restore jobs). |
| **Permissions**    | Claim checks (`backup.*`) on every command/endpoint. |
| **Secret Management** | Resolves the KEK for envelope encryption; rotation-aware. |
| **i18n**           | Translates command replies and dashboard strings (PT/EN + namespaces). |
| **Logging**        | Pino structured logs + audit hooks. |

Contributors (`BackupContributor`) are the controlled way other modules participate, registered through the `contributor.registry` — still no direct service import.

## 8. Configuration

Config priority is **ENV → Database → Defaults**, all Zod-validated. Guild-scoped settings override global where applicable.

```typescript
// validators/backup.zod.ts
import { z } from 'zod';

export const retentionPolicySchema = z.object({
  maxCount: z.number().int().min(1).max(500).default(30),
  maxAgeDays: z.number().int().min(1).max(3650).default(90),
  keepMinimum: z.number().int().min(0).max(50).default(3),
});

export const guildBackupConfigSchema = z.object({
  enabled: z.boolean().default(true),
  autoScheduleCron: z.string().default('0 3 * * *'), // daily 03:00
  kinds: z.array(z.enum(['guild_config', 'module_data'])).default(['guild_config']),
  encryption: z.boolean().default(true),
  retention: retentionPolicySchema.default({}),
  notifyChannelId: z.string().regex(/^\d{17,20}$/).optional(),
  preRestoreBackup: z.boolean().default(true),
});

export const globalBackupConfigSchema = z.object({
  fullDbCron: z.string().default('0 4 * * 0'), // weekly Sun 04:00
  fullDbEnabled: z.boolean().default(true),
  maxConcurrentJobs: z.number().int().min(1).max(20).default(4),
  maxBackupSizeMb: z.number().int().min(1).max(10_240).default(512),
  storageNamespace: z.string().default('backups'),
  retention: retentionPolicySchema.default({ maxCount: 12, maxAgeDays: 180, keepMinimum: 4 }),
});

export type GuildBackupConfig = z.infer<typeof guildBackupConfigSchema>;
export type GlobalBackupConfig = z.infer<typeof globalBackupConfigSchema>;
```

ENV overrides (examples): `BACKUP_FULL_DB_CRON`, `BACKUP_MAX_CONCURRENT_JOBS`, `BACKUP_ENCRYPTION_REQUIRED=true`. If `BACKUP_ENCRYPTION_REQUIRED=true`, the guild-level `encryption:false` is rejected at validation time.

## 9. Database

Prisma models (MySQL). Soft-delete via `deletedAt`; backups also have a logical `status='deleted'` and `expiresAt` for retention.

```prisma
model Backup {
  id            String        @id @default(cuid())
  guildId       String?       // null = global / full_db
  kind          BackupKind
  trigger       BackupTrigger
  status        BackupStatus  @default(pending)
  version       Int           // monotonic per (guildId, kind)
  sizeBytes     Int           @default(0)
  checksum      String        @db.VarChar(64)  // sha256 of plaintext
  storageKey    String        @db.VarChar(512) // opaque Storage module key
  encrypted     Boolean       @default(true)
  algorithm     String?       @db.VarChar(32)  // aes-256-gcm
  wrappedDek    String?       @db.Text         // DEK wrapped by KEK
  manifestSig   String?       @db.VarChar(128) // HMAC signature
  schemaVersion String        @db.VarChar(16)
  scope         Json?         // contributor keys included
  note          String?       @db.VarChar(512)
  createdById   String?
  createdAt     DateTime      @default(now())
  completedAt   DateTime?
  expiresAt     DateTime?
  deletedAt     DateTime?

  restores      RestoreJob[]

  @@index([guildId, kind, createdAt])
  @@index([status])
  @@index([expiresAt])
  @@unique([guildId, kind, version])
  @@map("backups")
}

model RestoreJob {
  id               String        @id @default(cuid())
  backupId         String
  guildId          String
  status           BackupStatus  @default(pending)
  dryRun           Boolean       @default(false)
  conflictStrategy String        @db.VarChar(16)
  report           Json?         // RestoreReport snapshot
  requestedById    String
  createdAt        DateTime      @default(now())
  completedAt      DateTime?

  backup           Backup        @relation(fields: [backupId], references: [id])

  @@index([guildId, createdAt])
  @@index([backupId])
  @@index([status])
  @@map("restore_jobs")
}

enum BackupKind {
  guild_config
  full_db
  module_data
}

enum BackupTrigger {
  manual
  scheduled
  pre_restore
  migration
}

enum BackupStatus {
  pending
  running
  completed
  failed
  expired
  deleted
}
```

Notes: `@@unique([guildId, kind, version])` enforces the versioned timeline. `version` is computed in a transaction (`SELECT MAX(version) ... FOR UPDATE`) inside `BackupRepository`. Hard deletion of bytes happens in the Storage module; the metadata row is soft-deleted then physically purged by the retention sweep after a grace window.

## 10. API

REST under `/api/v1`, Swagger-documented. All DTOs Zod-validated. All endpoints guild-scoped and permission-guarded.

| Method | Path                                            | Claim                | Body / Query              |
|--------|-------------------------------------------------|----------------------|---------------------------|
| POST   | `/guilds/:guildId/backups`                      | `backup.create`      | `CreateBackupDto`         |
| GET    | `/guilds/:guildId/backups`                      | `backup.read`        | `ListBackupsQueryDto`     |
| GET    | `/guilds/:guildId/backups/:backupId`            | `backup.read`        | —                         |
| DELETE | `/guilds/:guildId/backups/:backupId`            | `backup.delete`      | —                         |
| GET    | `/guilds/:guildId/backups/:backupId/export`     | `backup.export`      | → streams `.ghostbak`     |
| POST   | `/guilds/:guildId/backups/import`               | `backup.import`      | multipart `.ghostbak`     |
| POST   | `/guilds/:guildId/backups/:backupId/restore`    | `backup.restore`     | `RestoreBackupDto`        |
| GET    | `/admin/backups/full-db`                        | `backup.admin.fulldb`| `ListBackupsQueryDto`     |
| POST   | `/admin/backups/full-db`                        | `backup.admin.fulldb`| —                         |

```typescript
// dto/restore-backup.dto.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const restoreBackupSchema = z.object({
  dryRun: z.boolean().default(true),
  conflictStrategy: z.enum(['overwrite', 'merge', 'skip']).default('merge'),
  scope: z.array(z.string().min(1)).optional(),
});

export class RestoreBackupDto extends createZodDto(restoreBackupSchema) {}
```

Restore POST returns `202 Accepted` with a `RestoreReport` for `dryRun=true` (synchronous) or a `jobId` for real restores (asynchronous via Queue). Export streams the encrypted bundle with `Content-Disposition` and a signed manifest header.

WS: optional `backup.progress` channel emitting job percentage for the dashboard (consumes Queue progress events).

## 11. Permissions

Wildcard-friendly claims defined by this unit (`backup.*` grants all):

- `backup.create`
- `backup.read`
- `backup.delete`
- `backup.restore`
- `backup.export`
- `backup.import`
- `backup.config.write` — edit guild backup config / cron / retention
- `backup.admin.fulldb` — operator-only, full DB snapshots & cross-guild
- `backup.admin.restore.global` — operator-only forced restore

Restore is high-risk: even with `backup.restore`, a non-dry-run restore additionally requires `backup.config.write` OR an explicit guild-owner confirmation step. `backup.admin.*` are never granted to guild roles by default.

## 12. Logging

Structured Pino logs, category `backup`, plus audit hooks for every state change.

- **Application logs:** job enqueued, started, completed, failed (with `backupId`, `guildId`, `kind`, `durationMs`, `sizeBytes`).
- **Security/Audit logs:** who triggered create/delete/restore/export/import, conflict strategy, scope, and source (command vs API vs dashboard). Export and import are always audited (data egress/ingress).
- **Error logs:** categorised, traced (OpenTelemetry span per job). Failure reasons are sanitised before reaching the user; internals stay in the log only.
- Never log plaintext payloads, DEKs, KEKs, or secret values. Manifest signatures are logged as truncated hashes only.

Audit hook example: `audit.record({ category: 'backup', action: 'restore', actorId, guildId, targetId: backupId, metadata: { dryRun, conflictStrategy } })`.

## 13. Testing

- **Unit (Vitest):**
  - `EncryptionDomainService` round-trip (`seal`→`open` yields identical bytes; tampered ciphertext fails auth tag; tampered manifest fails `verify`).
  - `RetentionService` selection logic: `maxCount`, `maxAgeDays`, `keepMinimum` interaction; never deletes below `keepMinimum`.
  - `BackupDomainService` version monotonicity and contributor composition ordering.
  - Conflict strategies (`overwrite`/`merge`/`skip`) in `apply` paths via mock contributors.
- **Integration:**
  - Repository version uniqueness under concurrent creates (transaction + `FOR UPDATE`).
  - Storage `StoragePort` interaction mocked then run against a real in-memory adapter.
  - Queue processors: retry/backoff, DLQ routing on repeated failure.
- **E2E (Playwright / supertest):**
  - Full lifecycle: create → complete → list → export → import into a fresh guild → restore (dry-run then real) → verify state.
  - Permission gating: each endpoint rejects missing claims with `403`.
  - Encryption mandatory path: `BACKUP_ENCRYPTION_REQUIRED=true` rejects unencrypted requests.
- **Coverage target:** ≥ 90% on domain + application services. No `any` in test code.

## 14. Dashboard Integration

Exposed under the guild **Backups** section (already referenced in `00-project.md` dashboard responsibilities):

- **Backups table:** paginated list (kind, version, size, status, createdAt, expiresAt) with filters and search by date/kind/status.
- **Create backup** button (manual) with scope multi-select (contributor keys) and note.
- **Schedule editor:** cron picker, kinds, retention sliders (`maxCount`, `maxAgeDays`, `keepMinimum`), notify-channel selector — writes via `backup.config.write`.
- **Restore wizard:** select backup → choose scope + conflict strategy → mandatory dry-run preview (renders `RestoreReport` diff: created/updated/skipped/conflicts) → confirm.
- **Export/Import:** download `.ghostbak`; drag-drop import with manifest signature validation feedback.
- **Live progress:** subscribes to `backup.progress` WS channel.
- Operator-only **Full DB snapshots** panel behind `backup.admin.fulldb`.
- All labels translated (PT primary, EN secondary) via i18n `backup` namespace.

## 15. Future Extensions

- **Incremental / differential backups** (store deltas against a base snapshot) to cut storage cost.
- **Cross-region replication** of encrypted blobs via Storage module multi-target.
- **Scheduled restore drills** (automated recovery verification into a sandbox guild).
- **Point-in-time recovery (PITR)** combining periodic full snapshots + event-log replay from the Event Bus.
- **GraphQL surface** for backup querying (per `00-project.md` optional GraphQL).
- **BYOK** — guild-supplied KEK via Secret Management for compliance-sensitive tenants.
- **Backup-to-Discord** attachment fallback for tiny guild-config exports.

## 16. Tasks for Claude

Ordered, phase by phase:

1. **Phase 1 — Schema:** Add `Backup`, `RestoreJob` models + enums; create Prisma migration; regenerate client.
2. **Phase 2 — Contracts:** Implement `contracts/` (`BackupPort`, `BackupContributor`, events). No logic yet.
3. **Phase 3 — Repositories:** `BackupRepository`, `RestoreRepository` (only Prisma touch points), with versioning transaction + pagination.
4. **Phase 4 — Domain:** `EncryptionDomainService` (envelope AES-256-GCM, KEK from Secret Mgmt, manifest signing), `BackupDomainService`, `SnapshotComposer`, `RetentionService`.
5. **Phase 5 — Application:** `BackupApplicationService`, `RestoreApplicationService`, `ImportExportService` — orchestrate Storage, Queue, Cache, events.
6. **Phase 6 — Events:** Wire emit/consume on the Event Bus (`guild.deleted`, `storage.key.evicted`).
7. **Phase 7 — Jobs:** BullMQ processors `backup-run`, `backup-schedule`, `retention-sweep` with retries + DLQ.
8. **Phase 8 — Commands:** Necord slash commands (see Acceptance).
9. **Phase 9 — Dashboard:** Backups table, schedule editor, restore wizard, import/export, progress WS.
10. **Phase 10 — API:** REST controllers + Zod DTOs + Swagger annotations.
11. **Phase 11 — Tests:** Unit, integration, e2e per section 13.
12. **Phase 12 — Docs:** Update this doc, README of the module, and the i18n `backup` namespace (PT + EN).

## 17. Acceptance Criteria

- A guild owner can run `/backup create [kind] [note]` and receives a confirmation with a `backupId` and queued status.
- `/backup list` shows the versioned timeline, paginated and translated.
- `/backup restore <backupId> [strategy]` always runs a dry-run first and renders a diff; a second confirm applies it.
- `/backup export <backupId>` and dashboard import round-trips into a different guild and restores correctly.
- Automatic scheduled backups fire per the configured cron and respect retention (`keepMinimum` never violated).
- Every blob is persisted exclusively through the Storage module and encrypted (AES-256-GCM) when encryption is on; `BACKUP_ENCRYPTION_REQUIRED=true` forbids disabling it.
- All endpoints/commands enforce `backup.*` claims; operator-only `backup.admin.*` are not reachable by guild roles.
- A tampered bundle fails manifest verification and is rejected on import/restore.
- Failures emit `backup.failed`, are audited, retried, and land in the DLQ after exhausting retries — without leaking internals to the user.

## 18. Definition of Done

- All 18 sections implemented; this document committed under `docs/modules/backup.md`.
- Prisma migration created and applied; `prisma generate` clean.
- Unit + integration + e2e tests pass; coverage ≥ 90% on domain/application services.
- No `any`; ESLint + Prettier clean; Commitlint-compliant Conventional Commits.
- Zod schemas validate all config + DTOs; ENV → DB → Defaults priority honoured.
- Events emitted/consumed exactly as specified; audit + Pino logging in place.
- i18n `backup` namespace populated for PT and EN.
- Dashboard surfaces functional behind correct permission claims.
- Feature delivered on `feature/backup`, PR opened against `develop` (never direct to `main`), reviewed and green in GitHub Actions.
