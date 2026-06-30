import { randomBytes } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CacheService } from '../../cache/cache.service';
import { CacheNamespace } from '../../cache/keys/cache-namespace.enum';
import { API_CONFIG, type ApiConfig } from '../config/api.config';

/** A guild the session's user belongs to, with the data needed to authorize. */
export interface SessionGuild {
  readonly guildId: string; // Discord guild id
  readonly name: string;
  readonly roleIds: readonly string[];
  readonly isOwner: boolean;
  /** True if the user holds Discord `Manage Guild` (0x20) here. */
  readonly canManage: boolean;
}

export interface SessionData {
  readonly userId: string; // Discord user id
  readonly username: string;
  readonly displayName: string;
  readonly isBotOwner: boolean;
  readonly guilds: ReadonlyArray<SessionGuild>;
  readonly createdAt: string;
}

/**
 * Hot session store backed by the Cache layer (never raw Redis). Holds the
 * resolved actor + per-guild role/owner data so guards can authorize without
 * re-hitting Discord on every request. A durable copy lives in
 * `dashboard_sessions` (handled by the dashboard backend) for audit/revocation.
 */
@Injectable()
export class SessionStore {
  constructor(
    private readonly cache: CacheService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async create(data: SessionData): Promise<string> {
    const sessionId = randomBytes(32).toString('base64url');
    await this.cache.set(this.key(sessionId), data, {
      ttlSeconds: this.config.session.ttlSeconds,
      l2Only: true,
    });
    return sessionId;
  }

  resolve(sessionId: string): Promise<SessionData | null> {
    return this.cache.get<SessionData>(this.key(sessionId));
  }

  async destroy(sessionId: string): Promise<void> {
    await this.cache.delete(this.key(sessionId));
  }

  private key(sessionId: string): string {
    return this.cache.keys.forGlobal(CacheNamespace.User, 'session', sessionId);
  }
}
