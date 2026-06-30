import {
  Controller,
  Get,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  DASHBOARD_CONFIG,
  type DashboardGlobalConfig,
} from '../config/dashboard.config.schema';
import { DashboardAuthService } from '../services/auth.service';
import { SessionGuard, type DashboardRequest } from '../guards/session.guard';

const STATE_COOKIE = 'ghost_dash_state';

@ApiTags('dashboard/auth')
@Controller('api/dashboard/auth')
export class DashboardAuthController {
  constructor(
    private readonly auth: DashboardAuthService,
    @Inject(DASHBOARD_CONFIG) private readonly config: DashboardGlobalConfig,
  ) {}

  @Get('login')
  @ApiExcludeEndpoint()
  login(@Res() res: Response): void {
    const { url, state } = this.auth.buildAuthorizeUrl();
    res.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      secure: this.config.session.secure,
      sameSite: this.config.session.sameSite,
      maxAge: 5 * 60 * 1000,
    });
    res.redirect(url);
  }

  @Get('callback')
  @ApiExcludeEndpoint()
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const expected = this.cookie(req, STATE_COOKIE);
    if (!code || !state || !expected || state !== expected) {
      throw new UnauthorizedException('Invalid OAuth state');
    }
    const { sessionId } = await this.auth.completeLogin(code);
    res.clearCookie(STATE_COOKIE);
    res.cookie(this.config.session.cookieName, sessionId, {
      httpOnly: true,
      secure: this.config.session.secure,
      sameSite: this.config.session.sameSite,
      maxAge: this.config.session.ttlSeconds * 1000,
    });
    res.redirect(`${this.config.frontendOrigin}/guild-select`);
  }

  @Post('logout')
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: 'Destroy the current dashboard session' })
  async logout(
    @Req() req: DashboardRequest,
    @Res() res: Response,
  ): Promise<void> {
    const session = req.dashboard?.session;
    if (session) await this.auth.logout(session.sessionId);
    res.clearCookie(this.config.session.cookieName);
    res.status(204).send();
  }

  @Get('me')
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: 'Current dashboard user' })
  me(@Req() req: DashboardRequest): unknown {
    return req.dashboard?.session.user;
  }

  private cookie(req: Request, name: string): string | null {
    const header = req.headers.cookie;
    if (!header) return null;
    for (const part of header.split(';')) {
      const idx = part.indexOf('=');
      if (idx !== -1 && part.slice(0, idx).trim() === name) {
        return decodeURIComponent(part.slice(idx + 1).trim());
      }
    }
    return null;
  }
}
