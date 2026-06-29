import { Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type {
  HealthContributor,
  HealthCheckResult,
} from '../health-contributor';

@Injectable()
export class RedisHealthIndicator implements HealthContributor {
  readonly name = 'redis';

  constructor(private readonly redis: Redis) {}

  async check(): Promise<HealthCheckResult> {
    try {
      const start = Date.now();
      await this.redis.ping();
      return { state: 'up', detail: { latencyMs: Date.now() - start } };
    } catch {
      return { state: 'down', detail: { error: 'Connection failed' } };
    }
  }
}
