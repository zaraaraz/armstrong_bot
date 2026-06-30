import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CompositeAuthGuard } from './composite-auth.guard';
import { ApiException } from '../../common/errors/api-exception';
import type { ApiConfig } from '../../config/api.config';
import type { JwtService } from '../jwt.service';
import type { SessionStore } from '../session.store';
import type { ApiKeyService } from '../../../shared/security/services/api-key.service';
import type { EventBus } from '../../../core/events/event-bus';

function makeContext(
  req: Record<string, unknown>,
  isPublic = false,
): {
  ctx: ExecutionContext;
  reflector: Reflector;
} {
  const reflector = {
    getAllAndOverride: () => (isPublic ? true : undefined),
  } as unknown as Reflector;
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { ctx, reflector };
}

const config = {
  session: { cookieName: 'gb_session' },
} as ApiConfig;

const eventBus = { publish: () => Promise.resolve() } as unknown as EventBus;

function build(overrides: {
  sessions?: Partial<SessionStore>;
  jwt?: Partial<JwtService>;
  apiKeys?: Partial<ApiKeyService>;
  reflector: Reflector;
}): CompositeAuthGuard {
  return new CompositeAuthGuard(
    overrides.reflector,
    (overrides.sessions ?? {
      resolve: () => Promise.resolve(null),
    }) as SessionStore,
    (overrides.jwt ?? { verify: () => null }) as JwtService,
    (overrides.apiKeys ?? {
      authenticate: () => Promise.resolve(null),
    }) as ApiKeyService,
    eventBus,
    config,
  );
}

describe('CompositeAuthGuard', () => {
  it('authenticates via a valid API key', async () => {
    const req: Record<string, unknown> = {
      headers: { 'x-api-key': 'ghk_abc' },
    };
    const { ctx, reflector } = makeContext(req);
    const guard = build({
      reflector,
      apiKeys: {
        authenticate: () =>
          Promise.resolve({
            id: 'key1',
            guildId: 'g1',
            name: 'svc',
            scopes: ['tickets.read'],
          } as never),
      },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    const apiContext = (req as { apiContext?: { actor?: { method?: string } } })
      .apiContext;
    expect(apiContext?.actor?.method).toBe('api-key');
  });

  it('authenticates via a valid JWT', async () => {
    const req: Record<string, unknown> = {
      headers: { authorization: 'Bearer header.body.sig' },
    };
    const { ctx, reflector } = makeContext(req);
    const guard = build({
      reflector,
      jwt: {
        verify: () => ({
          sub: 'u1',
          type: 'user',
          name: 'n',
          scopes: ['x'],
          guilds: ['g1'],
          iss: 'ghost-bot',
          iat: 0,
          exp: 9,
        }),
      },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('throws 401 when no credentials and route is not public', async () => {
    const req: Record<string, unknown> = { headers: {}, ip: '1.2.3.4' };
    const { ctx, reflector } = makeContext(req);
    const guard = build({ reflector });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ApiException);
  });

  it('allows an unauthenticated request to a public route', async () => {
    const req: Record<string, unknown> = { headers: {} };
    const { ctx, reflector } = makeContext(req, true);
    const guard = build({ reflector });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
