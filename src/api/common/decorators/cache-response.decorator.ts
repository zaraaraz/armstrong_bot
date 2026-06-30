import { SetMetadata } from '@nestjs/common';

export const CACHE_RESPONSE_KEY = 'ghost:api:cache-response';

export interface CacheResponseOptions {
  readonly ttlSeconds: number;
  /** 'guild' keys per guild; 'global' shares across guilds; 'actor' per actor. */
  readonly scope?: 'guild' | 'global' | 'actor';
}

/**
 * Marks a GET handler's response as cacheable through the Cache layer. The
 * {@link CacheInterceptor} reads this metadata and stores/serves the response
 * via `CacheService.getOrSet` — controllers never touch Redis directly.
 */
export const CacheResponse = (options: CacheResponseOptions) =>
  SetMetadata(CACHE_RESPONSE_KEY, options);
