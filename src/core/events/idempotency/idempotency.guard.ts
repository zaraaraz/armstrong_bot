import { Injectable } from '@nestjs/common';
import { CacheService } from '../../../cache/cache.service';

const TTL_SECONDS = 86_400;
const NAMESPACE = 'events:idem';

@Injectable()
export class IdempotencyGuard {
  constructor(private readonly cache: CacheService) {}

  async isDuplicate(key: string): Promise<boolean> {
    return this.cache.has(`${NAMESPACE}:${key}`);
  }

  async markSeen(key: string): Promise<void> {
    await this.cache.set(`${NAMESPACE}:${key}`, true, {
      ttlSeconds: TTL_SECONDS,
    });
  }
}
