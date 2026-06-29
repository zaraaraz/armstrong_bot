import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { ICooldownService } from '../interfaces/security.interfaces';
import { REDIS_CLIENT } from './rate-limit.service';

const PREFIX = 'security:cooldown';

/**
 * Per-action, per-user cooldowns backed by Redis TTL keys. `check` reports the
 * remaining cooldown in ms (0 = ready); `start` arms it for `seconds`.
 */
@Injectable()
export class CooldownService implements ICooldownService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async check(scope: string, userId: string, seconds: number): Promise<number> {
    void seconds; // duration is fixed at start(); kept for interface parity
    const ttl = await this.redis.pttl(this.key(scope, userId));
    return ttl > 0 ? ttl : 0;
  }

  async start(scope: string, userId: string, seconds: number): Promise<void> {
    await this.redis.set(this.key(scope, userId), '1', 'EX', seconds);
  }

  private key(scope: string, userId: string): string {
    return `${PREFIX}:${scope}:${userId}`;
  }
}
