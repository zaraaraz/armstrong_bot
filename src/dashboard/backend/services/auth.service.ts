import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DashboardOAuthService } from './discord-oauth.service';
import { DashboardSessionService } from './session.service';
import { BotGuildsRepository } from '../repositories/bot-guilds.repository';
import type { DashboardUser } from '../interfaces/dashboard.interfaces';

/**
 * Orchestrates the dashboard login flow: build the authorize URL, exchange the
 * code, and create the session. Bot presence now comes live from the gateway's
 * guild registry (DB); the BOT_GUILD_IDS env var remains as a manual override
 * that is unioned in (useful for testing without the gateway).
 */
@Injectable()
export class DashboardAuthService {
  constructor(
    private readonly oauth: DashboardOAuthService,
    private readonly sessions: DashboardSessionService,
    private readonly configService: ConfigService,
    private readonly botGuilds: BotGuildsRepository,
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
      await this.botGuildIds(),
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

  private async botGuildIds(): Promise<ReadonlySet<string>> {
    const live = await this.botGuilds.activeDiscordIds();
    const manual = this.splitSet(
      this.configService.get<string>('BOT_GUILD_IDS'),
    );
    return new Set([...live, ...manual]);
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
