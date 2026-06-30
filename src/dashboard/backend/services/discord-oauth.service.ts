import { randomBytes } from 'crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DASHBOARD_CONFIG,
  type DashboardGlobalConfig,
} from '../config/dashboard.config.schema';
import type {
  DashboardUser,
  ManageableGuild,
} from '../interfaces/dashboard.interfaces';

const DISCORD_API = 'https://discord.com/api/v10';
const MANAGE_GUILD = 0x20n;

interface TokenResponse {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_in: number;
}

interface RawUser {
  readonly id: string;
  readonly username: string;
  readonly global_name: string | null;
  readonly avatar: string | null;
}

interface RawGuild {
  readonly id: string;
  readonly name: string;
  readonly icon: string | null;
  readonly owner: boolean;
  readonly permissions: string;
}

export interface DashboardOAuthResult {
  readonly user: DashboardUser;
  readonly guilds: ReadonlyArray<ManageableGuild>;
  readonly refreshToken: string;
}

/** Dashboard-side Discord OAuth2 code flow (BFF — no token reaches the browser). */
@Injectable()
export class DashboardOAuthService {
  private readonly logger = new Logger(DashboardOAuthService.name);

  constructor(
    @Inject(DASHBOARD_CONFIG) private readonly config: DashboardGlobalConfig,
  ) {}

  buildAuthorizeUrl(): { url: string; state: string } {
    const state = randomBytes(16).toString('base64url');
    const { clientId, redirectUri, scopes } = this.config.oauth;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      state,
    });
    return { url: `${DISCORD_API}/oauth2/authorize?${params}`, state };
  }

  async exchangeCode(
    code: string,
    botOwnerIds: ReadonlySet<string>,
    botGuildIds: ReadonlySet<string>,
  ): Promise<DashboardOAuthResult> {
    const token = await this.exchange(code);
    const [rawUser, rawGuilds] = await Promise.all([
      this.fetchJson<RawUser>('/users/@me', token.access_token),
      this.fetchJson<RawGuild[]>('/users/@me/guilds', token.access_token),
    ]);

    const isOwner = botOwnerIds.has(rawUser.id);
    const user: DashboardUser = {
      discordId: rawUser.id,
      username: rawUser.username,
      globalName: rawUser.global_name,
      avatarHash: rawUser.avatar,
      isBotOwner: isOwner,
    };

    const guilds: ManageableGuild[] = rawGuilds.map((g) => {
      const perms = this.parsePerms(g.permissions);
      const hasManage =
        isOwner || g.owner || (perms & MANAGE_GUILD) === MANAGE_GUILD;
      return {
        guildId: g.id,
        name: g.name,
        iconHash: g.icon,
        botPresent: botGuildIds.has(g.id),
        hasManage,
      };
    });

    return { user, guilds, refreshToken: token.refresh_token };
  }

  private async exchange(code: string): Promise<TokenResponse> {
    const { clientId, clientSecret, redirectUri } = this.config.oauth;
    const res = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!res.ok) {
      this.logger.warn(`OAuth token exchange failed: ${res.status}`);
      throw new Error('oauth_exchange_failed');
    }
    return (await res.json()) as TokenResponse;
  }

  private async fetchJson<T>(path: string, accessToken: string): Promise<T> {
    const res = await fetch(`${DISCORD_API}${path}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`oauth_fetch_failed:${path}`);
    return (await res.json()) as T;
  }

  private parsePerms(raw: string): bigint {
    try {
      return BigInt(raw);
    } catch {
      return 0n;
    }
  }
}
