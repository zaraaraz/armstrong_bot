import { randomBytes } from 'crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { API_CONFIG, type ApiConfig } from '../config/api.config';
import type { SessionGuild } from './session.store';

const DISCORD_API = 'https://discord.com/api/v10';
/** Discord permission bit for MANAGE_GUILD. */
const MANAGE_GUILD = 0x20n;

interface DiscordTokenResponse {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_in: number;
}

interface DiscordUser {
  readonly id: string;
  readonly username: string;
  readonly global_name: string | null;
  readonly avatar: string | null;
}

interface DiscordPartialGuild {
  readonly id: string;
  readonly name: string;
  readonly owner: boolean;
  readonly permissions: string; // bitfield as string
}

export interface OAuthResult {
  readonly user: DiscordUser;
  readonly guilds: ReadonlyArray<SessionGuild>;
  readonly refreshToken: string;
}

/**
 * Drives the Discord OAuth2 authorization-code flow. No Discord token ever
 * leaves the backend — the access token is used immediately to fetch the user
 * and their guilds, and only the refresh token is persisted (encrypted) by the
 * caller. Network access via the global `fetch`.
 */
@Injectable()
export class DiscordOAuthService {
  private readonly logger = new Logger(DiscordOAuthService.name);

  constructor(@Inject(API_CONFIG) private readonly config: ApiConfig) {}

  /** Builds the authorize URL and returns it alongside the CSRF state. */
  buildAuthorizeUrl(): { url: string; state: string } {
    const state = randomBytes(16).toString('base64url');
    const { clientId, redirectUri, scopes } = this.config.discordOAuth;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      state,
      prompt: 'none',
    });
    return {
      url: `${DISCORD_API}/oauth2/authorize?${params.toString()}`,
      state,
    };
  }

  /** Exchanges an authorization code and resolves the user + manageable guilds. */
  async exchangeCode(code: string): Promise<OAuthResult> {
    const token = await this.exchange(code);
    const [user, guilds] = await Promise.all([
      this.fetchUser(token.access_token),
      this.fetchGuilds(token.access_token),
    ]);
    return { user, guilds, refreshToken: token.refresh_token };
  }

  private async exchange(code: string): Promise<DiscordTokenResponse> {
    const { clientId, clientSecret, redirectUri } = this.config.discordOAuth;
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    });
    const res = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      this.logger.warn(`Discord token exchange failed: ${res.status}`);
      throw new Error('oauth_exchange_failed');
    }
    return (await res.json()) as DiscordTokenResponse;
  }

  private async fetchUser(accessToken: string): Promise<DiscordUser> {
    const res = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error('oauth_user_fetch_failed');
    return (await res.json()) as DiscordUser;
  }

  private async fetchGuilds(
    accessToken: string,
  ): Promise<ReadonlyArray<SessionGuild>> {
    const res = await fetch(`${DISCORD_API}/users/@me/guilds`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error('oauth_guilds_fetch_failed');
    const guilds = (await res.json()) as DiscordPartialGuild[];

    return guilds.map((g) => {
      const perms = this.parsePermissions(g.permissions);
      const canManage = g.owner || (perms & MANAGE_GUILD) === MANAGE_GUILD;
      return {
        guildId: g.id,
        name: g.name,
        roleIds: [], // role membership is not exposed by /users/@me/guilds
        isOwner: g.owner,
        canManage,
      } satisfies SessionGuild;
    });
  }

  private parsePermissions(raw: string): bigint {
    try {
      return BigInt(raw);
    } catch {
      return 0n;
    }
  }
}
