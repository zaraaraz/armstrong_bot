import { Injectable } from '@nestjs/common';
import { DiscordOAuthService } from './discord-oauth.service';
import { SessionStore, type SessionData } from './session.store';
import type { AuthenticatedActor } from '../common/context/api-actor';

export interface LoginResult {
  readonly sessionId: string;
  readonly session: SessionData;
}

/**
 * Application service for the browser/dashboard auth flow: exchange a Discord
 * OAuth code, build the hot session, and expose the current actor. The Discord
 * refresh token is returned to the caller for encrypted durable storage by the
 * dashboard backend — it is never placed in the hot session.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly oauth: DiscordOAuthService,
    private readonly sessions: SessionStore,
  ) {}

  buildAuthorizeUrl(): { url: string; state: string } {
    return this.oauth.buildAuthorizeUrl();
  }

  /** Exchanges the code, creates a hot session, returns the id + refresh token. */
  async completeLogin(
    code: string,
    botOwnerIds: ReadonlySet<string>,
  ): Promise<LoginResult & { refreshToken: string }> {
    const result = await this.oauth.exchangeCode(code);
    const session: SessionData = {
      userId: result.user.id,
      username: result.user.username,
      displayName: result.user.global_name ?? result.user.username,
      isBotOwner: botOwnerIds.has(result.user.id),
      guilds: result.guilds,
      createdAt: new Date().toISOString(),
    };
    const sessionId = await this.sessions.create(session);
    return { sessionId, session, refreshToken: result.refreshToken };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.destroy(sessionId);
  }

  /** Public projection of the authenticated actor for `/auth/me`. */
  describe(actor: AuthenticatedActor): {
    id: string;
    type: string;
    method: string;
    displayName: string;
    claims: string[];
    guildScope: string[];
  } {
    return {
      id: actor.id,
      type: actor.type,
      method: actor.method,
      displayName: actor.displayName,
      claims: [...actor.claims],
      guildScope: [...actor.guildScope],
    };
  }
}
