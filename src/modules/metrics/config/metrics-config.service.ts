import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { CacheService } from '../../../cache/cache.service';
import { CacheNamespace } from '../../../cache/keys/cache-namespace.enum';
import {
  resolveMetricsConfig,
  metricsGuildConfigSchema,
  type MetricsConfig,
  type MetricsGuildConfig,
} from './metrics.config';

interface GuildConfigRow {
  readonly settings: unknown;
}

/**
 * Resolves metrics configuration with ENV -> DB -> defaults priority. The
 * global block is immutable per process (cached on first read); per-guild
 * threshold overrides are read from `GuildConfig.settings.metrics` and cached
 * for 5 minutes via the Cache layer (never Redis directly).
 */
@Injectable()
export class MetricsConfigService {
  private globalCache: MetricsConfig | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  global(): MetricsConfig {
    if (!this.globalCache) {
      this.globalCache = resolveMetricsConfig(process.env);
    }
    return this.globalCache;
  }

  async forGuild(guildId: string | null): Promise<MetricsGuildConfig> {
    if (guildId === null) {
      return metricsGuildConfigSchema.parse({});
    }
    const key = this.cache.keys.forGuild(
      guildId,
      CacheNamespace.Config,
      'metrics',
    );
    return this.cache.getOrSet(key, () => this.loadGuildConfig(guildId), {
      ttlSeconds: 300,
      tags: [`guild:${guildId}`],
    });
  }

  async invalidateGuild(guildId: string): Promise<void> {
    await this.cache.delete(
      this.cache.keys.forGuild(guildId, CacheNamespace.Config, 'metrics'),
    );
  }

  private async loadGuildConfig(guildId: string): Promise<MetricsGuildConfig> {
    const row = (await this.prisma['guildConfig'].findUnique({
      where: { guildId },
      select: { settings: true },
    })) as GuildConfigRow | null;

    const settings =
      row?.settings && typeof row.settings === 'object'
        ? (row.settings as Record<string, unknown>)
        : {};
    const override = (settings['metrics'] ?? {}) as Partial<MetricsGuildConfig>;
    return metricsGuildConfigSchema.parse(override);
  }
}
