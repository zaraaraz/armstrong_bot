import { DashboardSessionService } from './session.service';
import type { CacheService } from '../../../cache/cache.service';
import type { EncryptionService } from '../../../shared/security/services/encryption.service';
import type { DashboardSessionRepository } from '../repositories/session.repository';
import type { DashboardGlobalConfig } from '../config/dashboard.config.schema';
import type { DashboardUser } from '../interfaces/dashboard.interfaces';

const user: DashboardUser = {
  discordId: 'u1',
  username: 'u',
  globalName: 'U',
  avatarHash: null,
  isBotOwner: false,
};

function build() {
  const store = new Map<string, unknown>();
  const cache = {
    keys: { forGlobal: (_ns: string, ...p: string[]) => p.join(':') },
    set: (k: string, v: unknown) => {
      store.set(k, v);
      return Promise.resolve();
    },
    get: (k: string) => Promise.resolve(store.get(k) ?? null),
    delete: (k: string) => {
      store.delete(k);
      return Promise.resolve();
    },
  } as unknown as CacheService;
  const encryption = {
    encrypt: (s: string) => `enc(${s})`,
  } as unknown as EncryptionService;
  const created: { id: string } = { id: 'sess-1' };
  const repo = {
    create: () => Promise.resolve({ id: created.id }),
    findActive: () => Promise.resolve(null),
    revoke: () => Promise.resolve(),
  } as unknown as DashboardSessionRepository;
  const config = {
    session: { ttlSeconds: 3600 },
  } as DashboardGlobalConfig;
  return {
    svc: new DashboardSessionService(cache, encryption, repo, config),
    encryption,
  };
}

describe('DashboardSessionService', () => {
  it('creates a session, encrypting the refresh token', async () => {
    const { svc, encryption } = build();
    const spy = vi.spyOn(encryption, 'encrypt');
    const id = await svc.create(user, 'refresh-tok', []);
    expect(id).toBe('sess-1');
    expect(spy).toHaveBeenCalledWith('refresh-tok');
  });

  it('resolves a hot session from cache', async () => {
    const { svc } = build();
    const id = await svc.create(user, 'r', []);
    const resolved = await svc.resolve(id);
    expect(resolved?.user.discordId).toBe('u1');
  });

  it('returns null for an unknown session', async () => {
    const { svc } = build();
    expect(await svc.resolve('missing')).toBeNull();
  });

  it('destroys a session in cache and durable store', async () => {
    const { svc } = build();
    const id = await svc.create(user, 'r', []);
    await svc.destroy(id);
    expect(await svc.resolve(id)).toBeNull();
  });
});
