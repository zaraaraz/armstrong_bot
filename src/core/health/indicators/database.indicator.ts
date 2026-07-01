import { Injectable } from '@nestjs/common';
import type {
  HealthContributor,
  HealthCheckResult,
} from '../health-contributor';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class DatabaseHealthIndicator implements HealthContributor {
  readonly name = 'database';

  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<HealthCheckResult> {
    try {
      const start = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      return { state: 'up', detail: { latencyMs: Date.now() - start } };
    } catch {
      return { state: 'down', detail: { error: 'Connection failed' } };
    }
  }
}
