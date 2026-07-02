import { Injectable } from '@nestjs/common';
import { CacheService } from '../../../cache/cache.service';
import { CacheNamespace } from '../../../cache/keys/cache-namespace.enum';
import { MetricsSnapshotRepository } from '../infrastructure/repositories/metrics-snapshot.repository';
import { METRICS_CACHE_PREFIX } from '../metrics.constants';
import type { MetricScope } from '../domain/metric-scope';
import {
  MetricsSnapshotService,
  type MetricsRangeQuery,
  type MetricsSnapshotView,
  type PaginatedResult,
} from './metrics.service.contract';

/**
 * Read-side facade over the rollup store for the dashboard. The `latest` view
 * is cached briefly (snapshots are written at most once per minute) so live
 * tiles don't hammer the DB; time-range queries are paginated and uncached.
 */
@Injectable()
export class MetricsSnapshotServiceImpl extends MetricsSnapshotService {
  private static readonly LATEST_TTL_SECONDS = 20;

  constructor(
    private readonly repo: MetricsSnapshotRepository,
    private readonly cache: CacheService,
  ) {
    super();
  }

  async latest(
    scope: MetricScope,
    guildId: string | null = null,
  ): Promise<MetricsSnapshotView | null> {
    const key = this.latestKey(scope, guildId);
    const cached = await this.cache.get<MetricsSnapshotView | null>(key);
    if (cached !== null) return cached;

    const view = await this.repo.latest(scope, guildId);
    if (view) {
      await this.cache.set(key, view, {
        ttlSeconds: MetricsSnapshotServiceImpl.LATEST_TTL_SECONDS,
        tags: guildId ? [`guild:${guildId}`] : [],
      });
    }
    return view;
  }

  range(
    query: MetricsRangeQuery,
  ): Promise<PaginatedResult<MetricsSnapshotView>> {
    return this.repo.range(query);
  }

  private latestKey(scope: MetricScope, guildId: string | null): string {
    const parts = [METRICS_CACHE_PREFIX, 'snapshot', 'latest', scope];
    return guildId
      ? this.cache.keys.forGuild(guildId, CacheNamespace.Generic, ...parts)
      : this.cache.keys.forGlobal(CacheNamespace.Generic, ...parts);
  }
}
