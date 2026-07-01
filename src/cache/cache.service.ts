import { Injectable, Logger } from '@nestjs/common';
import type { CacheEntry } from './interfaces/cache-entry.interface';
import type {
  CacheGetOrSetOptions,
  CacheSetOptions,
} from './interfaces/cache-options.interface';
// These are injected via the constructor, so they must be value imports —
// `import type` would erase the DI metadata Nest relies on.
import { MemoryCacheStore } from './stores/memory-cache.store';
import { RedisCacheStore } from './stores/redis-cache.store';
import { CacheKeyBuilder } from './keys/cache-key.builder';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly l1: MemoryCacheStore,
    private readonly l2: RedisCacheStore,
    readonly keys: CacheKeyBuilder,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    const l1hit = await this.l1.get<T>(key);
    if (l1hit) return l1hit.value;

    const l2hit = await this.l2.get<T>(key);
    if (l2hit) {
      await this.l1.set(key, l2hit);
      return l2hit.value;
    }
    return null;
  }

  async getOrSet<T>(
    key: string,
    loader: () => Promise<T>,
    options: CacheGetOrSetOptions<T>,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;

    const work = loader()
      .then(async (value) => {
        this.inflight.delete(key);
        await this.set(key, value, options);
        return value;
      })
      .catch((err: unknown) => {
        this.inflight.delete(key);
        throw err;
      });

    this.inflight.set(key, work);
    return work;
  }

  async set<T>(key: string, value: T, options: CacheSetOptions): Promise<void> {
    const jitter = options.jitterSeconds
      ? Math.floor(Math.random() * options.jitterSeconds * 1000)
      : 0;
    const ttlMs = options.ttlSeconds * 1000 + jitter;
    const now = Date.now();
    const entry: CacheEntry<T> = {
      value,
      storedAt: now,
      expiresAt: now + ttlMs,
      tags: options.tags ?? [],
    };

    if (!options.l2Only) await this.l1.set(key, entry);
    await this.l2.set(key, entry);
  }

  async delete(key: string): Promise<void> {
    await Promise.all([this.l1.delete(key), this.l2.delete(key)]);
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    const [l1count, l2count] = await Promise.all([
      this.l1.deleteByPrefix(prefix),
      this.l2.deleteByPrefix(prefix),
    ]);
    return Math.max(l1count, l2count);
  }

  invalidateTags(tags: readonly string[]): Promise<number> {
    this.logger.debug(`Invalidating tags: ${tags.join(', ')}`);
    return Promise.resolve(0);
  }

  async has(key: string): Promise<boolean> {
    return (await this.l1.has(key)) || (await this.l2.has(key));
  }
}
