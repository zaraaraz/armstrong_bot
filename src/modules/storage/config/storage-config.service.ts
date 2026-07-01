import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service';
import { CacheService } from '../../../cache/cache.service';
import { CacheNamespace } from '../../../cache/keys/cache-namespace.enum';
import {
  resolveStorageGlobalConfig,
  resolveStorageGuildConfig,
  type StorageGlobalConfig,
  type StorageGuildConfig,
} from './storage.config';

interface GuildConfigRow {
  settings: unknown;
}

/**
 * Resolves storage configuration: global from ENV (cached for the process),
 * per-guild from the `GuildConfig.settings.storage` blob layered over the
 * global default quota (cached in the Cache layer, never Redis directly).
 */
@Injectable()
export class StorageConfigService {
  private globalCache: StorageGlobalConfig | null = null;

  constructor(
    private readonly env: ConfigService,
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  global(): StorageGlobalConfig {
    if (!this.globalCache) {
      this.globalCache = resolveStorageGlobalConfig(process.env);
    }
    return this.globalCache;
  }

  async forGuild(guildId: string | null): Promise<StorageGuildConfig> {
    if (guildId === null) {
      return resolveStorageGuildConfig(this.global().defaultQuotaBytes);
    }

    const key = this.cache.keys.forGuild(
      guildId,
      CacheNamespace.Config,
      'storage',
    );
    return this.cache.getOrSet(key, () => this.loadGuildConfig(guildId), {
      ttlSeconds: 300,
      tags: [`guild:${guildId}`],
    });
  }

  /** Drop the cached per-guild config (call after a config edit). */
  async invalidateGuild(guildId: string): Promise<void> {
    await this.cache.delete(
      this.cache.keys.forGuild(guildId, CacheNamespace.Config, 'storage'),
    );
  }

  private async loadGuildConfig(guildId: string): Promise<StorageGuildConfig> {
    const row = (await this.prisma['guildConfig'].findUnique({
      where: { guildId },
      select: { settings: true },
    })) as GuildConfigRow | null;

    const settings =
      row?.settings && typeof row.settings === 'object'
        ? (row.settings as Record<string, unknown>)
        : {};
    const override = (settings['storage'] ?? {}) as Partial<StorageGuildConfig>;

    return resolveStorageGuildConfig(this.global().defaultQuotaBytes, override);
  }
}
