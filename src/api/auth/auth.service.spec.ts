import { AuthService } from './auth.service';
import type { DiscordOAuthService } from './discord-oauth.service';
import type { SessionStore } from './session.store';
import type { AuthenticatedActor } from '../common/context/api-actor';

describe('AuthService', () => {
  it('builds the authorize URL via the OAuth service', () => {
    const oauth = {
      buildAuthorizeUrl: () => ({ url: 'https://d/authorize', state: 'st' }),
    } as unknown as DiscordOAuthService;
    const svc = new AuthService(oauth, {} as SessionStore);
    expect(svc.buildAuthorizeUrl()).toEqual({
      url: 'https://d/authorize',
      state: 'st',
    });
  });

  it('completes login, flags bot owners, and creates a session', async () => {
    const oauth = {
      exchangeCode: () =>
        Promise.resolve({
          user: {
            id: 'owner-1',
            username: 'o',
            global_name: 'O',
            avatar: null,
          },
          guilds: [],
          refreshToken: 'r',
        }),
    } as unknown as DiscordOAuthService;
    const create = vi.fn().mockResolvedValue('sess-1');
    const sessions = { create } as unknown as SessionStore;
    const svc = new AuthService(oauth, sessions);

    const result = await svc.completeLogin('code', new Set(['owner-1']));
    expect(result.sessionId).toBe('sess-1');
    expect(result.refreshToken).toBe('r');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ isBotOwner: true, displayName: 'O' }),
    );
  });

  it('does not flag a non-owner user as bot owner', async () => {
    const oauth = {
      exchangeCode: () =>
        Promise.resolve({
          user: { id: 'u-2', username: 'x', global_name: null, avatar: null },
          guilds: [],
          refreshToken: 'r',
        }),
    } as unknown as DiscordOAuthService;
    const create = vi.fn().mockResolvedValue('sess-2');
    const svc = new AuthService(oauth, { create } as unknown as SessionStore);
    await svc.completeLogin('code', new Set(['someone-else']));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ isBotOwner: false, displayName: 'x' }),
    );
  });

  it('delegates logout to the session store', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    const svc = new AuthService(
      {} as DiscordOAuthService,
      { destroy } as unknown as SessionStore,
    );
    await svc.logout('sess-1');
    expect(destroy).toHaveBeenCalledWith('sess-1');
  });

  it('describes an actor for /auth/me', () => {
    const svc = new AuthService({} as DiscordOAuthService, {} as SessionStore);
    const actor: AuthenticatedActor = {
      id: 'u1',
      type: 'user',
      method: 'session',
      displayName: 'U',
      claims: new Set(['a']),
      guildScope: new Set(['g1']),
    };
    expect(svc.describe(actor)).toEqual({
      id: 'u1',
      type: 'user',
      method: 'session',
      displayName: 'U',
      claims: ['a'],
      guildScope: ['g1'],
    });
  });
});
