import { Injectable, Logger } from '@nestjs/common';
import type { HealthContributor, HealthCheckResult, HealthState } from './health-contributor';

export interface AggregatedHealth {
  readonly status: 'ok' | 'degraded' | 'error';
  readonly contributors: ReadonlyArray<{ name: string; state: HealthState; detail?: Record<string, string | number | boolean> }>;
  readonly uptimeSeconds: number;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly contributors: HealthContributor[] = [];
  private readonly startedAt = Date.now();

  register(contributor: HealthContributor): void {
    this.contributors.push(contributor);
  }

  async check(): Promise<AggregatedHealth> {
    const results = await Promise.allSettled(this.contributors.map((c) => c.check().then((r) => ({ name: c.name, ...r }))));

    const contributors = results.map((r, i): { name: string; state: HealthState; detail?: Record<string, string | number | boolean> } => {
      if (r.status === 'fulfilled') return r.value;
      this.logger.error(`Health contributor "${this.contributors[i].name}" threw`, r.reason);
      return { name: this.contributors[i].name, state: 'down' };
    });

    const hasDown = contributors.some((c) => c.state === 'down');
    const hasDegraded = contributors.some((c) => c.state === 'degraded');
    const status = hasDown ? 'error' : hasDegraded ? 'degraded' : 'ok';
    const uptimeSeconds = Math.floor((Date.now() - this.startedAt) / 1000);

    return { status, contributors, uptimeSeconds };
  }
}
