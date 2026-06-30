import { Injectable } from '@nestjs/common';
import { CacheService } from '../../../cache/cache.service';
import { CacheNamespace } from '../../../cache/keys/cache-namespace.enum';
import { ModuleRegistry } from '../../../core/module-system/module-registry';
import { DashboardAuditRepository } from '../repositories/audit.repository';

export interface GuildOverview {
  readonly guildId: string;
  readonly modules: { total: number };
  readonly recentActivity: ReadonlyArray<{
    action: string;
    actorId: string;
    target: string | null;
    at: string;
  }>;
}

/**
 * Aggregates a guild overview across module-registry state and recent audit
 * activity. Results are cached briefly through the Cache layer. Reads only
 * public CORE surfaces — never another module's internals.
 */
@Injectable()
export class DashboardAggregationService {
  constructor(
    private readonly cache: CacheService,
    private readonly registry: ModuleRegistry,
    private readonly audit: DashboardAuditRepository,
  ) {}

  async overview(guildId: string): Promise<GuildOverview> {
    const key = this.cache.keys.forGuild(
      guildId,
      CacheNamespace.Generic,
      'dash',
      'overview',
    );
    return this.cache.getOrSet(key, () => this.load(guildId), {
      ttlSeconds: 30,
      jitterSeconds: 5,
    });
  }

  private async load(guildId: string): Promise<GuildOverview> {
    const modules = this.registry.all();
    const recent = await this.audit.recent(guildId, 10);
    return {
      guildId,
      modules: { total: modules.length },
      recentActivity: recent.map((e) => ({
        action: e.action,
        actorId: e.actorId,
        target: e.target,
        at: e.createdAt.toISOString(),
      })),
    };
  }
}
