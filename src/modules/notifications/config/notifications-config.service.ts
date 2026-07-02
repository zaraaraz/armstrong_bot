import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { CacheService } from '../../../cache/cache.service';
import { CacheNamespace } from '../../../cache/keys/cache-namespace.enum';
import {
  resolveNotificationsGlobalConfig,
  resolveNotificationsGuildConfig,
  type NotificationsGlobalConfig,
  type NotificationsGuildConfig,
} from './notifications.config';

interface GuildConfigRow {
  readonly settings: unknown;
}

const SETTINGS_KEY = 'notifications';

/**
 * Resolves notification configuration with ENV -> DB -> defaults priority.
 * Global settings are immutable per process; per-guild behaviour is read from
 * `GuildConfig.settings.notifications` and cached for 5 minutes.
 */
@Injectable()
export class NotificationsConfigService {
  private globalCache: NotificationsGlobalConfig | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  global(): NotificationsGlobalConfig {
    if (!this.globalCache) {
      this.globalCache = resolveNotificationsGlobalConfig(process.env);
    }
    return this.globalCache;
  }

  async forGuild(guildId: string | null): Promise<NotificationsGuildConfig> {
    if (guildId === null) {
      return resolveNotificationsGuildConfig();
    }
    const key = this.cache.keys.forGuild(
      guildId,
      CacheNamespace.Config,
      SETTINGS_KEY,
    );
    return this.cache.getOrSet(key, () => this.loadGuildConfig(guildId), {
      ttlSeconds: 300,
      tags: [`guild:${guildId}`],
    });
  }

  /**
   * Persists a guild behaviour override into
   * `GuildConfig.settings.notifications` and invalidates the cached copy.
   */
  async updateGuild(
    guildId: string,
    patch: Partial<NotificationsGuildConfig>,
  ): Promise<NotificationsGuildConfig> {
    const row = (await this.prisma['guildConfig'].findUnique({
      where: { guildId },
      select: { settings: true },
    })) as GuildConfigRow | null;
    if (!row) {
      throw new Error(`Guild config not found for guild ${guildId}`);
    }

    const settings =
      row.settings && typeof row.settings === 'object'
        ? { ...(row.settings as Record<string, unknown>) }
        : {};
    const current =
      settings[SETTINGS_KEY] && typeof settings[SETTINGS_KEY] === 'object'
        ? (settings[SETTINGS_KEY] as Record<string, unknown>)
        : {};
    const next: Partial<NotificationsGuildConfig> = { ...current, ...patch };
    // validate the merged override before persisting
    const resolved = resolveNotificationsGuildConfig(next);
    settings[SETTINGS_KEY] = next;

    await this.prisma['guildConfig'].update({
      where: { guildId },
      data: { settings: settings as Prisma.InputJsonValue },
    });
    await this.invalidateGuild(guildId);
    return resolved;
  }

  async invalidateGuild(guildId: string): Promise<void> {
    await this.cache.delete(
      this.cache.keys.forGuild(guildId, CacheNamespace.Config, SETTINGS_KEY),
    );
  }

  private async loadGuildConfig(
    guildId: string,
  ): Promise<NotificationsGuildConfig> {
    const row = (await this.prisma['guildConfig'].findUnique({
      where: { guildId },
      select: { settings: true },
    })) as GuildConfigRow | null;

    const settings =
      row?.settings && typeof row.settings === 'object'
        ? (row.settings as Record<string, unknown>)
        : {};
    const override = (settings[SETTINGS_KEY] ??
      {}) as Partial<NotificationsGuildConfig>;
    return resolveNotificationsGuildConfig(override);
  }
}
