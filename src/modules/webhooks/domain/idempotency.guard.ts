import { Injectable } from '@nestjs/common';
import { CacheService } from '../../../cache/cache.service';
import { CacheNamespace } from '../../../cache/keys/cache-namespace.enum';
import { WEBHOOKS_CACHE } from '../webhooks.constants';

/**
 * Inbound idempotency guard. A provider's delivery id is claimed in the cache
 * for a configurable TTL; the same delivery id seen again within the window (a
 * provider re-sending, a replayed request, a retried enqueue) short-circuits so
 * the same webhook is not processed twice. Keyed per guild to avoid cross-guild
 * collisions on generic delivery ids; global/system endpoints use a global key.
 */
@Injectable()
export class IdempotencyGuard {
  constructor(private readonly cache: CacheService) {}

  /**
   * Atomically claims a delivery id. Returns `true` if this is the first
   * sighting (caller should proceed) or `false` if it was already claimed
   * (skip). A `ttlSeconds` of 0 or less disables deduplication (always
   * proceeds).
   */
  async claim(
    guildId: string | null,
    deliveryId: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    if (ttlSeconds <= 0) return true;
    const key = this.cacheKey(guildId, deliveryId);
    if (await this.cache.has(key)) return false;
    await this.cache.set(key, true, { ttlSeconds });
    return true;
  }

  /** Releases a previously claimed delivery id (e.g. when processing aborts). */
  async release(guildId: string | null, deliveryId: string): Promise<void> {
    await this.cache.delete(this.cacheKey(guildId, deliveryId));
  }

  private cacheKey(guildId: string | null, deliveryId: string): string {
    return guildId
      ? this.cache.keys.forGuild(
          guildId,
          CacheNamespace.Generic,
          WEBHOOKS_CACHE.Dedupe,
          deliveryId,
        )
      : this.cache.keys.forGlobal(
          CacheNamespace.Generic,
          WEBHOOKS_CACHE.Dedupe,
          deliveryId,
        );
  }
}
