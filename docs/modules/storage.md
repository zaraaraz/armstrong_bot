# Storage Module

> ## Claude Instructions
> - Never modify another module. Do not change architecture decisions from `00-project.md`.
> - This module is CORE infrastructure: it exposes a driver-agnostic `StorageProvider` contract. Adding a new backend (S3, R2, Backblaze) MUST require ZERO changes to consuming modules.
> - Keep backwards compatibility. Create Prisma migrations. Generate tests and docs.
> - Generate DTOs. Use the Repository Pattern (only `StorageObjectRepository` touches Prisma). Use the Event Bus. Use Dependency Injection.
> - No `any`. Keep methods small (<50 lines where reasonable). Follow existing naming.
> - No module touches Redis directly — use the Cache layer. No module touches a driver SDK directly — use `StorageService`.
> - Create indexes for searchable fields (`contentHash`, `guildId`, `namespace`). Support pagination, caching, translations, dashboard.
> - Drivers are pluggable: register them through a `StorageDriverRegistry` and select via config (`ENV -> Database -> Defaults`). Validate all config with Zod.

---

## 1. Purpose

The Storage Module provides a single, driver-agnostic abstraction for persisting and retrieving binary and text artifacts produced across Ghost Bot — ticket **transcripts**, guild **backups**, generated **rank-cards**, plugin attachments, and exported reports.

Today the only backend is the local filesystem. Tomorrow we may run on **AWS S3**, **Cloudflare R2**, or **Backblaze B2** — and the migration MUST happen by changing a single config value, not by touching any consuming module. To guarantee this, every consumer talks only to `StorageService` against the `StorageProvider` interface; no consumer ever imports a driver SDK, builds a path, or signs a URL by hand.

The module also owns **content addressing** (dedupe identical bytes by SHA-256), **signed URL** issuance (time-limited download/upload links), object metadata (a Prisma-backed catalog), namespacing, and quota accounting per guild.

## 2. Goals

- **Driver independence**: swapping Local -> S3 / R2 / Backblaze is a config change only. No `if (driver === 's3')` leaks outside the `drivers/` folder.
- **One contract**: a single `StorageProvider` abstract class implemented by every driver. Identical semantics for `put`, `get`, `delete`, `exists`, `signGetUrl`, `signPutUrl`, `stat`, `copy`, `list`.
- **Content addressing**: objects keyed by `sha256` of their bytes so identical uploads (e.g. the same rank-card background) dedupe automatically.
- **Signed URLs**: time-limited links so the dashboard/Discord can serve large objects without proxying bytes through the bot.
- **Guild-aware namespacing**: keys are scoped `{guildId}/{namespace}/{hash}` unless explicitly global.
- **Catalog**: every stored object has a Prisma row (size, mime, owner, references, soft-delete) so we can audit, garbage-collect, and enforce quotas.
- **Safety**: validated mime/size, no path traversal, no internal leakage in errors, full audit logging.

## 3. Architecture

Strict layer flow, no shortcuts:

```
Consumer module (transcripts / backups / rank-cards)
        | (public API only — never a driver SDK)
        v
StorageService          (Application Service: orchestration, hashing, quota, events)
        |
        +--> StorageObjectRepository  --> Prisma --> MySQL   (catalog rows)
        |
        +--> StorageProvider (abstract)                       (byte movement)
                ^
                | resolved at runtime by
        StorageDriverRegistry  <-- StorageConfigService (ENV -> DB -> Defaults, Zod)
                |
   +------------+-------------+----------------+----------------+
   |            |             |                |                |
LocalDriver  S3Driver*    R2Driver*       BackblazeDriver*   (NullDriver for tests)
(*future, but interface-complete from day one)
```

Key rules:
- `StorageService` is the ONLY entry point for consumers. It is the boundary that enforces hashing, quota, and catalog consistency.
- A driver moves bytes ONLY. It knows nothing about Prisma, guilds, quotas, or events.
- The catalog (Prisma) and the bytes (driver) are kept consistent inside `StorageService` — catalog row is written after a successful `put`, and a delete soft-deletes the row then schedules a `storage.gc` job to remove bytes.
- Signed URLs are issued by the driver (each backend signs differently) but requested through `StorageService` so we can enforce permissions and log access.

## 4. Folder Structure

```
src/core/storage/
├── storage.module.ts
├── storage.service.ts                 # Application Service (public entry point)
├── storage.tokens.ts                  # DI tokens (STORAGE_DRIVER, STORAGE_CONFIG)
├── storage-driver.registry.ts         # maps driver name -> provider instance
├── storage-config.service.ts          # ENV -> DB -> Defaults, Zod validated
├── content-hash.util.ts               # SHA-256 streaming hash, key builder
├── contracts/
│   ├── storage-provider.abstract.ts   # the StorageProvider contract
│   ├── storage-object.types.ts        # StorageObjectMeta, PutOptions, SignedUrl
│   └── storage.public.ts              # the ONLY public re-export surface
├── drivers/
│   ├── local.driver.ts
│   ├── s3.driver.ts                   # future-ready (S3/R2/Backblaze share S3 API)
│   ├── backblaze.driver.ts            # B2 native (fallback if not S3-compatible)
│   └── null.driver.ts                 # in-memory, for tests
├── repositories/
│   ├── storage-object.repository.ts   # ONLY file that touches Prisma here
│   └── storage-object.repository.interface.ts
├── dto/
│   ├── upload-object.dto.ts
│   ├── sign-url.dto.ts
│   └── storage-object.response.dto.ts
├── events/
│   └── storage.events.ts              # event name constants + payload types
├── jobs/
│   └── storage-gc.processor.ts        # BullMQ: delete orphaned bytes
├── api/
│   └── storage.controller.ts          # REST (Controller — never touches Prisma)
└── config/
    └── storage.config.schema.ts       # Zod schemas
```

## 5. Public Interfaces

The driver contract every backend implements. This is the seam that makes backends swappable.

```typescript
// contracts/storage-object.types.ts
export interface StorageObjectMeta {
  readonly key: string;          // backend-relative key, e.g. "123/transcripts/ab12...".json
  readonly size: number;         // bytes
  readonly contentType: string;  // validated mime
  readonly contentHash: string;  // sha256 hex
  readonly etag?: string;        // backend etag if available
  readonly lastModified?: Date;
}

export interface PutOptions {
  readonly contentType: string;
  readonly cacheControl?: string;
  readonly immutable?: boolean;     // content-addressed => safe to cache forever
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface SignedUrl {
  readonly url: string;
  readonly method: 'GET' | 'PUT';
  readonly expiresAt: Date;
  readonly headers?: Readonly<Record<string, string>>; // headers caller must send (PUT)
}

export interface SignOptions {
  readonly expiresInSeconds: number; // bounded by config max
  readonly downloadFilename?: string; // Content-Disposition for GET
  readonly contentType?: string;      // required for PUT
}
```

```typescript
// contracts/storage-provider.abstract.ts
import { Readable } from 'node:stream';
import { StorageObjectMeta, PutOptions, SignedUrl, SignOptions } from './storage-object.types';

export abstract class StorageProvider {
  /** Stable driver identifier, e.g. "local" | "s3" | "r2" | "backblaze". */
  abstract readonly name: string;

  /** True if this backend can issue signed URLs natively. */
  abstract readonly supportsSignedUrls: boolean;

  abstract put(key: string, body: Buffer | Readable, opts: PutOptions): Promise<StorageObjectMeta>;

  abstract get(key: string): Promise<Readable>;

  abstract getBuffer(key: string): Promise<Buffer>;

  abstract exists(key: string): Promise<boolean>;

  abstract stat(key: string): Promise<StorageObjectMeta | null>;

  abstract delete(key: string): Promise<void>;

  abstract copy(sourceKey: string, destKey: string): Promise<StorageObjectMeta>;

  abstract list(prefix: string, limit: number, cursor?: string): Promise<{
    readonly items: readonly StorageObjectMeta[];
    readonly nextCursor?: string;
  }>;

  abstract signGetUrl(key: string, opts: SignOptions): Promise<SignedUrl>;

  abstract signPutUrl(key: string, opts: SignOptions): Promise<SignedUrl>;

  /** Liveness check for health endpoints. */
  abstract healthCheck(): Promise<boolean>;
}
```

The Application Service consumers actually call:

```typescript
// storage.service.ts (public shape)
export interface StoreParams {
  readonly guildId: string | null;       // null => global object
  readonly namespace: StorageNamespace;   // 'transcripts' | 'backups' | 'rank-cards' | ...
  readonly body: Buffer | NodeJS.ReadableStream;
  readonly contentType: string;
  readonly ownerType: string;             // 'ticket' | 'guild' | 'user' | 'plugin'
  readonly ownerId: string;
  readonly filename?: string;
  readonly immutable?: boolean;
}

export interface IStorageService {
  store(params: StoreParams): Promise<StorageObjectResponseDto>;
  fetchStream(objectId: string, actorGuildId: string | null): Promise<NodeJS.ReadableStream>;
  signDownload(objectId: string, expiresInSeconds: number, actorGuildId: string | null): Promise<SignedUrl>;
  signUpload(params: Omit<StoreParams, 'body'>, expiresInSeconds: number): Promise<SignedUrl>;
  remove(objectId: string, actorGuildId: string | null): Promise<void>;
  get(objectId: string): Promise<StorageObjectResponseDto | null>;
  list(query: ListObjectsQuery): Promise<Paginated<StorageObjectResponseDto>>;
}
```

```typescript
// contracts/storage.public.ts — the ONLY surface other modules may import
export { StorageProvider } from './storage-provider.abstract';
export type { StorageObjectMeta, SignedUrl, SignOptions, PutOptions } from './storage-object.types';
export type { IStorageService, StoreParams } from '../storage.service';
export { STORAGE_NAMESPACES } from './storage-object.types';
```

## 6. Events

Emitted on the Event Bus (consumed by audit, quota, dashboard, GC):

```typescript
// events/storage.events.ts
export const StorageEvents = {
  ObjectStored: 'storage.object.stored',
  ObjectDeleted: 'storage.object.deleted',
  ObjectAccessed: 'storage.object.accessed', // signed URL issued or stream served
  QuotaExceeded: 'storage.quota.exceeded',
  GcCompleted: 'storage.gc.completed',
} as const;

export interface ObjectStoredPayload {
  readonly objectId: string;
  readonly guildId: string | null;
  readonly namespace: string;
  readonly contentHash: string;
  readonly size: number;
  readonly deduped: boolean;       // true if bytes already existed (ref-count bump only)
  readonly at: string;             // ISO timestamp
}

export interface ObjectDeletedPayload {
  readonly objectId: string;
  readonly guildId: string | null;
  readonly contentHash: string;
  readonly bytesScheduledForGc: boolean;
  readonly at: string;
}

export interface ObjectAccessedPayload {
  readonly objectId: string;
  readonly guildId: string | null;
  readonly mode: 'stream' | 'signed-get' | 'signed-put';
  readonly actor?: string;
  readonly at: string;
}

export interface QuotaExceededPayload {
  readonly guildId: string;
  readonly usedBytes: number;
  readonly limitBytes: number;
  readonly at: string;
}
```

**Consumed**: `guild.deleted` (from Guild module via Event Bus) -> soft-delete all objects for that guild and enqueue GC. No direct module import — the listener subscribes to the bus.

## 7. Dependencies

Relies ONLY on CORE systems — never on another feature module:

| Core system | Usage |
|-------------|-------|
| **Database** | `StorageObjectRepository` (Prisma) for the object catalog. Only the repository touches Prisma. |
| **Events** | Emits `storage.*`; subscribes to `guild.deleted`. |
| **Cache** | Caches object metadata and resolved signed URLs (short TTL) via the Cache layer — never Redis directly. Namespaced keys `storage:meta:{objectId}`, `storage:sign:{objectId}:{exp}`. |
| **Queue (BullMQ)** | `storage.gc` queue for orphaned-byte deletion; retries + DLQ. |
| **Permissions** | Checks `storage.*` claims before signing/streaming/deleting. |
| **Config** | `StorageConfigService` resolves driver + driver options (ENV -> DB -> Defaults). |
| **Logger (Pino)** | Structured logs, audit hooks, OpenTelemetry spans on put/get/sign. |

Consumers (transcripts, backups, rank-cards) depend on **Storage's public API**, not the other way around.

## 8. Configuration

Global driver selection plus per-guild overrides (quota, default namespace TTLs). All Zod-validated.

```typescript
// config/storage.config.schema.ts
import { z } from 'zod';

export const StorageDriverEnum = z.enum(['local', 's3', 'r2', 'backblaze', 'null']);

export const LocalDriverSchema = z.object({
  driver: z.literal('local'),
  basePath: z.string().min(1).default('./data/storage'),
  publicBaseUrl: z.string().url().optional(), // for serving via signed proxy routes
});

export const S3CompatibleSchema = z.object({
  driver: z.enum(['s3', 'r2', 'backblaze']),
  endpoint: z.string().url().optional(),       // R2/B2 require custom endpoint
  region: z.string().min(1).default('auto'),
  bucket: z.string().min(1),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  forcePathStyle: z.boolean().default(true),   // R2/B2 friendly
});

export const StorageConfigSchema = z.object({
  active: z.discriminatedUnion('driver', [LocalDriverSchema, S3CompatibleSchema]),
  maxObjectSizeBytes: z.coerce.number().int().positive().default(50 * 1024 * 1024), // 50MB
  signedUrlMaxSeconds: z.coerce.number().int().positive().default(3600),
  allowedMimeTypes: z.array(z.string()).default([
    'application/json', 'text/plain', 'text/html', 'image/png', 'image/webp', 'application/gzip',
  ]),
  defaultGuildQuotaBytes: z.coerce.number().int().positive().default(1024 * 1024 * 1024), // 1GB
});

export type StorageConfig = z.infer<typeof StorageConfigSchema>;

// Per-guild override (stored in DB, validated on read)
export const GuildStorageOverrideSchema = z.object({
  quotaBytes: z.coerce.number().int().positive().optional(),
  signedUrlMaxSeconds: z.coerce.number().int().positive().optional(),
});
export type GuildStorageOverride = z.infer<typeof GuildStorageOverrideSchema>;
```

Resolution order: ENV (`STORAGE_DRIVER`, `STORAGE_S3_BUCKET`, ...) overrides DB settings, which override the schema defaults. The active driver is resolved once at boot by `StorageConfigService` and handed to `StorageDriverRegistry`.

## 9. Database

```prisma
// schema additions

enum StorageNamespace {
  TRANSCRIPTS
  BACKUPS
  RANK_CARDS
  EXPORTS
  PLUGIN
}

/// Catalog row per logical object. Bytes live in the active driver.
model StorageObject {
  id           String           @id @default(cuid())
  guildId      String?          // null => global
  namespace    StorageNamespace
  /// backend-relative key, content-addressed: "{guildId|global}/{ns}/{hash}"
  key          String
  contentHash  String           // sha256 hex — dedupe anchor
  size         Int
  contentType  String
  filename     String?
  ownerType    String           // 'ticket' | 'guild' | 'user' | 'plugin'
  ownerId      String
  immutable    Boolean          @default(true)
  /// how many catalog rows point at the same contentHash bytes
  refCount     Int              @default(1)
  metadata     Json?
  createdAt    DateTime         @default(now())
  updatedAt    DateTime         @updatedAt
  deletedAt    DateTime?        // soft delete

  @@index([guildId, namespace])
  @@index([contentHash])
  @@index([ownerType, ownerId])
  @@index([deletedAt])
  @@map("storage_objects")
}

/// Aggregated usage per guild for quota enforcement (fast read, no SUM scan).
model StorageUsage {
  guildId    String   @id
  usedBytes  BigInt   @default(0)
  objectCount Int     @default(0)
  updatedAt  DateTime @updatedAt

  @@map("storage_usage")
}
```

Notes:
- **Soft delete**: `deletedAt` set on remove; bytes deleted only when `refCount` reaches 0, via the GC job.
- **Dedupe**: a `put` whose `contentHash` already exists (non-deleted) bumps `refCount` and skips re-uploading bytes (`deduped: true`).
- Indexes cover the dashboard's filter dimensions (guild + namespace, owner, hash) and GC scans (`deletedAt`).

## 10. API

Controllers never touch Prisma — they call `StorageService`. Guarded by JWT + permission claims. Swagger-documented.

| Method | Path | Body / Query | Permission | Notes |
|--------|------|--------------|------------|-------|
| `GET` | `/api/storage/objects` | `ListObjectsQueryDto` (guildId, namespace, ownerType, page, pageSize) | `storage.read` | Paginated catalog list |
| `GET` | `/api/storage/objects/:id` | — | `storage.read` | `StorageObjectResponseDto` |
| `POST` | `/api/storage/objects/:id/sign-download` | `SignUrlDto { expiresInSeconds, filename? }` | `storage.download` | Returns `SignedUrl` |
| `POST` | `/api/storage/objects/sign-upload` | `SignUploadDto { guildId, namespace, contentType }` | `storage.upload` | Direct-to-backend upload URL |
| `DELETE` | `/api/storage/objects/:id` | — | `storage.delete` | Soft delete + schedule GC |
| `GET` | `/api/storage/usage/:guildId` | — | `storage.read` | Quota usage summary |

```typescript
// dto/sign-url.dto.ts
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class SignUrlDto {
  @IsInt() @Min(30) @Max(86400)
  expiresInSeconds!: number;

  @IsOptional() @IsString()
  filename?: string;
}

// dto/storage-object.response.dto.ts
export class StorageObjectResponseDto {
  id!: string;
  guildId!: string | null;
  namespace!: string;
  contentHash!: string;
  size!: number;
  contentType!: string;
  filename!: string | null;
  ownerType!: string;
  ownerId!: string;
  createdAt!: string;
}
```

Local driver also exposes an internal signed-proxy route `GET /api/storage/local/:token` that validates an HMAC token and streams the file (since the local filesystem has no native signing). This route is hidden from Swagger and used only when `driver === 'local'`.

## 11. Permissions

Wildcard-compatible claims under the `storage.*` namespace:

- `storage.read` — list/inspect catalog metadata.
- `storage.download` — request a signed GET URL or stream bytes.
- `storage.upload` — request a signed PUT URL / store objects.
- `storage.delete` — soft-delete objects and trigger GC.
- `storage.admin` — manage quotas and per-guild overrides; implied by `storage.*`.

Checks are guild-scoped: a claim on guild A never grants access to objects of guild B. Global (`guildId === null`) objects require `storage.admin`.

## 12. Logging

- **Categories**: `storage.put`, `storage.get`, `storage.sign`, `storage.delete`, `storage.gc`, `storage.quota`.
- Every mutating op logs `{ objectId, guildId, namespace, contentHash, size, driver, deduped }` at `info`; failures at `error` with categorized error code (never the raw driver/SDK error string).
- **Audit hooks**: `ObjectStored`, `ObjectDeleted`, `ObjectAccessed`, `QuotaExceeded` events feed the central audit log with actor + guild.
- **OpenTelemetry**: spans `storage.put`, `storage.get`, `storage.sign` with attributes `driver`, `namespace`, `size`; counters `storage_objects_total`, `storage_bytes_total`, `storage_dedupe_hits_total`, gauge `storage_guild_usage_bytes`.
- Signed-URL secrets and access keys are NEVER logged.

## 13. Testing

- **Unit**: `content-hash.util` (stable SHA-256, key building, traversal rejection); `StorageService` orchestration (dedupe ref-count, quota enforcement, soft-delete -> GC enqueue) with a mocked provider + repository; `StorageConfigService` resolution order (ENV > DB > defaults) and Zod failures.
- **Driver contract suite**: a single parameterized test bank run against **every** driver (`LocalDriver`, `NullDriver`, and `S3Driver` against a MinIO container) asserting identical `put/get/exists/stat/delete/copy/list/sign` semantics. This is what proves drivers are swappable.
- **Integration**: real Prisma + MySQL test DB — catalog row consistency, `refCount` transitions, `StorageUsage` aggregation, `guild.deleted` cascade.
- **e2e (Playwright/API)**: upload via signed PUT, download via signed GET, expiry rejection, permission denial across guilds.
- Coverage target: >= 90% lines on `storage.service.ts` and `content-hash.util.ts`; 100% of the driver contract suite must pass for each registered driver.

## 14. Dashboard Integration

- **Storage browser**: paginated, filterable table (guild, namespace, owner, mime, size, date) backed by `GET /api/storage/objects`.
- **Per-object actions**: copy signed download link, view metadata, delete (with `storage.delete`).
- **Usage panel**: per-guild quota gauge (used/limit) from `GET /api/storage/usage/:guildId`; warns near limit using the `QuotaExceeded` event stream.
- **Admin**: driver health indicator (from `provider.healthCheck()`), and per-guild quota override editor (`storage.admin`).
- All labels i18n-namespaced under `storage.*` (PT primary, EN secondary), with plural/variable interpolation for sizes/counts.

## 15. Future Extensions

- Additional drivers: Google Cloud Storage, Azure Blob (implement `StorageProvider`, register, flip config).
- Server-side encryption (SSE) and per-namespace KMS keys.
- Client-side compression/encryption transform pipeline before `put`.
- Lifecycle policies per namespace (auto-expire transcripts after N days).
- Multipart/resumable uploads for large backups.
- Cross-region replication and read-through CDN integration.
- Virus scanning hook on upload (queue-driven).

## 16. Tasks for Claude

1. **Phase 1 — Schema**: add `StorageObject`, `StorageUsage`, `StorageNamespace` enum to Prisma; create migration; add indexes.
2. **Phase 2 — Contracts**: implement `StorageProvider` abstract, `storage-object.types.ts`, `storage.public.ts`, Zod `storage.config.schema.ts`.
3. **Phase 3 — Drivers**: `LocalDriver` (with HMAC signed-proxy), `NullDriver`, and interface-complete `S3Driver` (covers S3/R2/Backblaze via endpoint config); `StorageDriverRegistry` + `StorageConfigService`.
4. **Phase 4 — Repository & Service**: `StorageObjectRepository` (Prisma only here), `content-hash.util`, `StorageService` (hashing, dedupe ref-count, quota, soft-delete).
5. **Phase 5 — Events**: emit `storage.*`; subscribe to `guild.deleted`; wire audit hooks.
6. **Phase 6 — Jobs**: `storage-gc.processor` (BullMQ, retries, DLQ).
7. **Phase 7 — API**: `storage.controller`, DTOs, Swagger, permission guards.
8. **Phase 8 — Dashboard**: storage browser, usage panel, admin overrides; i18n keys.
9. **Phase 9 — Tests**: unit + driver contract suite + integration + e2e.
10. **Phase 10 — Docs**: update module README and `00-project.md` references; document driver setup envs.

## 17. Acceptance Criteria

- [ ] Swapping `STORAGE_DRIVER` from `local` to `s3`/`r2`/`backblaze` requires NO code change in any consuming module.
- [ ] Identical bytes stored twice produce one set of bytes and `refCount === 2`; event reports `deduped: true`.
- [ ] Signed GET/PUT URLs work for every driver; expired URLs are rejected; max TTL is enforced from config.
- [ ] Deleting an object soft-deletes the row; bytes removed by GC only when `refCount` hits 0.
- [ ] Quota enforced: storing past `quotaBytes` throws a user-friendly error and emits `QuotaExceeded`.
- [ ] Cross-guild access is denied; global objects require `storage.admin`.
- [ ] No path traversal possible; disallowed mime/oversize rejected before any byte write.
- [ ] The driver contract test suite passes identically for Local, Null, and S3 (MinIO).

## 18. Definition of Done

- [ ] All 18 sections implemented as specified; no `any`; ESLint/Prettier clean.
- [ ] Prisma migration created and applied; indexes present.
- [ ] Unit, integration, contract, and e2e tests pass; coverage targets met.
- [ ] Events emitted/consumed via the Event Bus; cache accessed only through the Cache layer; queue jobs registered.
- [ ] Swagger docs generated; dashboard pages wired; i18n keys (PT + EN) added.
- [ ] Logs/metrics/traces present; no secrets logged.
- [ ] Conventional Commits on a `feature/storage` branch; PR opened against `develop` (never direct to `main`).
