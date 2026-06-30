import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DashboardOAuthService } from './discord-oauth.service';
import { DashboardSessionService } from './session.service';
import type { DashboardUser } from '../interfaces/dashboard.interfaces';

/**
 * Orchestrates the dashboard login flow: build the authorize URL, exchange the
 * code, and create the session. Bot owner / bot-presence sets are sourced from
 * config (the gateway/registry will supply live guild ids in a later phase).
 */
@Injectable()
export class DashboardAuthService {
  constructor(
    private readonly oauth: DashboardOAuthService,
    private readonly sessions: DashboardSessionService,
    private readonly configService: ConfigService,
  ) {}

  buildAuthorizeUrl(): { url: string; state: string } {
    return this.oauth.buildAuthorizeUrl();
  }

  async completeLogin(
    code: string,
  ): Promise<{ sessionId: string; user: DashboardUser }> {
    const result = await this.oauth.exchangeCode(
      code,
      this.botOwnerIds(),
      this.botGuildIds(),
    );
    const sessionId = await this.sessions.create(
      result.user,
      result.refreshToken,
      [...result.guilds],
    );
    return { sessionId, user: result.user };
  }

  logout(sessionId: string): Promise<void> {
    return this.sessions.destroy(sessionId);
  }

  private botOwnerIds(): ReadonlySet<string> {
    return this.splitSet(
      this.configService.get<string>('PERMISSION_BOT_OWNER_IDS'),
    );
  }

  private botGuildIds(): ReadonlySet<string> {
    return this.splitSet(this.configService.get<string>('BOT_GUILD_IDS'));
  }

  private splitSet(raw: string | undefined): ReadonlySet<string> {
    return new Set(
      (raw ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }
}
