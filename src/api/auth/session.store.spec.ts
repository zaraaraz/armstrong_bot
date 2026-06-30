import { SessionStore, type SessionData } from './session.store';
import type { CacheService } from '../../cache/cache.service';
import type { ApiConfig } from '../config/api.config';

function makeCache(): { cache: CacheService; store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  const cache = {
    keys: {
      forGlobal: (_ns: string, ...parts: string[]) => parts.join(':'),
    },
    set: (key: string, value: unknown) => {
      store.set(key, value);
      return Promise.resolve();
    },
    get: (key: string) => Promise.resolve(store.get(key) ?? null),
    delete: (key: string) => {
      store.delete(key);
      return Promise.resolve();
    },
  } as unknown as CacheService;
  return { cache, store };
}

const config = { session: { ttlSeconds: 3600 } } as ApiConfig;

const data: SessionData = {
  userId: 'u1',
  username: 'user',
  displayName: 'User',
  isBotOwner: false,
  guilds: [],
  createdAt: '2026-06-30T00:00:00Z',
};

describe('SessionStore', () => {
  it('creates and resolves a session round-trip', async () => {
    const { cache } = makeCache();
    const store = new SessionStore(cache, config);
    const id = await store.create(data);
    expect(id).toHaveLength(43); // 32 bytes base64url
    const resolved = await store.resolve(id);
    expect(resolved?.userId).toBe('u1');
  });

  it('returns null for an unknown session', async () => {
    const { cache } = makeCache();
    const store = new SessionStore(cache, config);
    expect(await store.resolve('nope')).toBeNull();
  });

  it('destroys a session', async () => {
    const { cache } = makeCache();
    const store = new SessionStore(cache, config);
    const id = await store.create(data);
    await store.destroy(id);
    expect(await store.resolve(id)).toBeNull();
  });
});
