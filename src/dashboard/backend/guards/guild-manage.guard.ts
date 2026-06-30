import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { GuildAccessService } from '../services/guild-access.service';
import { ForbiddenDashboardError } from '../interfaces/dashboard.interfaces';
import type { DashboardRequest } from './session.guard';

/**
 * Requires `Manage Guild` on the `:guildId` route param. Bot owners bypass.
 * Runs after {@link SessionGuard}, which attaches the session.
 */
@Injectable()
export class GuildManageGuard implements CanActivate {
  constructor(private readonly access: GuildAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<DashboardRequest>();
    const guildId = (req.params as Record<string, string>)?.guildId;
    if (!guildId) return true;

    const session = req.dashboard?.session;
    if (!session) throw new ForbiddenException('No session');

    try {
      await this.access.assertManage(session.sessionId, guildId);
      return true;
    } catch (err) {
      if (err instanceof ForbiddenDashboardError) {
        throw new ForbiddenException(err.message);
      }
      throw err;
    }
  }
}
