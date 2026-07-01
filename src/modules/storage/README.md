# Storage Module

> Spec: [`docs/modules/storage.md`](../../../docs/modules/storage.md) · Roadmap items 17–18 (Phase 4).

The single, driver-agnostic facility for **persisting and retrieving binary/text
artifacts** across Ghost Bot — ticket transcripts, guild backups, generated
rank-cards, exports and plugin attachments. It is a thin domain layer over a
pluggable **`StorageProvider`** contract, and it owns content-addressing (SHA-256
dedupe), a Prisma-backed object **catalog**, per-guild **quota** accounting and
time-limited **signed URLs**. Other modules move bytes *through this module* and
never touch a driver SDK, build a key, or sign a URL by hand.

Swapping the backend (local → S3 / R2 / Backblaze) is a **config change only**:
no `if (driver === 's3')` ever leaks outside `infrastructure/drivers/`.

## Public API (the only importable surface)

Everything below is re-exported from [`index.ts`](./index.ts). Nothing else is
public — the repository, config service, driver registry, the concrete drivers
and the GC processor are internal and must not be reached into.

```ts
import {
  StorageService,          // inject this to store / fetch / sign / remove
  StorageNamespace,        // TRANSCRIPTS | BACKUPS | RANK_CARDS | EXPORTS | PLUGIN
  type StoreParams,        // input to store()
  type StoredObjectRef,    // narrow handle returned by store()
  type SignedUrl,          // { url, method, expiresAt, headers? }
  type SignOptions,
  type StorageObjectMeta,  // driver-reported metadata
  StorageProvider,         // the driver contract (implement to add a backend)
  StorageEvents,           // lifecycle event names on the core Event Bus
  StorageError,            // switch on `.code`, never parse messages
} from '../storage';
```

### Store bytes

```ts
const ref = await storage.store({
  guildId: 'g1',                       // null => global object (needs storage.admin)
  namespace: StorageNamespace.Transcripts,
  body: buffer,                        // Buffer | Readable stream
  contentType: 'application/json',
  ownerType: 'ticket',
  ownerId: ticketId,
  filename: `transcript-${ticketId}.json`,
  immutable: true,                     // content-addressed => cache forever
});
// ref.deduped === true when identical bytes already existed (ref-count bump only)
```

### Fetch, sign, remove

```ts
const stream = await storage.fetchStream(ref.id, 'g1');
const dl = await storage.signDownload(ref.id, 900, 'g1'); // SignedUrl (GET), TTL bounded by config
const up = await storage.signUpload(params, 900);          // SignedUrl (PUT), direct-to-backend
await storage.remove(ref.id, 'g1');                        // soft-delete row + enqueue GC
```

All object operations are **guild-scoped**: a handle for guild A can never read
or delete an object of guild B, and global (`guildId === null`) objects require
`storage.admin`.

## Drivers

Every backend implements the `StorageProvider` abstract class (identical
`put/get/getBuffer/exists/stat/delete/copy/list/signGetUrl/signPutUrl/healthCheck`
semantics). The active one is resolved once at boot from `STORAGE_DRIVER` by
`StorageConfigService` and handed to `StorageDriverRegistry.active()`.

| Driver | `name` | Notes |
|---|---|---|
| **Local** | `local` | Filesystem under `STORAGE_LOCAL_ROOT`; no native signing, so it issues **HMAC signed-proxy** links served by an internal route. |
| **S3-compatible** | `s3` | One driver covers **S3 / R2 / Backblaze** via `STORAGE_S3_ENDPOINT` + `forcePathStyle`; native signed URLs. |
| **Null** | `null` | In-memory / discard, for tests. |

Adding a backend = implement `StorageProvider`, register it in
`StorageDriverRegistry`, and flip `STORAGE_DRIVER`. Zero changes to any consumer.

## Guarantees

- **Content-addressed + dedupe** — objects keyed by `sha256`; a `put` whose hash
  already exists bumps `refCount` instead of re-uploading (`deduped: true`).
- **Durable catalog** — every object is a Prisma row (`storage_objects`) with
  soft-delete via `deletedAt`; per-guild usage is aggregated in `storage_usage`.
- **Quota enforced** — writing past the guild quota throws
  `StorageQuotaExceededError` and emits `storage.quota.exceeded`.
- **Signed URLs** — time-limited GET/PUT links, TTL bounded by
  `STORAGE_MAX_SIGNED_URL_SECONDS`; expired links are rejected.
- **Safe deletes** — remove soft-deletes the row; bytes are dropped by the GC job
  only once `refCount` reaches 0.
- **No leakage** — failures surface as typed `StorageError`s with stable `.code`s;
  raw driver/SDK strings and signing secrets are never logged or returned.

## Config (env vars)

Resolution order **ENV → DB → defaults**, all Zod-validated
([`config/storage.config.ts`](./config/storage.config.ts)).

| Env var | Default | Meaning |
|---|---|---|
| `STORAGE_DRIVER` | `local` | Active driver: `local` \| `s3` \| `null`. |
| `STORAGE_LOCAL_ROOT` | `/srv/bots/armstrong/storage` | Root dir for the local driver. |
| `STORAGE_PUBLIC_BASE_URL` | `DASHBOARD_BASE_URL` → `http://localhost:3000` | Base URL for local signed-proxy links. |
| `STORAGE_SIGNING_SECRET` | *(change me)* | HMAC secret for local signed URLs. |
| `STORAGE_MAX_SIGNED_URL_SECONDS` | `900` | Upper bound (30 … 604800) on any requested URL TTL. |
| `STORAGE_DEFAULT_QUOTA_BYTES` | `1073741824` (1 GiB) | Default per-guild quota; `0` = unlimited. |
| `STORAGE_S3_ENDPOINT` | `''` | Custom endpoint (required for R2 / Backblaze). |
| `STORAGE_S3_REGION` | `auto` | S3 region. |
| `STORAGE_S3_BUCKET` | `''` | Target bucket. |
| `STORAGE_S3_ACCESS_KEY_ID` | `''` | Access key. |
| `STORAGE_S3_SECRET_ACCESS_KEY` | `''` | Secret key. |
| `STORAGE_S3_FORCE_PATH_STYLE` | `true` | Path-style addressing (R2/B2 friendly); set `false` for vhost-style. |

Per-guild overrides (`quotaBytes`) live in `GuildConfig.settings.storage` and are
layered over the global default, cached in the Cache layer (300s, `guild:{id}` tag).

## Events

Emitted on the core Event Bus ([`events/storage.events.ts`](./events/storage.events.ts));
consumed by audit, quota, dashboard and GC.

| Event | When |
|---|---|
| `storage.object.stored` | Object catalogued (fresh upload or dedupe bump). |
| `storage.object.deleted` | Object soft-deleted; bytes may be scheduled for GC. |
| `storage.object.accessed` | Stream served or signed URL issued. |
| `storage.quota.exceeded` | A write was rejected for exceeding a guild quota. |
| `storage.gc.completed` | GC finished; reports `deletedObjects` / `freedBytes`. |

**Consumed**: `guild.deleted` (from the Guild module, via the bus — never a direct
import) → soft-delete all of that guild's objects and enqueue GC.

## How other modules consume it

Storage is `@Global()`, so consumers just constructor-inject `StorageService`
(a **value** import — it is the abstract token bound to the impl in the module):

```ts
import { StorageService, StorageNamespace } from '../storage';

@Injectable()
export class TranscriptService {
  constructor(private readonly storage: StorageService) {}

  async archive(ticketId: string, guildId: string, html: Buffer) {
    return this.storage.store({
      guildId,
      namespace: StorageNamespace.Transcripts,
      body: html,
      contentType: 'text/html',
      ownerType: 'ticket',
      ownerId: ticketId,
    });
  }
}
```

Consumers depend on Storage's public barrel only — never on `PrismaService`, a
driver SDK, or the Cache/Queue for storage concerns.

## Layout

```
contracts/       StorageProvider abstract + public value types (StorageObjectMeta, SignedUrl, …)
config/          Zod config (global ENV + per-guild) + resolver, StorageConfigService
domain/          pure logic: namespace, object entity, content-hash util, typed errors
infrastructure/  StorageObjectRepository (only Prisma consumer), drivers/, driver registry
application/     StorageService (contract + impl): hashing, dedupe, quota, catalog consistency
observability/   metrics (Prometheus), tracing (OTel), audit
api/             StorageController + DTOs (never touches Prisma)
jobs/            storage-gc processor (BullMQ: orphaned-byte deletion, retries, DLQ)
events/          storage.events.ts (names + payload types)
locales/         pt/ en/ storage.json
```

## Notes & deferrals

- **S3 driver** is interface-complete but the AWS SDK client is a thin adapter;
  the parameterized **driver contract suite** is what proves Local, Null and S3
  (against a MinIO container) share identical semantics.
- **Audit** (item 15) and **Metrics/OTel** (item 16) modules aren't built yet, so
  `StorageAudit`, `StorageMetrics` and `StorageTracing` are self-contained
  adapters (Pino audit, a private Prometheus registry, no-op OTel until an
  exporter is registered) that the future modules can absorb without changing
  callers — same approach as the Scheduler module.
- Server-side encryption, per-namespace lifecycle policies, and multipart/resumable
  uploads are future extensions (see spec §15); the contract is designed not to
  break when they land.
