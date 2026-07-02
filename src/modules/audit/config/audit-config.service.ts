import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { CacheService } from '../../../cache/cache.service';
import { CacheNamespace } from '../../../cache/keys/cache-namespace.enum';
import {
  resolveAuditGlobalConfig,
  resolveAuditGuildConfig,
  type AuditGlobalConfig,
  type AuditGuildConfig,
} from './audit.config';

interface GuildConfigRow {
  readonly settings: unknown;
}

/**
 * Resolves audit configuration with ENV -> DB -> defaults priority.
 * Global settings are immutable per process; guild retention policy is read
 * from `GuildConfig.settings.audit` and cached for 5 minutes.
 */
@Injectable()
export class AuditConfigService {
  private globalCache: AuditGlobalConfig | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  global(): AuditGlobalConfig {
    if (!this.globalCache) {
      this.globalCache = resolveAuditGlobalConfig(process.env);
    }
    return this.globalCache;
  }

  async forGuild(guildId: string | null): Promise<AuditGuildConfig> {
    if (guildId === null) {
      return resolveAuditGuildConfig(process.env);
    }
    const key = this.cache.keys.forGuild(
      guildId,
      CacheNamespace.Config,
      'audit',
    );
    return this.cache.getOrSet(key, () => this.loadGuildConfig(guildId), {
      ttlSeconds: 300,
      tags: [`guild:${guildId}`],
    });
  }

  /** Deny-list = global prefixes ∪ guild-specific prefixes. */
  async denyPrefixesFor(guildId: string | null): Promise<readonly string[]> {
    const guild = await this.forGuild(guildId);
    return [...this.global().denyActionPrefixes, ...guild.denyActionPrefixes];
  }

  /**
   * Persists a retention-policy override into `GuildConfig.settings.audit`
   * and invalidates the cached copy. Only the whitelisted keys are written.
   */
  async updateGuild(
    guildId: string,
    patch: Partial<
      Pick<
        AuditGuildConfig,
        'retentionDays' | 'archiveBeforeDelete' | 'archiveFormat'
      >
    >,
  ): Promise<AuditGuildConfig> {
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
      settings['audit'] && typeof settings['audit'] === 'object'
        ? (settings['audit'] as Record<string, unknown>)
        : {};
    const next = { ...current, ...patch };
    // validate the merged override before persisting
    const resolved = resolveAuditGuildConfig(process.env, next);
    settings['audit'] = next;

    await this.prisma['guildConfig'].update({
      where: { guildId },
      data: { settings: settings as Prisma.InputJsonValue },
    });
    await this.invalidateGuild(guildId);
    return resolved;
  }

  async invalidateGuild(guildId: string): Promise<void> {
    await this.cache.delete(
      this.cache.keys.forGuild(guildId, CacheNamespace.Config, 'audit'),
    );
  }

  private async loadGuildConfig(guildId: string): Promise<AuditGuildConfig> {
    const row = (await this.prisma['guildConfig'].findUnique({
      where: { guildId },
      select: { settings: true },
    })) as GuildConfigRow | null;

    const settings =
      row?.settings && typeof row.settings === 'object'
        ? (row.settings as Record<string, unknown>)
        : {};
    const override = (settings['audit'] ?? {}) as Partial<AuditGuildConfig>;
    return resolveAuditGuildConfig(process.env, override);
  }
}
