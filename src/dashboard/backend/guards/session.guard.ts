import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  DASHBOARD_CONFIG,
  type DashboardGlobalConfig,
} from '../config/dashboard.config.schema';
import { DashboardSessionService } from '../services/session.service';
import type { DashboardSessionData } from '../interfaces/dashboard.interfaces';

export interface DashboardRequest extends Request {
  dashboard?: { session: DashboardSessionData };
}

/** Parses a cookie header into a map without an external dependency. */
function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

/** Validates the session cookie and attaches the resolved session to the request. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly sessions: DashboardSessionService,
    @Inject(DASHBOARD_CONFIG) private readonly config: DashboardGlobalConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<DashboardRequest>();
    const sessionId = readCookie(req, this.config.session.cookieName);
    if (!sessionId) throw new UnauthorizedException('No session');

    const session = await this.sessions.resolve(sessionId);
    if (!session) throw new UnauthorizedException('Invalid or expired session');

    req.dashboard = { session };
    return true;
  }
}
