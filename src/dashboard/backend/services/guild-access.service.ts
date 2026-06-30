import { Injectable } from '@nestjs/common';
import { PermissionService } from '../../../core/permissions/application/permission.service';
import { DashboardSessionService } from './session.service';
import { ForbiddenDashboardError } from '../interfaces/dashboard.interfaces';

/**
 * Authorizes dashboard access to a guild. The baseline gate is Discord
 * `Manage Guild` (resolved from the session's guild list); bot owners bypass
 * it. Fine-grained claim resolution is delegated to the Permissions core.
 */
@Injectable()
export class GuildAccessService {
  constructor(
    private readonly sessions: DashboardSessionService,
    private readonly permissions: PermissionService,
  ) {}

  /** Throws {@link ForbiddenDashboardError} when the user can't manage the guild. */
  async assertManage(sessionId: string, guildId: string): Promise<void> {
    const session = await this.sessions.resolve(sessionId);
    if (!session) throw new ForbiddenDashboardError('No active session');
    if (session.user.isBotOwner) return;
    const guild = session.guilds.find((g) => g.guildId === guildId);
    if (!guild || !guild.hasManage) {
      throw new ForbiddenDashboardError();
    }
  }

  /** Resolves whether the session user holds a specific claim within a guild. */
  async hasClaim(
    sessionId: string,
    guildId: string,
    claim: string,
  ): Promise<boolean> {
    const session = await this.sessions.resolve(sessionId);
    if (!session) return false;
    if (session.user.isBotOwner) return true;
    const guild = session.guilds.find((g) => g.guildId === guildId);
    // Manage Guild implies dashboard.access; finer claims go to the core.
    return this.permissions.can(
      {
        userId: session.user.discordId,
        guildId,
        discordRoleIds: [],
        isGuildOwner: guild?.hasManage ?? false,
      },
      claim,
    );
  }
}
