import { Injectable } from '@nestjs/common';
import { CacheService } from '../../../cache/cache.service';
import { CacheNamespace } from '../../../cache/keys/cache-namespace.enum';
import { NOTIF_CACHE } from '../notifications.constants';

/**
 * Idempotency guard for dispatch. A caller-supplied `dedupeKey` is claimed in
 * the cache for a configurable TTL; the same key seen again within the window
 * (a bus event replayed, a poll re-firing, a retried enqueue) short-circuits so
 * no duplicate notification is created. Keyed per guild to avoid cross-guild
 * collisions on generic keys.
 */
@Injectable()
export class DedupeService {
  constructor(private readonly cache: CacheService) {}

  /**
   * Atomically claims a dedupe key. Returns `true` if this is the first sighting
   * (caller should proceed) or `false` if it was already claimed (skip). A
   * `ttlSeconds` of 0 disables deduplication (always proceeds).
   */
  async claim(
    guildId: string | null,
    dedupeKey: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    if (ttlSeconds <= 0) return true;
    const key = this.cacheKey(guildId, dedupeKey);
    if (await this.cache.has(key)) return false;
    await this.cache.set(key, true, { ttlSeconds });
    return true;
  }

  /** Releases a previously claimed key (e.g. when the dispatch aborts). */
  async release(guildId: string | null, dedupeKey: string): Promise<void> {
    await this.cache.delete(this.cacheKey(guildId, dedupeKey));
  }

  private cacheKey(guildId: string | null, dedupeKey: string): string {
    return guildId
      ? this.cache.keys.forGuild(
          guildId,
          CacheNamespace.Generic,
          NOTIF_CACHE.Dedupe,
          dedupeKey,
        )
      : this.cache.keys.forGlobal(
          CacheNamespace.Generic,
          NOTIF_CACHE.Dedupe,
          dedupeKey,
        );
  }
}
