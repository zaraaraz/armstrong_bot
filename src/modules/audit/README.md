# Audit Module

> Spec: [docs/modules/audit.md](../../../docs/modules/audit.md) — roadmap item 15 (Phase 4).

Tamper-evident, append-only compliance ledger recording everything the bot
does — user-triggered and internal. Every entry is hash-chained to its
predecessor per `(scope, guildId)`, so any in-place edit, deletion, or replay
is detectable by `verifyChain`. Distinct from the Logs module (Discord-facing,
mutable notifications) and from Pino telemetry (ephemeral).

## Public API

```ts
import {
  AuditPublicApi,
  AuditScope,
  AuditSource,
  AuditActorType,
  AuditEvents,
  type AuditEntry,
  type AuditEntryDraft,
  type AuditQuery,
  type ChainVerificationResult,
} from '../audit';
```

Everything else (repository, queue, worker, chain internals) is
module-private. Other modules normally never call the audit module at all —
they just publish events on the core Event Bus and get audited for free.

### How events become ledger entries

```
EventBus.publish(...)            every envelope, any delivery policy
        │  (tap — passive, fire-and-forget)
        ▼
AuditEventConsumer ─▶ AuditIngestService     deny-list, normalise, redact
        │                                     (enqueue keyed by envelope id)
        ▼
BullMQ `audit.ingest` ─▶ AuditIngestProcessor  seq = last+1, hash = H(content
        │                                       + previousHash), insert
        ▼
MySQL `audit_entries` (+ `audit.entry.recorded` emitted, never re-audited)
```

- Ingestion never blocks or breaks the emitter: tap errors are swallowed,
  enqueue failures are logged + counted (`audit_ingest_total{result="dropped"}`).
- Enqueues are deduplicated by envelope id; the DB enforces unique
  `(scope, guildId, seq)` and unique `hash`.
- Appends are serialised per chain in-process and protected by an optimistic
  retry on the unique constraint, so `seq` stays strictly monotonic even with
  concurrent writers.

### Recording directly (rare — for actions with no bus event)

```ts
constructor(private readonly audit: AuditPublicApi) {}

await this.audit.record({
  scope: AuditScope.Guild,
  guildId,
  action: 'tickets.transcript.downloaded',
  source: AuditSource.Dashboard,
  actorId: userId,
  actorType: AuditActorType.User,
  targetType: 'ticket',
  targetId: ticketId,
  channelId: null,
  correlationId,
  causationId: null,
  summary: 'audit:actions.tickets.transcript.downloaded',
  metadata: { size },
  before: null,
  after: null,
  occurredAt: new Date(),
});
```

## REST API (`/api/v1/audit`)

| Method | Path | Claim |
|--------|------|-------|
| GET | `/entries` | `audit.read` |
| GET | `/global` | `audit.read.global` |
| GET | `/correlations/:correlationId` | `audit.read` |
| GET | `/verify` | `audit.verify` |
| POST | `/export` (streams json/ndjson/csv) | `audit.export` |
| GET/PUT | `/retention` | `audit.retention.manage` |
| GET | `/health` | `audit.read` |

No create/update/delete endpoints exist by design. Query, verify, and export
are themselves audited (meta-audit). Dashboard panel:
`app/g/[guildId]/audit` (explorer, correlation trace, integrity widget,
export dialog, retention settings).

## Guarantees

- **Append-only**: no code path updates or hard-deletes an entry outside the
  retention job; the row has no `updatedAt`/`deletedAt`.
- **Tamper-evident**: `hash = sha256(canonicalJson(content + seq + previousHash))`;
  `verifyChain` walks the chain and pinpoints `firstBrokenSeq`. A broken chain
  emits `audit.chain.broken` (error-level log + Prometheus counter).
- **Retention**: daily sweep (cron `AUDIT_RETENTION_CRON`) prunes only a
  contiguous chain prefix past `retentionDays`, archiving it first
  (`archiveBeforeDelete`) to `AUDIT_ARCHIVE_DIR` and anchoring the surviving
  chain at the archive's `rootHash` (row in `audit_archives`).
- **Redaction**: metadata keys in `redactMetadataKeys` are replaced with
  `[REDACTED]` (deep, case-insensitive) before persist.
- **Recursion-proof**: `audit.entry.recorded` is hard deny-listed.

## Configuration (ENV → DB → defaults)

| ENV | Default | Meaning |
|-----|---------|---------|
| `AUDIT_INGEST_ENABLED` | `true` | Master switch for the sink |
| `AUDIT_INGEST_CONCURRENCY` | `4` | Worker concurrency |
| `AUDIT_HASH_ALGORITHM` | `sha256` | `sha256` or `sha512` (global only) |
| `AUDIT_DENY_ACTION_PREFIXES` | `audit.entry.recorded,system.heartbeat,cache.hit` | Skipped actions (prefix match) |
| `AUDIT_REDACT_METADATA_KEYS` | `password,token,secret,authorization` | Redacted keys |
| `AUDIT_RETENTION_DAYS` | `365` | Per-guild overridable (30–3650) |
| `AUDIT_ARCHIVE_BEFORE_DELETE` | `true` | Per-guild overridable |
| `AUDIT_ARCHIVE_FORMAT` | `ndjson` | `json`/`ndjson`/`csv` |
| `AUDIT_ARCHIVE_DIR` | `/srv/bots/armstrong/audit-archives` | Local archive root |
| `AUDIT_RETENTION_CRON` | `0 4 * * *` | Sweep schedule |
| `AUDIT_MAX_PAGE_SIZE` | `100` | Query clamp |
| `AUDIT_QUERY_CACHE_TTL_SECONDS` | `15` | Read-path cache (0 disables) |

Per-guild overrides live in `GuildConfig.settings.audit`
(`retentionDays`, `archiveBeforeDelete`, `archiveFormat`, `denyActionPrefixes`),
editable via `PUT /api/v1/audit/retention` or the dashboard.

## Events emitted

| Event | When |
|-------|------|
| `audit.entry.recorded` | After each persist (never re-audited) |
| `audit.chain.verified` | After each verification |
| `audit.chain.broken` | Verification found tampering — wire to alerting |
| `audit.retention.archived` | Segment archived + pruned |
| `audit.export.requested` | Export started |

## Layout

```
config/           Zod schemas + ENV/DB/defaults resolution
domain/           chain hashing/verification, retention policy, models
infrastructure/   Prisma repository, BullMQ queue, archive store, serialisers
application/      AuditPublicApi impl (query/verify/export) + ingest pipeline
events/           bus tap consumer, emitter, event contracts
jobs/             BullMQ worker (ingest drain + retention sweep)
api/              REST controller + DTOs
observability/    Prometheus registry + OTel spans
```

## Notes & deferrals

- The core Event Bus has no wildcard subscription; this module's "global
  sink" is implemented via the (new) `EventBus.tap()` observer — see spec
  §17b for the rationale.
- Ledger delivery is effectively exactly-once in normal operation (enqueue
  dedup by envelope id + unique hash); a worker crash between insert and ack
  can, in the worst case, produce one duplicate-attempt that the unique
  constraints reject — at-least-once, never lossy.
- Archives are written to the local filesystem; S3/GCS backends and Merkle
  anchoring are future extensions (spec §15).
- The scheduler/storage observability adapters (`SchedulerAuditService`,
  `StorageAuditService`) still log via Pino only; absorbing them into this
  ledger means touching those modules and is deferred to a follow-up.
- Integration (live MySQL/Redis) and Playwright e2e suites follow the
  Phase 2–4 deferral; run `prisma migrate deploy` when the DB is up.
