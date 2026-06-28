import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { CacheService } from './cache.service';
import { CacheKeyBuilder } from './keys/cache-key.builder';
import { MemoryCacheStore } from './stores/memory-cache.store';
import { RedisCacheStore } from './stores/redis-cache.store';

const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Redis({
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          lazyConnect: true,
        }),
    },
    {
      provide: MemoryCacheStore,
      useFactory: () => new MemoryCacheStore(10_000),
    },
    {
      provide: RedisCacheStore,
      inject: [REDIS_CLIENT],
      useFactory: (redis: Redis) => new RedisCacheStore(redis),
    },
    CacheKeyBuilder,
    CacheService,
  ],
  exports: [CacheService, CacheKeyBuilder, REDIS_CLIENT],
})
export class CacheModule {}
