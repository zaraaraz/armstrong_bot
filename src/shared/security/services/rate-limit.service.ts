import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type {
  IRateLimitService,
  RateLimitOptions,
  RateLimitResult,
} from '../interfaces/security.interfaces';

/** Token exported by CacheModule for the shared ioredis client. */
export const REDIS_CLIENT = 'REDIS_CLIENT';

const KEY_PREFIX = 'security:ratelimit';
const BLOCK_PREFIX = 'security:ratelimit:block';

/**
 * Redis-backed sliding-window rate limiter using a per-subject sorted set of
 * request timestamps. Each `consume` trims entries older than the window,
 * counts what remains, and admits or rejects. Optional `blockFor` puts an
 * exhausted subject into a hard block for N seconds.
 */
@Injectable()
export class RateLimitService implements IRateLimitService {
  private readonly logger = new Logger(RateLimitService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async consume(
    key: string,
    options: RateLimitOptions,
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const windowMs = options.duration * 1000;
    const setKey = `${KEY_PREFIX}:${key}`;
    const blockKey = `${BLOCK_PREFIX}:${key}`;

    const blockTtl = await this.redis.pttl(blockKey);
    if (blockTtl > 0) {
      return { allowed: false, remaining: 0, retryAfterMs: blockTtl };
    }

    // Drop expired entries, then read the current window count.
    await this.redis.zremrangebyscore(setKey, 0, now - windowMs);
    const count = await this.redis.zcard(setKey);

    if (count >= options.points) {
      const oldest = await this.redis.zrange(setKey, 0, 0, 'WITHSCORES');
      const oldestTs = oldest.length === 2 ? Number(oldest[1]) : now;
      const retryAfterMs = Math.max(1, oldestTs + windowMs - now);

      if (options.blockFor && options.blockFor > 0) {
        await this.redis.set(blockKey, '1', 'PX', options.blockFor * 1000);
        return {
          allowed: false,
          remaining: 0,
          retryAfterMs: options.blockFor * 1000,
        };
      }
      return { allowed: false, remaining: 0, retryAfterMs };
    }

    // Admit: record this hit and expire the set after the window.
    const member = `${now}-${Math.floor(Math.random() * 1e9)}`;
    await this.redis.zadd(setKey, now, member);
    await this.redis.pexpire(setKey, windowMs);

    return {
      allowed: true,
      remaining: Math.max(0, options.points - count - 1),
      retryAfterMs: 0,
    };
  }

  async reset(key: string): Promise<void> {
    await Promise.all([
      this.redis.del(`${KEY_PREFIX}:${key}`),
      this.redis.del(`${BLOCK_PREFIX}:${key}`),
    ]);
  }
}
