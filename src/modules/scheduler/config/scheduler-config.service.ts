import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service';
import { CacheService } from '../../../cache/cache.service';
import { CacheNamespace } from '../../../cache/keys/cache-namespace.enum';
import {
  resolveSchedulerGlobalConfig,
  resolveSchedulerGuildConfig,
  type SchedulerGlobalConfig,
  type SchedulerGuildConfig,
} from './scheduler.config';

interface GuildConfigRow {
  timezone: string;
  settings: unknown;
}

/**
 * Resolves scheduler configuration: global from ENV (cached for the process),
 * per-guild from the `GuildConfig.settings.scheduler` blob layered over defaults
 * (cached in the Cache layer, never Redis directly).
 */
@Injectable()
export class SchedulerConfigService {
  private globalCache: SchedulerGlobalConfig | null = null;

  constructor(
    private readonly env: ConfigService,
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  global(): SchedulerGlobalConfig {
    if (!this.globalCache) {
      this.globalCache = resolveSchedulerGlobalConfig(process.env);
    }
    return this.globalCache;
  }

  async forGuild(guildId: string | null): Promise<SchedulerGuildConfig> {
    if (guildId === null) {
      return resolveSchedulerGuildConfig({
        timezone: this.env.get<string>('SCHEDULER_GLOBAL_TZ', 'UTC'),
      });
    }

    const key = this.cache.keys.forGuild(
      guildId,
      CacheNamespace.Config,
      'scheduler',
    );
    return this.cache.getOrSet(key, () => this.loadGuildConfig(guildId), {
      ttlSeconds: 300,
      tags: [`guild:${guildId}`],
    });
  }

  /** Drop the cached per-guild config (call after a config edit). */
  async invalidateGuild(guildId: string): Promise<void> {
    await this.cache.delete(
      this.cache.keys.forGuild(guildId, CacheNamespace.Config, 'scheduler'),
    );
  }

  private async loadGuildConfig(
    guildId: string,
  ): Promise<SchedulerGuildConfig> {
    const row = (await this.prisma['guildConfig'].findUnique({
      where: { guildId },
      select: { timezone: true, settings: true },
    })) as GuildConfigRow | null;

    const settings =
      row?.settings && typeof row.settings === 'object'
        ? (row.settings as Record<string, unknown>)
        : {};
    const override = (settings['scheduler'] ??
      {}) as Partial<SchedulerGuildConfig>;

    return resolveSchedulerGuildConfig({
      timezone: override.timezone ?? row?.timezone ?? 'UTC',
      maintenanceWindows: override.maintenanceWindows,
      cleanupEnabled: override.cleanupEnabled,
    });
  }
}
