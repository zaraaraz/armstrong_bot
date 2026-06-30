import { DashboardApiKeyService } from './api-key.service';
import type { ApiKeyService as SecurityApiKeyService } from '../../../shared/security/services/api-key.service';
import type { ApiKeyRecord } from '../../../shared/security/repositories/api-key.repository';

function record(id: string): ApiKeyRecord {
  return {
    id,
    guildId: 'g1',
    name: `key-${id}`,
    hashedKey: 'h',
    prefix: 'ghk_xxxx',
    scopes: ['tickets.read'],
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    createdAt: new Date('2026-06-30T00:00:00Z'),
  };
}

describe('DashboardApiKeyService', () => {
  it('paginates the security service list', async () => {
    const records = ['1', '2', '3'].map(record);
    const security = {
      list: () => Promise.resolve(records),
    } as unknown as SecurityApiKeyService;
    const svc = new DashboardApiKeyService(security);

    const page1 = await svc.list('g1', 1, 2);
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(3);
    expect(page1.totalPages).toBe(2);

    const page2 = await svc.list('g1', 2, 2);
    expect(page2.items).toHaveLength(1);
  });

  it('returns plaintext exactly once on create and never stores it', async () => {
    const security = {
      create: () =>
        Promise.resolve({ record: record('9'), rawKey: 'ghk_secret_raw' }),
    } as unknown as SecurityApiKeyService;
    const svc = new DashboardApiKeyService(security);
    const created = await svc.create('g1', 'name', ['tickets.read'], null);
    expect(created.plaintext).toBe('ghk_secret_raw');
    expect(created.prefix).toBe('ghk_xxxx');
  });

  it('throws when revoking a key not in the guild', async () => {
    const security = {
      list: () => Promise.resolve([record('1')]),
      revoke: () => Promise.resolve(),
    } as unknown as SecurityApiKeyService;
    const svc = new DashboardApiKeyService(security);
    await expect(svc.revoke('g1', 'does-not-exist')).rejects.toThrow();
  });

  it('revokes a key that exists in the guild', async () => {
    const revoke = vi.fn().mockResolvedValue(undefined);
    const security = {
      list: () => Promise.resolve([record('1')]),
      revoke,
    } as unknown as SecurityApiKeyService;
    const svc = new DashboardApiKeyService(security);
    await svc.revoke('g1', '1');
    expect(revoke).toHaveBeenCalledWith('1');
  });
});
