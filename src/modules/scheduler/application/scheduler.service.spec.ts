import { SchedulerServiceImpl } from './scheduler.service';
import { SchedulerDomainService } from '../domain/scheduler.domain-service';
import { resolveSchedulerGlobalConfig } from '../config/scheduler.config';
import type { ScheduleEntity } from '../domain/schedule.entity';

const global = resolveSchedulerGlobalConfig({});

function makeEntity(over: Partial<ScheduleEntity> = {}): ScheduleEntity {
  return {
    id: 'sch-1',
    guildId: 'g1',
    kind: 'reminder',
    type: 'once',
    status: 'pending',
    payload: { text: 'hi' },
    idempotencyKey: null,
    cron: null,
    everyMs: null,
    timezone: 'UTC',
    nextRunAt: new Date('2026-06-30T10:00:00Z'),
    lastRunAt: null,
    deferrable: true,
    maxAttempts: 5,
    bullJobId: null,
    createdAt: new Date('2026-06-30T09:00:00Z'),
    updatedAt: new Date('2026-06-30T09:00:00Z'),
    deletedAt: null,
    ...over,
  };
}

interface Mocks {
  repo: {
    create: ReturnType<typeof vi.fn>;
    findByDedup: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    softDelete: ReturnType<typeof vi.fn>;
  };
  queue: {
    addOnce: ReturnType<typeof vi.fn>;
    addRecurring: ReturnType<typeof vi.fn>;
    addImmediate: ReturnType<typeof vi.fn>;
    removeJob: ReturnType<typeof vi.fn>;
    removeRepeatable: ReturnType<typeof vi.fn>;
  };
  emit: ReturnType<typeof vi.fn>;
}

function build(): { service: SchedulerServiceImpl; mocks: Mocks } {
  const created = makeEntity();
  const repo = {
    create: vi.fn().mockResolvedValue(created),
    findByDedup: vi.fn().mockResolvedValue(null),
    findById: vi.fn().mockResolvedValue(created),
    update: vi.fn().mockResolvedValue(created),
    softDelete: vi.fn().mockResolvedValue(undefined),
  };
  const queue = {
    addOnce: vi.fn().mockResolvedValue(undefined),
    addRecurring: vi.fn().mockResolvedValue('repeat-key'),
    addImmediate: vi.fn().mockResolvedValue(undefined),
    removeJob: vi.fn().mockResolvedValue(undefined),
    removeRepeatable: vi.fn().mockResolvedValue(undefined),
  };
  const emit = vi.fn().mockResolvedValue(undefined);
  const config = {
    global: () => global,
    forGuild: vi.fn().mockResolvedValue({
      timezone: 'UTC',
      maintenanceWindows: [],
      cleanupEnabled: true,
    }),
  };
  const emitter = {
    emit,
    events: { Scheduled: 's', Deferred: 'd', Cancelled: 'c' },
  };
  const tracing = { currentTraceId: () => 'trace-1', withSpan: vi.fn() };

  const service = new SchedulerServiceImpl(
    repo as never,
    queue as never,
    new SchedulerDomainService(),
    config as never,
    emitter as never,
    tracing as never,
  );
  return { service, mocks: { repo, queue, emit } };
}

describe('SchedulerServiceImpl', () => {
  it('scheduleOnce persists, enqueues with a delay, and emits Scheduled', async () => {
    const { service, mocks } = build();
    const ref = await service.scheduleOnce({
      guildId: 'g1',
      kind: 'reminder',
      payload: { text: 'hi' },
      delayMs: 60_000,
    });

    expect(mocks.repo.create).toHaveBeenCalledOnce();
    expect(mocks.queue.addOnce).toHaveBeenCalledOnce();
    expect(mocks.emit).toHaveBeenCalledWith(
      's',
      expect.objectContaining({ jobId: 'sch-1' }),
    );
    expect(ref.id).toBe('sch-1');
  });

  it('scheduleOnce replaces an existing pending job with the same idempotency key', async () => {
    const { service, mocks } = build();
    mocks.repo.findByDedup.mockResolvedValueOnce(
      makeEntity({ id: 'old', status: 'pending', bullJobId: 'old' }),
    );

    await service.scheduleOnce({
      guildId: 'g1',
      kind: 'reminder',
      payload: {},
      delayMs: 1000,
      idempotencyKey: 'dedup-1',
    });

    // Old pending job removed from queue + soft-deleted before re-creating.
    expect(mocks.queue.removeJob).toHaveBeenCalledWith('old');
    expect(mocks.repo.softDelete).toHaveBeenCalledWith('old');
    expect(mocks.repo.create).toHaveBeenCalledOnce();
  });

  it('cancel removes the queue entry, soft-deletes and emits Cancelled', async () => {
    const { service, mocks } = build();
    mocks.repo.findById.mockResolvedValueOnce(
      makeEntity({ id: 'sch-1', bullJobId: 'sch-1', type: 'once' }),
    );

    const ok = await service.cancel('sch-1', 'g1');

    expect(ok).toBe(true);
    expect(mocks.queue.removeJob).toHaveBeenCalledWith('sch-1');
    expect(mocks.repo.softDelete).toHaveBeenCalledWith('sch-1');
    expect(mocks.emit).toHaveBeenCalledWith(
      'c',
      expect.objectContaining({ status: 'cancelled' }),
    );
  });

  it('scheduleRecurring registers a repeatable job and stores the repeat key', async () => {
    const { service, mocks } = build();
    mocks.repo.create.mockResolvedValueOnce(
      makeEntity({
        id: 'rec-1',
        type: 'recurring',
        status: 'active',
        cron: '0 3 * * *',
      }),
    );

    await service.scheduleRecurring({
      guildId: 'g1',
      kind: 'backup',
      payload: {},
      cron: '0 3 * * *',
      idempotencyKey: 'nightly',
    });

    expect(mocks.queue.addRecurring).toHaveBeenCalledOnce();
    expect(mocks.repo.update).toHaveBeenCalledWith('rec-1', {
      bullJobId: 'repeat-key',
    });
  });

  it('pause rejects a one-shot job', async () => {
    const { service, mocks } = build();
    mocks.repo.findById.mockResolvedValueOnce(makeEntity({ type: 'once' }));
    await expect(service.pause('sch-1', 'g1')).rejects.toThrow(/recurring/);
  });

  it('pause removes the repeatable and marks the job paused', async () => {
    const { service, mocks } = build();
    mocks.repo.findById.mockResolvedValueOnce(
      makeEntity({ type: 'recurring', status: 'active', bullJobId: 'rk' }),
    );
    const ok = await service.pause('sch-1', 'g1');
    expect(ok).toBe(true);
    expect(mocks.queue.removeRepeatable).toHaveBeenCalledWith('rk');
    expect(mocks.repo.update).toHaveBeenCalledWith('sch-1', {
      status: 'paused',
      bullJobId: null,
    });
  });

  it('resume rejects a job that is not paused', async () => {
    const { service, mocks } = build();
    mocks.repo.findById.mockResolvedValueOnce(
      makeEntity({ type: 'recurring', status: 'active' }),
    );
    await expect(service.resume('sch-1', 'g1')).rejects.toThrow(/not paused/);
  });

  it('resume re-enqueues a paused recurring job', async () => {
    const { service, mocks } = build();
    mocks.repo.findById.mockResolvedValueOnce(
      makeEntity({ type: 'recurring', status: 'paused', cron: '0 3 * * *' }),
    );
    const ok = await service.resume('sch-1', 'g1');
    expect(ok).toBe(true);
    expect(mocks.queue.addRecurring).toHaveBeenCalledOnce();
    expect(mocks.repo.update).toHaveBeenCalledWith('sch-1', {
      status: 'active',
      bullJobId: 'repeat-key',
    });
  });

  it('triggerNow enqueues an immediate execution', async () => {
    const { service, mocks } = build();
    mocks.repo.findById.mockResolvedValueOnce(makeEntity());
    await service.triggerNow('sch-1', 'g1');
    expect(mocks.queue.addImmediate).toHaveBeenCalledOnce();
  });

  it('get returns null for an unknown job', async () => {
    const { service, mocks } = build();
    mocks.repo.findById.mockResolvedValueOnce(null);
    expect(await service.get('missing', 'g1')).toBeNull();
  });

  it('requireJob throws NotFound when the job is absent (cancel)', async () => {
    const { service, mocks } = build();
    mocks.repo.findById.mockResolvedValueOnce(null);
    await expect(service.cancel('missing', 'g1')).rejects.toThrow(/not found/);
  });

  it('scheduleOnce defers a job inside a maintenance window', async () => {
    const created = makeEntity({ id: 'def-1' });
    const repo = {
      create: vi.fn().mockResolvedValue(created),
      findByDedup: vi.fn().mockResolvedValue(null),
      findById: vi.fn().mockResolvedValue(created),
      update: vi.fn().mockResolvedValue(created),
      softDelete: vi.fn().mockResolvedValue(undefined),
    };
    const queue = {
      addOnce: vi.fn().mockResolvedValue(undefined),
      addRecurring: vi.fn(),
      addImmediate: vi.fn(),
      removeJob: vi.fn(),
      removeRepeatable: vi.fn(),
    };
    const emit = vi.fn().mockResolvedValue(undefined);
    const config = {
      global: () => global,
      forGuild: vi.fn().mockResolvedValue({
        timezone: 'UTC',
        maintenanceWindows: [
          { cron: '0 3 * * *', durationMinutes: 60, deferNonCritical: true },
        ],
        cleanupEnabled: true,
      }),
    };
    const emitter = {
      emit,
      events: { Scheduled: 's', Deferred: 'd', Cancelled: 'c' },
    };
    const tracing = { currentTraceId: () => 't', withSpan: vi.fn() };
    const service = new SchedulerServiceImpl(
      repo as never,
      queue as never,
      new SchedulerDomainService(),
      config as never,
      emitter as never,
      tracing as never,
    );

    await service.scheduleOnce({
      guildId: 'g1',
      kind: 'reminder',
      payload: {},
      runAt: new Date('2026-06-30T03:10:00Z'), // inside the window
    });

    // Deferred event emitted in addition to Scheduled.
    expect(emit).toHaveBeenCalledWith('d', expect.anything());
  });
});
