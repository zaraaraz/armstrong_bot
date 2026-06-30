import type { ExecutionContext } from '@nestjs/common';
import { GuildScopeGuard } from './guild-scope.guard';
import { ApiException } from '../../common/errors/api-exception';
import type { GuildLookupRepository } from '../../repositories/guild-lookup.repository';
import type { SessionStore } from '../session.store';
import type { ApiConfig } from '../../config/api.config';
import type { ApiRequestContext } from '../../common/context/api-actor';

const config = { session: { cookieName: 'gb_session' } } as ApiConfig;

function makeCtx(
  apiContext: ApiRequestContext,
  params: Record<string, string>,
  headers: Record<string, string> = {},
): ExecutionContext {
  const req = { apiContext, params, headers };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function build(locale = 'pt'): GuildScopeGuard {
  const guilds = {
    findByDiscordId: () =>
      Promise.resolve({ discordId: 'g1', locale, ownerId: 'o' }),
  } as unknown as GuildLookupRepository;
  const sessions = {
    resolve: () =>
      Promise.resolve({
        guilds: [
          {
            guildId: 'g1',
            name: 'G',
            roleIds: ['r1'],
            isOwner: true,
            canManage: true,
          },
        ],
      }),
  } as unknown as SessionStore;
  return new GuildScopeGuard(guilds, sessions, config);
}

describe('GuildScopeGuard', () => {
  it('skips routes without a :guildId param', async () => {
    const guard = build();
    const ctx = makeCtx({ requestId: 'r' }, {});
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('resolves guild context and enriches a user actor', async () => {
    const guard = build('en');
    const apiContext: ApiRequestContext = {
      requestId: 'r',
      actor: {
        id: 'u1',
        type: 'user',
        method: 'session',
        displayName: 'u',
        claims: new Set<string>(),
        guildScope: new Set(['g1']),
      },
    };
    const ctx = makeCtx(
      apiContext,
      { guildId: 'g1' },
      { cookie: 'gb_session=s1' },
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(apiContext.guild).toEqual({ guildId: 'g1', locale: 'en' });
    expect(apiContext.user?.discordRoleIds).toEqual(['r1']);
    expect(apiContext.user?.isGuildOwner).toBe(true);
  });

  it('404s when a user is outside their guild scope', async () => {
    const guard = build();
    const apiContext: ApiRequestContext = {
      requestId: 'r',
      actor: {
        id: 'u1',
        type: 'user',
        method: 'session',
        displayName: 'u',
        claims: new Set<string>(),
        guildScope: new Set(['other']),
      },
    };
    const ctx = makeCtx(apiContext, { guildId: 'g1' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ApiException);
  });

  it('allows a service actor with empty (global) scope', async () => {
    const guard = build();
    const apiContext: ApiRequestContext = {
      requestId: 'r',
      actor: {
        id: 'k1',
        type: 'service',
        method: 'api-key',
        displayName: 'svc',
        claims: new Set(['*']),
        guildScope: new Set<string>(),
      },
    };
    const ctx = makeCtx(apiContext, { guildId: 'g1' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(apiContext.guild?.guildId).toBe('g1');
  });
});
