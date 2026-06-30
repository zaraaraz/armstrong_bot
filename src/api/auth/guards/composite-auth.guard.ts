import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { EventBus } from '../../../core/events/event-bus';
import { ApiKeyService } from '../../../shared/security/services/api-key.service';
import { API_CONFIG, type ApiConfig } from '../../config/api.config';
import { ApiException } from '../../common/errors/api-exception';
import { getApiContext } from '../../common/context/request-id';
import type { AuthenticatedActor } from '../../common/context/api-actor';
import { parseCookies } from '../../common/http/cookies';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { JwtService } from '../jwt.service';
import { SessionStore, type SessionData } from '../session.store';

/**
 * First guard in the chain. Resolves the request principal by trying, in
 * order: session cookie → bearer JWT → `x-api-key`. On success it attaches the
 * {@link AuthenticatedActor} to the request context (plus a `user` mirror the
 * core permissions guard reads). Public routes bypass authentication.
 * Failures emit `api.auth.failed` and throw 401.
 */
@Injectable()
export class CompositeAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionStore,
    private readonly jwt: JwtService,
    private readonly apiKeys: ApiKeyService,
    @Inject(EventBus) private readonly eventBus: EventBus,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );

    const req = context.switchToHttp().getRequest<Request>();
    const ctx = getApiContext(req);

    const actor =
      (await this.trySession(req)) ??
      this.tryJwt(req) ??
      (await this.tryApiKey(req));

    if (actor) {
      ctx.actor = actor;
      this.mirrorUser(ctx, actor);
      return true;
    }

    if (isPublic) return true;

    await this.eventBus.publish(
      'api.auth.failed',
      {
        method: this.attemptedMethod(req),
        reason: 'no_valid_credentials',
        ip: req.ip ?? null,
        requestId: ctx.requestId,
      },
      { actor: { type: 'api', id: 'api' } },
    );
    throw ApiException.unauthorized();
  }

  private async trySession(req: Request): Promise<AuthenticatedActor | null> {
    const sessionId = parseCookies(req)[this.config.session.cookieName];
    if (!sessionId) return null;
    const data = await this.sessions.resolve(sessionId);
    if (!data) return null;
    return this.actorFromSession(data);
  }

  private tryJwt(req: Request): AuthenticatedActor | null {
    const auth = req.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) return null;
    const token = auth.slice('Bearer '.length);
    // A raw API key may also arrive as a bearer token; skip those here.
    if (token.startsWith('ghk_')) return null;
    const claims = this.jwt.verify(token);
    if (!claims) return null;
    return {
      id: claims.sub,
      type: claims.type,
      method: 'jwt',
      displayName: claims.name,
      claims: new Set(claims.scopes),
      guildScope: new Set(claims.guilds),
    };
  }

  private async tryApiKey(req: Request): Promise<AuthenticatedActor | null> {
    const raw = this.extractApiKey(req);
    if (!raw) return null;
    const record = await this.apiKeys.authenticate(raw);
    if (!record) return null;
    return {
      id: record.id,
      type: 'service',
      method: 'api-key',
      displayName: record.name,
      claims: new Set(record.scopes),
      guildScope: new Set(record.guildId ? [record.guildId] : []),
    };
  }

  private actorFromSession(data: SessionData): AuthenticatedActor {
    // A user's effective claims are resolved per-guild by the permissions
    // guard; the session-level claim set is empty (claims are guild-scoped).
    return {
      id: data.userId,
      type: 'user',
      method: 'session',
      displayName: data.displayName,
      claims: new Set<string>(),
      guildScope: new Set(data.guilds.map((g) => g.guildId)),
    };
  }

  private mirrorUser(
    ctx: ReturnType<typeof getApiContext>,
    actor: AuthenticatedActor,
  ): void {
    // The guild-scope guard fills in roles/owner once :guildId is resolved.
    ctx.user = {
      id: actor.id,
      guildId: '',
      discordRoleIds: [],
      isGuildOwner: false,
    };
  }

  private extractApiKey(req: Request): string | null {
    const header = req.headers['x-api-key'];
    if (typeof header === 'string' && header.length > 0) return header;
    const auth = req.headers.authorization;
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      const token = auth.slice('Bearer '.length);
      if (token.startsWith('ghk_')) return token;
    }
    return null;
  }

  private attemptedMethod(req: Request): 'session' | 'jwt' | 'api-key' {
    if (req.headers['x-api-key']) return 'api-key';
    if (parseCookies(req)[this.config.session.cookieName]) return 'session';
    return 'jwt';
  }
}
