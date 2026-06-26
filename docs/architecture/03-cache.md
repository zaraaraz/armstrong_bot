# Cache

> ## Claude Instructions
> - Never modify another module. Do not change architecture decisions from `00-project.md`.
> - This is a CORE system. No module may import `ioredis` / the Redis client directly — everything goes through `CacheService`.
> - Keep backwards compatibility. Create Prisma migrations for any schema additions. Generate tests and docs.
> - Generate DTOs. Use Repository Pattern for any persisted state. Use the Event Bus for invalidation. Use Dependency Injection everywhere.
> - No `any`. Keep methods small (<50 lines where reasonable). Follow existing naming conventions.
> - Keys are ALWAYS namespaced (`guild:<id>:<ns>:<key>` or `global:<ns>:<key>`). Never hand-build raw keys outside the `CacheKeyBuilder`.
> - Implement stampede protection (single-flight + lock). Support tag-based and event-driven invalidation. Support pagination-friendly caching.

---

## 1. Purpose

The Cache core system provides a single, type-safe abstraction (`CacheService`) over a two-tier cache:
an in-process LRU layer (L1) and a shared Redis layer (L2). It is the **only** sanctioned path to Redis
for caching concerns. It exists to:

- Remove direct Redis coupling from every feature module.
- Guarantee consistent, collision-free, **guild-aware** key namespacing.
- Provide cache-aside and write-through patterns with TTL, jitter, and stampede protection.
- Offer tag-based and event-driven invalidation so domain changes purge the right entries.
- Provide ergonomic developer APIs (`@Cacheable`, `@CacheEvict`, `@CachePut`) on Application Services.

This document is the contract for `src/core/cache`.

## 2. Goals

- **Single entry point**: every read/write/invalidation flows through `CacheService`.
- **Two tiers**: L1 (memory LRU, per-process, microsecond reads) + L2 (Redis, shared, cross-instance).
- **Coherence**: L1 entries are invalidated cross-process via a Redis pub/sub invalidation channel.
- **Namespacing**: enforced `guild:<id>:<ns>:<key>` / `global:<ns>:<key>` keys, built only by `CacheKeyBuilder`.
- **Stampede protection**: single-flight per key + distributed lock so only one loader runs on a miss.
- **Invalidation**: by exact key, by prefix/namespace, by tag set, and by subscribing to domain events.
- **TTL discipline**: every cached value has a TTL; jitter avoids synchronized expiry.
- **Observability**: hit/miss/evict counters per namespace, exposed to Prometheus and logs.
- **Strictness**: no `any`, fully generic typed get/set, Zod-validated cache config.

## 3. Architecture

The Cache system is a NestJS global module (`CacheModule`) living in `src/core`. It sits beneath the
Application Service layer and never knows about domain logic.

```
Controller -> Application Service -> [Cache decorators / CacheService] -> Repository -> Database
                                              |
                                     +--------+--------+
                                     |                 |
                                 L1 (LRU)          L2 (Redis)
                                     |                 |
                                     +---- pub/sub invalidation channel ----+
```

Key collaborators:

- `CacheService` — public facade. Implements cache-aside (`getOrSet`), write-through (`set`), eviction.
- `MemoryCacheStore` (L1) — wraps an LRU with size + TTL bounds, per namespace stats.
- `RedisCacheStore` (L2) — wraps the shared Redis client (owned by `RedisModule`), serialization, TTL.
- `CacheKeyBuilder` — the ONLY thing that constructs keys; enforces the namespace grammar.
- `CacheLockManager` — distributed lock (Redis `SET NX PX`) + in-process single-flight map for stampede protection.
- `CacheInvalidationService` — listens to the Event Bus and to the Redis invalidation pub/sub channel; evicts by key/prefix/tag.
- `CacheTagIndex` — maps tags -> key sets in Redis (`SADD`/`SMEMBERS`) for tag-based invalidation.
- Decorators (`@Cacheable`, `@CacheEvict`, `@CachePut`) + a `CacheInterceptor` resolving them at call time.

Write strategy: **cache-aside** is the default for reads (`getOrSet`). Writes use **write-through**
(`set` updates both tiers) and emit invalidation so other processes drop stale L1 entries.

## 4. Folder Structure

```
src/core/cache/
├── cache.module.ts
├── cache.constants.ts            # channel names, default TTLs, DI tokens
├── cache.service.ts              # public facade (implements ICacheService)
├── interfaces/
│   ├── cache-service.interface.ts
│   ├── cache-store.interface.ts
│   ├── cache-entry.interface.ts
│   └── cache-options.interface.ts
├── stores/
│   ├── memory-cache.store.ts     # L1 LRU
│   └── redis-cache.store.ts      # L2 Redis
├── keys/
│   ├── cache-key.builder.ts
│   └── cache-namespace.enum.ts
├── lock/
│   └── cache-lock.manager.ts     # distributed lock + single-flight
├── invalidation/
│   ├── cache-invalidation.service.ts
│   ├── cache-tag.index.ts
│   └── invalidation-message.dto.ts
├── decorators/
│   ├── cacheable.decorator.ts
│   ├── cache-evict.decorator.ts
│   ├── cache-put.decorator.ts
│   └── cache-metadata.ts
├── interceptors/
│   └── cache.interceptor.ts
├── metrics/
│   └── cache.metrics.ts          # Prometheus counters/gauges
├── config/
│   └── cache.config.ts           # Zod schema + loader
└── serialization/
    └── cache-serializer.ts       # JSON + optional compression
```

## 5. Public Interfaces

```typescript
// interfaces/cache-options.interface.ts
export interface CacheGetOrSetOptions<T> {
  /** Time-to-live in seconds. Required — no infinite caches. */
  readonly ttlSeconds: number;
  /** Random extra TTL (0..jitterSeconds) added to avoid synchronized expiry. */
  readonly jitterSeconds?: number;
  /** Tags this entry belongs to; used for tag-based invalidation. */
  readonly tags?: readonly string[];
  /** When true, skip L1 and read/write only L2 (e.g. very large values). */
  readonly l2Only?: boolean;
  /** Optional runtime validator (Zod parse) applied to loaded/deserialized values. */
  readonly validate?: (value: unknown) => T;
}

export interface CacheSetOptions {
  readonly ttlSeconds: number;
  readonly jitterSeconds?: number;
  readonly tags?: readonly string[];
  readonly l2Only?: boolean;
}

// interfaces/cache-entry.interface.ts
export interface CacheEntry<T> {
  readonly value: T;
  readonly storedAt: number; // epoch ms
  readonly expiresAt: number; // epoch ms
  readonly tags: readonly string[];
}

// interfaces/cache-service.interface.ts
export interface ICacheService {
  /** Read a value; returns null on miss. Checks L1 then L2 (and back-fills L1). */
  get<T>(key: string): Promise<T | null>;

  /** Cache-aside read. On miss, runs `loader` under stampede protection, stores result. */
  getOrSet<T>(
    key: string,
    loader: () => Promise<T>,
    options: CacheGetOrSetOptions<T>,
  ): Promise<T>;

  /** Write-through: store in L1 + L2, register tags, broadcast invalidation. */
  set<T>(key: string, value: T, options: CacheSetOptions): Promise<void>;

  /** Evict exact key from both tiers + broadcast. */
  delete(key: string): Promise<void>;

  /** Evict all keys under a key prefix (namespace) from both tiers + broadcast. */
  deleteByPrefix(prefix: string): Promise<number>;

  /** Evict every key registered under any of the given tags. */
  invalidateTags(tags: readonly string[]): Promise<number>;

  /** True if key exists in either tier (no value transfer). */
  has(key: string): Promise<boolean>;

  /** Build a namespaced key. Delegates to CacheKeyBuilder. */
  readonly keys: ICacheKeyBuilder;
}

// keys/cache-key.builder.ts
export interface ICacheKeyBuilder {
  /** guild:<guildId>:<namespace>:<...parts> */
  forGuild(guildId: string, namespace: CacheNamespace, ...parts: readonly string[]): string;
  /** global:<namespace>:<...parts> */
  forGlobal(namespace: CacheNamespace, ...parts: readonly string[]): string;
  /** Prefix matching every key in a guild namespace: guild:<guildId>:<namespace>:* */
  guildNamespacePrefix(guildId: string, namespace: CacheNamespace): string;
}

// interfaces/cache-store.interface.ts — implemented by both L1 and L2 stores
export interface ICacheStore {
  get<T>(key: string): Promise<CacheEntry<T> | null>;
  set<T>(key: string, entry: CacheEntry<T>): Promise<void>;
  delete(key: string): Promise<void>;
  deleteByPrefix(prefix: string): Promise<number>;
  has(key: string): Promise<boolean>;
}

// lock/cache-lock.manager.ts
export interface ICacheLockManager {
  /** Runs `fn` exactly once per key across the cluster; others await the result/refresh. */
  runSingleFlight<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T>;
}
```

## 6. Events

Cache is event-driven for invalidation. It **consumes** domain events to evict stale entries and
**emits** internal cache lifecycle events for observability. It also uses a private Redis pub/sub
channel (`cache:invalidate`) for cross-process L1 coherence — that channel is internal, not the Event Bus.

### Consumed (Event Bus)

| Event | Payload | Reaction |
|-------|---------|----------|
| `entity.updated` | `{ guildId: string; namespace: string; entityId: string; tags?: string[] }` | `invalidateTags` / `delete` the affected keys |
| `entity.deleted` | `{ guildId: string; namespace: string; entityId: string }` | `deleteByPrefix` for the entity namespace |
| `guild.removed` | `{ guildId: string }` | `deleteByPrefix(guild:<id>:*)` — full guild purge |
| `config.changed` | `{ guildId: string \| null; key: string }` | Evict config namespace for that scope |

### Emitted (Event Bus, observability-only)

```typescript
export interface CacheInvalidatedEvent {
  readonly scope: 'key' | 'prefix' | 'tags';
  readonly target: string; // key, prefix, or comma-joined tags
  readonly guildId: string | null;
  readonly evictedCount: number;
  readonly at: number;
}
```

### Internal pub/sub message (`cache:invalidate` channel)

```typescript
// invalidation/invalidation-message.dto.ts
export interface InvalidationMessageDto {
  readonly originInstanceId: string; // ignore messages from self
  readonly mode: 'key' | 'prefix' | 'tags';
  readonly payload: string; // key, prefix, or JSON-encoded tag list
}
```

## 7. Dependencies

Cache relies ONLY on CORE systems and infrastructure — never on feature modules.

| Dependency | Use |
|------------|-----|
| Redis (via `RedisModule`) | L2 store, tag index, distributed lock, pub/sub invalidation channel |
| Event Bus (core) | Consume domain invalidation events; emit `CacheInvalidatedEvent` |
| Config (core) | Load Zod-validated cache config (ENV -> DB -> defaults) |
| Logger (Pino, core) | Structured logs under category `cache` |
| Metrics (Prometheus, core) | Hit/miss/evict counters and gauges |
| OpenTelemetry (core) | Spans around L2 ops and loader execution |

It does **not** depend on Prisma directly for caching (state lives in Redis/memory). The optional
`CacheConfig` persisted overrides are read via the Config core system's repository, not by Cache itself.

## 8. Configuration

Config follows `ENV -> Database -> Defaults`, validated with Zod. Global settings tune the tiers;
guild-scoped overrides may adjust default TTL multipliers.

```typescript
// config/cache.config.ts
import { z } from 'zod';

export const cacheConfigSchema = z.object({
  redisKeyPrefix: z.string().min(1).default('ghost'),
  memory: z.object({
    maxItems: z.number().int().positive().default(10_000),
    maxBytes: z.number().int().positive().default(64 * 1024 * 1024),
    defaultTtlSeconds: z.number().int().positive().default(60),
  }),
  redis: z.object({
    defaultTtlSeconds: z.number().int().positive().default(300),
    jitterSeconds: z.number().int().nonnegative().default(15),
  }),
  lock: z.object({
    ttlMs: z.number().int().positive().default(5_000),
    waitMs: z.number().int().positive().default(3_000),
    retryDelayMs: z.number().int().positive().default(50),
  }),
  compression: z.object({
    enabled: z.boolean().default(true),
    thresholdBytes: z.number().int().positive().default(8 * 1024),
  }),
  invalidationChannel: z.string().min(1).default('cache:invalidate'),
});

export type CacheConfig = z.infer<typeof cacheConfigSchema>;
```

Guild-scoped overrides (optional, persisted via Config core):

```typescript
export const guildCacheOverrideSchema = z.object({
  guildId: z.string(),
  ttlMultiplier: z.number().min(0.1).max(10).default(1),
  disabled: z.boolean().default(false), // bypass cache for a guild (debugging)
});
```

## 9. Database

Cache state lives in Redis/memory and needs no tables. One optional table persists per-guild
overrides so they survive restarts and are editable from the dashboard. Soft-delete via `deletedAt`.

```prisma
model CacheSetting {
  id            String    @id @default(cuid())
  guildId       String?   // null = global override
  ttlMultiplier Float     @default(1)
  disabled      Boolean   @default(false)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  deletedAt     DateTime?

  @@unique([guildId])
  @@index([guildId])
  @@index([deletedAt])
}
```

Notes:
- No cached payloads are ever stored in MySQL.
- `@@unique([guildId])` allows at most one override row per guild (and one global with `null`).
- Reads of `CacheSetting` go through the Config core repository; Cache never touches Prisma directly.

## 10. API

Admin/diagnostic endpoints under `/api/v1/cache`, guarded by permissions. All responses use DTOs;
Swagger-documented. No WebSocket needed.

| Method | Path | Body / Query | Description |
|--------|------|--------------|-------------|
| GET | `/api/v1/cache/stats` | `?guildId=` | Per-namespace hit/miss/evict counters + L1 size |
| POST | `/api/v1/cache/invalidate` | `InvalidateCacheDto` | Evict by key / prefix / tags |
| GET | `/api/v1/cache/settings/:guildId` | — | Get guild cache override |
| PUT | `/api/v1/cache/settings/:guildId` | `UpdateCacheSettingDto` | Upsert guild override |

```typescript
export class InvalidateCacheDto {
  /** Exactly one of key/prefix/tags must be provided. */
  readonly key?: string;
  readonly prefix?: string;
  readonly tags?: readonly string[];
}

export class UpdateCacheSettingDto {
  readonly ttlMultiplier!: number; // 0.1..10
  readonly disabled!: boolean;
}

export class CacheStatsDto {
  readonly namespace!: string;
  readonly hits!: number;
  readonly misses!: number;
  readonly evictions!: number;
  readonly l1Items!: number;
}
```

Endpoints are paginated where they return lists (stats per namespace) via the shared pagination DTO.

## 11. Permissions

Wildcard-friendly claims defined by this unit:

| Claim | Allows |
|-------|--------|
| `cache.stats.read` | View `/cache/stats` |
| `cache.invalidate` | Trigger manual invalidation |
| `cache.settings.read` | Read guild cache overrides |
| `cache.settings.write` | Update guild cache overrides |
| `cache.*` | All cache admin operations |

These are administrative; cache reads/writes performed internally by other modules require no claim
(they are server-side). Invalidation events from modules are trusted in-process.

## 12. Logging

Pino, category `cache`, with structured fields. Never log full cached payloads (size only).

- **Debug**: every `getOrSet` miss with `{ key, namespace, ttl, loaderMs }`; L1 back-fill.
- **Info**: manual invalidation `{ scope, target, evictedCount, actorId }`; config reload.
- **Warn**: lock contention timeouts `{ key, waitedMs }`; serialization fallbacks; compression skips.
- **Error**: Redis connection failures (with degraded-to-L1 notice); deserialization failures.
- **Audit hooks**: every API-triggered invalidation and every `settings` change emits an audit event
  (via the Audit core) with `actorId`, `guildId`, target, and result.

Metrics emitted alongside logs: `cache_hits_total`, `cache_misses_total`, `cache_evictions_total`
(all labelled by `namespace`, `tier`), `cache_loader_duration_seconds`, `cache_l1_items`.

## 13. Testing

Vitest for unit/integration; Playwright only for the dashboard surface.

- **Unit**
  - `CacheKeyBuilder`: grammar for guild/global keys and prefixes; rejects empty parts.
  - `MemoryCacheStore`: LRU eviction at `maxItems`/`maxBytes`, TTL expiry, stats counters.
  - `CacheSerializer`: round-trip JSON, compression above/below threshold, validate hook.
  - `CacheLockManager`: single-flight runs loader once under concurrency (fake timers).
  - Decorators: `@Cacheable` key derivation from args, `@CacheEvict` tag/prefix resolution.
- **Integration** (real Redis via testcontainers)
  - `getOrSet` cache-aside hit/miss/back-fill across L1+L2.
  - Tag index: `invalidateTags` removes exactly the tagged keys.
  - Cross-process L1 coherence: process A `set`, process B sees pub/sub eviction.
  - Stampede: N concurrent `getOrSet` on a cold key -> loader called once.
  - Event-driven: `guild.removed` purges `guild:<id>:*`.
- **E2E** (Playwright): dashboard stats panel renders; manual invalidate button works with permission gating.
- Coverage target: lines/branches >= 90% for `src/core/cache`. Loader errors must propagate (not cache nulls).

## 14. Dashboard Integration

Under `dashboard/admin/cache` (requires `cache.stats.read`):

- **Stats panel**: live per-namespace hit/miss ratio, L1 item count, eviction rate (polls `/cache/stats`).
- **Invalidate tool**: form to evict by key / prefix / tag (requires `cache.invalidate`).
- **Guild overrides**: edit `ttlMultiplier` and `disabled` per guild (requires `cache.settings.write`).
- All labels are i18n (PT primary, EN secondary), namespace `cache`, with plural/variable interpolation
  for counts (e.g. `{count} entries evicted`).

## 15. Future Extensions

- Near-cache warming on startup for hot namespaces.
- Redis Cluster / sharded key slots support.
- Probabilistic early recomputation (XFetch) instead of plain jitter.
- Per-namespace adaptive TTL based on hit ratio telemetry.
- Optional second serializer (MessagePack) behind the `CacheSerializer` interface.
- Read-through repository wrapper so any repo can opt into caching declaratively.

## 16. Tasks for Claude

1. **Schema**: add `CacheSetting` model + Prisma migration; wire to Config core repository.
2. **Config**: implement `cacheConfigSchema`, `guildCacheOverrideSchema`, loader (ENV -> DB -> defaults).
3. **Keys**: implement `CacheNamespace` enum and `CacheKeyBuilder` with full unit tests.
4. **Stores**: implement `MemoryCacheStore` (LRU) and `RedisCacheStore` (serialization + TTL + prefix delete).
5. **Serialization**: implement `CacheSerializer` (JSON + gzip threshold) + validate hook.
6. **Lock**: implement `CacheLockManager` (Redis `SET NX PX` + in-process single-flight map).
7. **Service**: implement `CacheService` (`get`, `getOrSet`, `set`, `delete`, `deleteByPrefix`, `invalidateTags`).
8. **Tags**: implement `CacheTagIndex` (Redis sets) + tag invalidation path.
9. **Events**: implement `CacheInvalidationService` — subscribe to Event Bus events + Redis pub/sub; emit `CacheInvalidatedEvent`.
10. **Decorators**: implement `@Cacheable`, `@CacheEvict`, `@CachePut` + `CacheInterceptor`.
11. **Metrics**: implement `cache.metrics.ts` Prometheus counters/gauges.
12. **API**: implement controller + DTOs + Swagger for stats/invalidate/settings; guard with permissions.
13. **Dashboard**: stats panel, invalidate tool, guild overrides editor with i18n.
14. **Tests**: unit + integration (testcontainers Redis) + e2e per Section 13.
15. **Docs**: README in `src/core/cache` summarizing the public API and usage examples.

## 17. Acceptance Criteria

- No module imports the Redis client for caching; all caching goes through `CacheService`.
- Every cached key matches `guild:<id>:<ns>:<key>` or `global:<ns>:<key>`; built only by `CacheKeyBuilder`.
- `getOrSet` returns cached values on hit and runs the loader exactly once under concurrency (stampede-safe).
- TTL + jitter applied; entries expire; no entry is cached without a TTL.
- `delete`, `deleteByPrefix`, and `invalidateTags` evict from BOTH tiers and broadcast cross-process.
- Domain events (`entity.updated`, `entity.deleted`, `guild.removed`, `config.changed`) trigger correct eviction.
- Redis outage degrades gracefully to L1 with a warning; never throws to callers for reads.
- Decorators produce correct keys and invalidations; verified by tests.
- API endpoints enforce `cache.*` claims and are Swagger-documented; dashboard panels work and are translated.

## 18. Definition of Done

- All Section 16 tasks complete; all Section 17 criteria verified.
- Vitest unit + integration green; coverage >= 90% for `src/core/cache`; Playwright e2e green.
- Prisma migration created and applied; no drift.
- ESLint/Prettier clean; no `any`; methods within size guidance.
- i18n keys added for PT + EN under namespace `cache`.
- Conventional Commits on a `feature/cache` branch; PR opened against `develop` (never `main`); CI green.
- This document reviewed and merged alongside the implementation.
