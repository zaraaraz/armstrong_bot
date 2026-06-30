import { DashboardAggregationService } from './dashboard-aggregation.service';
import type { CacheService } from '../../../cache/cache.service';
import type { ModuleRegistry } from '../../../core/module-system/module-registry';
import type { DashboardAuditRepository } from '../repositories/audit.repository';

describe('DashboardAggregationService', () => {
  it('aggregates module counts and recent activity', async () => {
    const cache = {
      keys: { forGuild: (_g: string, ...p: string[]) => p.join(':') },
      // getOrSet simply invokes the loader in this unit test.
      getOrSet: (_k: string, loader: () => Promise<unknown>) => loader(),
    } as unknown as CacheService;
    const registry = {
      all: () => [{ manifest: { id: 'a' } }, { manifest: { id: 'b' } }],
    } as unknown as ModuleRegistry;
    const audit = {
      recent: () =>
        Promise.resolve([
          {
            id: 'e1',
            guildId: 'g1',
            actorId: 'u1',
            action: 'apikey.create',
            target: 'k1',
            createdAt: new Date('2026-06-30T00:00:00Z'),
          },
        ]),
    } as unknown as DashboardAuditRepository;

    const svc = new DashboardAggregationService(cache, registry, audit);
    const overview = await svc.overview('g1');
    expect(overview.modules.total).toBe(2);
    expect(overview.recentActivity).toHaveLength(1);
    expect(overview.recentActivity[0].action).toBe('apikey.create');
  });
});
