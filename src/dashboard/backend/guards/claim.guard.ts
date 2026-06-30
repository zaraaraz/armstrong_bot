import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GuildAccessService } from '../services/guild-access.service';
import type { DashboardRequest } from './session.guard';

export const DASHBOARD_CLAIM_KEY = 'ghost:dashboard:claim';

/** Declares the dashboard claim a route requires (e.g. `dashboard.config.write`). */
export const RequireDashboardClaim = (claim: string) =>
  SetMetadata(DASHBOARD_CLAIM_KEY, claim);

/**
 * Enforces a fine-grained dashboard claim on top of the Manage-Guild baseline,
 * delegating resolution to the Permissions core. Bot owners and `dashboard.*`
 * wildcard holders pass.
 */
@Injectable()
export class ClaimGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: GuildAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const claim = this.reflector.getAllAndOverride<string | undefined>(
      DASHBOARD_CLAIM_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!claim) return true;

    const req = context.switchToHttp().getRequest<DashboardRequest>();
    const guildId = (req.params as Record<string, string>)?.guildId;
    const session = req.dashboard?.session;
    if (!session || !guildId) throw new ForbiddenException('Forbidden');

    const ok = await this.access.hasClaim(session.sessionId, guildId, claim);
    if (!ok) throw new ForbiddenException(`Missing claim: ${claim}`);
    return true;
  }
}
