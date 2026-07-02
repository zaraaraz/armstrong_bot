import { beforeEach, describe, expect, it } from 'vitest';
import { IdempotencyGuard } from './idempotency.guard';
import type { CacheService } from '../../../cache/cache.service';

/** Minimal in-memory cache honouring has/set/delete + key builders. */
class FakeCache {
  store = new Set<string>();
  keys = {
    forGuild: (...p: string[]) => `guild:${p.join(':')}`,
    forGlobal: (...p: string[]) => `global:${p.join(':')}`,
  };
  has(key: string): Promise<boolean> {
    return Promise.resolve(this.store.has(key));
  }
  set(key: string): Promise<void> {
    this.store.add(key);
    return Promise.resolve();
  }
  delete(key: string): Promise<void> {
    this.store.delete(key);
    return Promise.resolve();
  }
}

describe('IdempotencyGuard', () => {
  let cache: FakeCache;
  let guard: IdempotencyGuard;

  beforeEach(() => {
    cache = new FakeCache();
    guard = new IdempotencyGuard(cache as unknown as CacheService);
  });

  it('claims a fresh key, then rejects a repeat within the window', async () => {
    expect(await guard.claim('g1', 'delivery-1', 3600)).toBe(true);
    expect(await guard.claim('g1', 'delivery-1', 3600)).toBe(false);
  });

  it('scopes claims per guild (same deliveryId, different guilds both proceed)', async () => {
    expect(await guard.claim('g1', 'delivery-1', 3600)).toBe(true);
    expect(await guard.claim('g2', 'delivery-1', 3600)).toBe(true);
  });

  it('uses a global key when guildId is null (distinct from per-guild keys)', async () => {
    expect(await guard.claim(null, 'delivery-1', 3600)).toBe(true);
    // A per-guild claim with the same deliveryId is a different key, so it also proceeds.
    expect(await guard.claim('g1', 'delivery-1', 3600)).toBe(true);
    // Re-claiming the global key is rejected within the window.
    expect(await guard.claim(null, 'delivery-1', 3600)).toBe(false);
  });

  it('a zero TTL disables deduplication (always proceeds)', async () => {
    expect(await guard.claim('g1', 'delivery-1', 0)).toBe(true);
    expect(await guard.claim('g1', 'delivery-1', 0)).toBe(true);
  });

  it('a negative TTL disables deduplication and never touches the cache', async () => {
    expect(await guard.claim('g1', 'delivery-1', -1)).toBe(true);
    expect(await guard.claim('g1', 'delivery-1', -1)).toBe(true);
    expect(cache.store.size).toBe(0);
  });

  it('release frees a claimed key so the next claim proceeds (per-guild)', async () => {
    expect(await guard.claim('g1', 'delivery-1', 3600)).toBe(true);
    await guard.release('g1', 'delivery-1');
    expect(await guard.claim('g1', 'delivery-1', 3600)).toBe(true);
  });

  it('release frees a claimed key so the next claim proceeds (global)', async () => {
    expect(await guard.claim(null, 'delivery-1', 3600)).toBe(true);
    await guard.release(null, 'delivery-1');
    expect(await guard.claim(null, 'delivery-1', 3600)).toBe(true);
  });
});
