import { Inject, Injectable } from '@nestjs/common';
import { CacheService } from '../../../cache/cache.service';
import { CacheNamespace } from '../../../cache/keys/cache-namespace.enum';
import { EncryptionService } from '../../../shared/security/services/encryption.service';
import {
  DASHBOARD_CONFIG,
  type DashboardGlobalConfig,
} from '../config/dashboard.config.schema';
import { DashboardSessionRepository } from '../repositories/session.repository';
import type {
  DashboardSessionData,
  DashboardUser,
  ManageableGuild,
} from '../interfaces/dashboard.interfaces';

interface HotSession {
  readonly user: DashboardUser;
  readonly guilds: ReadonlyArray<ManageableGuild>;
  readonly createdAt: string;
  readonly expiresAt: string;
}

/**
 * Manages dashboard sessions: a hot copy in the Cache layer for fast resolution
 * and a durable `dashboard_sessions` row (with the Discord refresh token
 * encrypted at rest) for audit/revocation. Never touches Redis directly.
 */
@Injectable()
export class DashboardSessionService {
  constructor(
    private readonly cache: CacheService,
    private readonly encryption: EncryptionService,
    private readonly repo: DashboardSessionRepository,
    @Inject(DASHBOARD_CONFIG) private readonly config: DashboardGlobalConfig,
  ) {}

  async create(
    user: DashboardUser,
    refreshToken: string,
    guilds: ManageableGuild[],
  ): Promise<string> {
    const now = Date.now();
    const expiresAt = new Date(now + this.config.session.ttlSeconds * 1000);
    const row = await this.repo.create({
      discordId: user.discordId,
      username: user.username,
      encryptedRefreshToken: this.encryption.encrypt(refreshToken),
      expiresAt,
    });

    const hot: HotSession = {
      user,
      guilds,
      createdAt: new Date(now).toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    await this.cache.set(this.key(row.id), hot, {
      ttlSeconds: this.config.session.ttlSeconds,
      l2Only: true,
    });
    return row.id;
  }

  async resolve(sessionId: string): Promise<DashboardSessionData | null> {
    const hot = await this.cache.get<HotSession>(this.key(sessionId));
    if (hot) {
      return {
        sessionId,
        user: hot.user,
        guilds: hot.guilds,
        createdAt: new Date(hot.createdAt),
        expiresAt: new Date(hot.expiresAt),
      };
    }
    // Fall back to the durable record (cold session) for revocation checks.
    const row = await this.repo.findActive(sessionId);
    if (!row) return null;
    return {
      sessionId,
      user: {
        discordId: row.discordId,
        username: row.username,
        globalName: null,
        avatarHash: null,
        isBotOwner: false,
      },
      guilds: [],
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    };
  }

  async destroy(sessionId: string): Promise<void> {
    await Promise.all([
      this.cache.delete(this.key(sessionId)),
      this.repo.revoke(sessionId),
    ]);
  }

  private key(sessionId: string): string {
    return this.cache.keys.forGlobal(
      CacheNamespace.User,
      'dash',
      'sess',
      sessionId,
    );
  }
}
