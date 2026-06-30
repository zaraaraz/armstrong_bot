import { BackupService } from './backup.service';
import type { BackupRepository } from '../repositories/backup.repository';
import type { DashboardAuditRepository } from '../repositories/audit.repository';
import type { EventBus } from '../../../core/events/event-bus';
import type { BackupView } from '../interfaces/dashboard.interfaces';

function view(id = 'b1'): BackupView {
  return {
    id,
    guildId: 'g1',
    status: 'pending',
    jobId: null,
    sizeBytes: null,
    error: null,
    createdAt: new Date('2026-06-30T00:00:00Z'),
    completedAt: null,
  };
}

describe('BackupService', () => {
  it('creates a backup, audits it, and emits the request event', async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const publish = vi.fn().mockResolvedValue(undefined);
    const repo = {
      create: () => Promise.resolve(view()),
    } as unknown as BackupRepository;
    const audit = { record } as unknown as DashboardAuditRepository;
    const bus = { publish } as unknown as EventBus;
    const svc = new BackupService(repo, audit, bus);

    const result = await svc.request('g1', 'actor-1');
    expect(result.id).toBe('b1');
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'backup.request', target: 'b1' }),
    );
    expect(publish).toHaveBeenCalledWith(
      'dashboard.backup.requested',
      expect.objectContaining({ backupId: 'b1', guildId: 'g1' }),
      expect.any(Object),
    );
  });

  it('computes pagination metadata for a listing', async () => {
    const repo = {
      listByGuild: () =>
        Promise.resolve({ items: [view('1'), view('2')], total: 5 }),
    } as unknown as BackupRepository;
    const svc = new BackupService(
      repo,
      {} as DashboardAuditRepository,
      {} as EventBus,
    );
    const page = await svc.list('g1', 1, 2);
    expect(page.total).toBe(5);
    expect(page.totalPages).toBe(3);
    expect(page.items).toHaveLength(2);
  });
});
