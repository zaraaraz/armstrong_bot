import { Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { CacheEntry } from '../interfaces/cache-entry.interface';
import type { ICacheStore } from '../interfaces/cache-store.interface';

@Injectable()
export class RedisCacheStore implements ICacheStore {
  private readonly logger = new Logger(RedisCacheStore.name);

  constructor(private readonly redis: Redis) {}

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as CacheEntry<T>;
    } catch (err) {
      this.logger.error(`Redis get error for key "${key}"`, err);
      return null;
    }
  }

  async set<T>(key: string, entry: CacheEntry<T>): Promise<void> {
    try {
      const ttlMs = entry.expiresAt - Date.now();
      if (ttlMs <= 0) return;
      await this.redis.set(key, JSON.stringify(entry), 'PX', ttlMs);
    } catch (err) {
      this.logger.error(`Redis set error for key "${key}"`, err);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (err) {
      this.logger.error(`Redis delete error for key "${key}"`, err);
    }
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    try {
      const keys = await this.redis.keys(`${prefix}*`);
      if (keys.length === 0) return 0;
      await this.redis.del(...keys);
      return keys.length;
    } catch (err) {
      this.logger.error(
        `Redis deleteByPrefix error for prefix "${prefix}"`,
        err,
      );
      return 0;
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      return (await this.redis.exists(key)) === 1;
    } catch {
      return false;
    }
  }
}
