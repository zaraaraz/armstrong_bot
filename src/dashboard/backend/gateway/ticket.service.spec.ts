import { TicketService } from './ticket.service';
import type { CacheService } from '../../../cache/cache.service';
import type { DashboardGlobalConfig } from '../config/dashboard.config.schema';

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
  const config = {
    realtime: { ticketTtlSeconds: 30 },
  } as DashboardGlobalConfig;
  return new TicketService(cache, config);
}

describe('TicketService', () => {
  it('issues then consumes a ticket exactly once (single-use)', async () => {
    const svc = build();
    const ticket = await svc.issue({ sessionId: 's1', discordId: 'u1' });
    expect(ticket.length).toBeGreaterThan(0);
    const first = await svc.consume(ticket);
    expect(first).toEqual({ sessionId: 's1', discordId: 'u1' });
    const second = await svc.consume(ticket);
    expect(second).toBeNull();
  });

  it('returns null for an unknown ticket', async () => {
    const svc = build();
    expect(await svc.consume('nope')).toBeNull();
  });
});
