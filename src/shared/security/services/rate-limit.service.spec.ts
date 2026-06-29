import type { Redis } from 'ioredis';
import { RateLimitService } from './rate-limit.service';
import type { RateLimitOptions } from '../interfaces/security.interfaces';

/** Minimal in-memory fake covering the sorted-set + TTL ops the service uses. */
class FakeRedis {
  private sets = new Map<string, Array<{ score: number; member: string }>>();
  private strings = new Map<string, { value: string; expireAt: number }>();

  pttl(key: string): Promise<number> {
    const entry = this.strings.get(key);
    if (!entry) return Promise.resolve(-2);
    const left = entry.expireAt - Date.now();
    return Promise.resolve(left > 0 ? left : -2);
  }

  zremrangebyscore(key: string, min: number, max: number): Promise<number> {
    const set = this.sets.get(key) ?? [];
    const kept = set.filter((e) => e.score < min || e.score > max);
    this.sets.set(key, kept);
    return Promise.resolve(set.length - kept.length);
  }

  zcard(key: string): Promise<number> {
    return Promise.resolve((this.sets.get(key) ?? []).length);
  }

  zrange(key: string, start: number, stop: number): Promise<string[]> {
    const set = [...(this.sets.get(key) ?? [])].sort(
      (a, b) => a.score - b.score,
    );
    const slice = set.slice(start, stop + 1);
    return Promise.resolve(slice.flatMap((e) => [e.member, String(e.score)]));
  }

  zadd(key: string, score: number, member: string): Promise<number> {
    const set = this.sets.get(key) ?? [];
    set.push({ score, member });
    this.sets.set(key, set);
    return Promise.resolve(1);
  }

  pexpire(): Promise<number> {
    return Promise.resolve(1);
  }

  set(key: string, value: string, _mode: string, ms: number): Promise<'OK'> {
    this.strings.set(key, { value, expireAt: Date.now() + ms });
    return Promise.resolve('OK');
  }

  del(key: string): Promise<number> {
    const had = this.sets.delete(key) || this.strings.delete(key);
    return Promise.resolve(had ? 1 : 0);
  }
}

const opts = (over: Partial<RateLimitOptions> = {}): RateLimitOptions => ({
  points: 3,
  duration: 60,
  by: 'ip',
  ...over,
});

describe('RateLimitService', () => {
  let svc: RateLimitService;

  beforeEach(() => {
    svc = new RateLimitService(new FakeRedis() as unknown as Redis);
  });

  it('admits requests up to the limit, then rejects', async () => {
    const r1 = await svc.consume('k', opts());
    await svc.consume('k', opts());
    const r3 = await svc.consume('k', opts());
    const r4 = await svc.consume('k', opts());

    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);
    expect(r3.allowed).toBe(true);
    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
    expect(r4.retryAfterMs).toBeGreaterThan(0);
  });

  it('applies a hard block once exhausted with blockFor', async () => {
    const o = opts({ points: 1, blockFor: 300 });
    await svc.consume('blk', o);
    const blocked = await svc.consume('blk', o);

    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(300_000);

    // Still blocked on the next call (block key set).
    const stillBlocked = await svc.consume('blk', o);
    expect(stillBlocked.allowed).toBe(false);
  });

  it('reset clears the window', async () => {
    const o = opts({ points: 1 });
    await svc.consume('r', o);
    expect((await svc.consume('r', o)).allowed).toBe(false);

    await svc.reset('r');
    expect((await svc.consume('r', o)).allowed).toBe(true);
  });
});
