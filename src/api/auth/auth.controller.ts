import { Controller, Get, Inject, Post, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { API_CONFIG, type ApiConfig } from '../config/api.config';
import { ApiException } from '../common/errors/api-exception';
import { getApiContext } from '../common/context/request-id';
import { parseCookies } from '../common/http/cookies';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedActor } from '../common/context/api-actor';
import { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';
import { ApiProtected } from '../common/decorators/api-protected.decorator';

const STATE_COOKIE = 'gb_oauth_state';

@ApiTags('auth')
@ApiProtected()
@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly configService: ConfigService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  @Get('login')
  @Public()
  @ApiExcludeEndpoint()
  login(@Res() res: Response): void {
    const { url, state } = this.auth.buildAuthorizeUrl();
    res.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      secure: this.config.session.secure,
      sameSite: 'lax',
      maxAge: 5 * 60 * 1000,
    });
    res.redirect(url);
  }

  @Get('callback')
  @Public()
  @ApiExcludeEndpoint()
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const expectedState = parseCookies(req)[STATE_COOKIE];
    if (!code || !state || !expectedState || state !== expectedState) {
      throw ApiException.unauthorized('Invalid OAuth state.');
    }

    const { sessionId } = await this.auth.completeLogin(
      code,
      this.botOwnerIds(),
    );
    res.clearCookie(STATE_COOKIE);
    res.cookie(this.config.session.cookieName, sessionId, {
      httpOnly: true,
      secure: this.config.session.secure,
      sameSite: 'lax',
      maxAge: this.config.session.ttlSeconds * 1000,
    });
    res.redirect(this.config.corsOrigins[0] ?? '/');
  }

  @Post('logout')
  @ApiOperation({ summary: 'Destroy the current session' })
  async logout(@Req() req: Request, @Res() res: Response): Promise<void> {
    const sessionId = parseCookies(req)[this.config.session.cookieName];
    if (sessionId) await this.auth.logout(sessionId);
    res.clearCookie(this.config.session.cookieName);
    res.status(204).send();
  }

  @Get('me')
  @ApiOperation({ summary: 'Return the current authenticated actor' })
  @ApiOkResponse({ description: 'The current AuthenticatedActor projection' })
  me(@CurrentUser() actor: AuthenticatedActor, @Req() req: Request): unknown {
    void getApiContext(req);
    return this.auth.describe(actor);
  }

  private botOwnerIds(): ReadonlySet<string> {
    const raw =
      this.configService.get<string>('PERMISSION_BOT_OWNER_IDS') ?? '';
    return new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }
}
