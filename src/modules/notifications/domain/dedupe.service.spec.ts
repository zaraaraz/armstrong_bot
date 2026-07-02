import { beforeEach, describe, expect, it } from 'vitest';
import { DedupeService } from './dedupe.service';
import type { CacheService } from '../../../cache/cache.service';

/** Minimal in-memory cache honouring has/set/delete. */
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

describe('DedupeService', () => {
  let cache: FakeCache;
  let dedupe: DedupeService;

  beforeEach(() => {
    cache = new FakeCache();
    dedupe = new DedupeService(cache as unknown as CacheService);
  });

  it('claims a fresh key, then rejects a repeat within the window', async () => {
    expect(await dedupe.claim('g1', 'evt-1', 3600)).toBe(true);
    expect(await dedupe.claim('g1', 'evt-1', 3600)).toBe(false);
  });

  it('scopes keys per guild (no cross-guild collision)', async () => {
    expect(await dedupe.claim('g1', 'evt-1', 3600)).toBe(true);
    expect(await dedupe.claim('g2', 'evt-1', 3600)).toBe(true);
  });

  it('a zero TTL disables deduplication (always proceeds)', async () => {
    expect(await dedupe.claim('g1', 'evt-1', 0)).toBe(true);
    expect(await dedupe.claim('g1', 'evt-1', 0)).toBe(true);
  });

  it('release frees a claimed key', async () => {
    expect(await dedupe.claim(null, 'evt-1', 3600)).toBe(true);
    await dedupe.release(null, 'evt-1');
    expect(await dedupe.claim(null, 'evt-1', 3600)).toBe(true);
  });
});
