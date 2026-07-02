import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { CacheService } from '../../../cache/cache.service';
import { resolveWebhooksConfig, type WebhooksConfig } from './webhooks.config';

/**
 * Resolves webhooks configuration. Per spec §8 the webhooks config is
 * global-only (ENV -> defaults); per-endpoint / per-subscription behaviour is
 * row-scoped in the database and overrides nothing here. Global settings are
 * immutable per process and memoised on first access.
 */
@Injectable()
export class WebhooksConfigService {
  private globalCache: WebhooksConfig | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  global(): WebhooksConfig {
    if (!this.globalCache) {
      this.globalCache = resolveWebhooksConfig(process.env);
    }
    return this.globalCache;
  }

  /**
   * Returns the config for a guild. Webhooks config is global-only (spec §8),
   * so this delegates to {@link global}; the guild-aware signature is kept for
   * symmetry with the other modules' config services and to leave room for a
   * future per-guild override without changing call sites.
   */
  forGuild(_guildId: string | null): WebhooksConfig {
    return this.global();
  }
}
