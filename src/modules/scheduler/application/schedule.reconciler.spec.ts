import { ScheduleReconciler } from './schedule.reconciler';
import type { ScheduleEntity } from '../domain/schedule.entity';

function recurring(over: Partial<ScheduleEntity> = {}): ScheduleEntity {
  return {
    id: 'sch-1',
    guildId: 'g1',
    kind: 'backup',
    type: 'recurring',
    status: 'active',
    payload: {},
    idempotencyKey: 'nightly',
    cron: '0 3 * * *',
    everyMs: null,
    timezone: 'UTC',
    nextRunAt: new Date('2026-07-01T03:00:00Z'),
    lastRunAt: null,
    deferrable: true,
    maxAttempts: 5,
    bullJobId: 'sch-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...over,
  };
}

interface Built {
  reconciler: ScheduleReconciler;
  queue: {
    getRepeatableJobs: ReturnType<typeof vi.fn>;
    removeRepeatable: ReturnType<typeof vi.fn>;
    depth: ReturnType<typeof vi.fn>;
  };
  enqueue: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}

function build(
  dbActive: ScheduleEntity[],
  repeatables: Array<{
    key: string;
    name: string;
    pattern?: string;
    tz?: string;
    id?: string | null;
  }>,
): Built {
  const getRepeatableJobs = vi.fn().mockResolvedValue(repeatables);
  const removeRepeatable = vi.fn().mockResolvedValue(undefined);
  const depth = vi.fn().mockResolvedValue(0);
  const queueWrapper = {
    queue: { getRepeatableJobs },
    removeRepeatable,
    depth,
  };
  const repo = {
    findActiveRecurring: vi.fn().mockResolvedValue(dbActive),
    update: vi.fn().mockResolvedValue(undefined),
  };
  const config = { global: () => ({ reconcileIntervalMs: 60_000 }) };
  const enqueue = vi.fn().mockResolvedValue('new-key');
  const service = { enqueueRecurring: enqueue };
  const metrics = { recordDrift: vi.fn(), setQueueDepth: vi.fn() };
  const tracing = {
    withSpan: (_n: string, _a: unknown, fn: () => Promise<void>) => fn(),
  };
  const health = { markReconciled: vi.fn() };

  const reconciler = new ScheduleReconciler(
    queueWrapper as never,
    repo as never,
    config as never,
    service as never,
    metrics as never,
    tracing as never,
    health as never,
  );
  return {
    reconciler,
    queue: { getRepeatableJobs, removeRepeatable, depth },
    enqueue,
    update: repo.update,
  };
}

describe('ScheduleReconciler', () => {
  it('re-hydrates a missing repeatable job', async () => {
    const { reconciler, enqueue, update } = build([recurring()], []);
    await reconciler.reconcile();
    expect(enqueue).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith('sch-1', { bullJobId: 'new-key' });
  });

  it('removes an orphaned repeatable with no live DB row', async () => {
    const { reconciler, queue } = build(
      [],
      [
        {
          key: 'orphan-key',
          name: 'backup',
          pattern: '0 3 * * *',
          tz: 'UTC',
          id: 'gone',
        },
      ],
    );
    await reconciler.reconcile();
    expect(queue.removeRepeatable).toHaveBeenCalledWith('orphan-key');
  });

  it('corrects a drifted cron expression', async () => {
    const { reconciler, queue, enqueue } = build(
      [recurring({ cron: '0 4 * * *' })],
      [
        {
          key: 'old-key',
          name: 'backup',
          pattern: '0 3 * * *',
          tz: 'UTC',
          id: 'sch-1',
        },
      ],
    );
    await reconciler.reconcile();
    expect(queue.removeRepeatable).toHaveBeenCalledWith('old-key');
    expect(enqueue).toHaveBeenCalledOnce();
  });

  it('leaves a matching repeatable untouched', async () => {
    const { reconciler, queue, enqueue } = build(
      [recurring()],
      [
        {
          key: 'sch-1',
          name: 'backup',
          pattern: '0 3 * * *',
          tz: 'UTC',
          id: 'sch-1',
        },
      ],
    );
    await reconciler.reconcile();
    expect(enqueue).not.toHaveBeenCalled();
    expect(queue.removeRepeatable).not.toHaveBeenCalled();
  });
});
