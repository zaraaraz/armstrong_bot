import { describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import { AuditIngestProcessor } from './audit-ingest.processor';
import { AuditChainService } from '../domain/audit-chain.service';
import { AuditSeqConflictError } from '../infrastructure/audit.repository.interface';
import type { AuditEntry, AuditEntryDraft } from '../domain/audit-entry.model';
import {
  AuditActorType,
  AuditScope,
  AuditSource,
} from '../domain/audit-scope.enum';

function makeDraft(overrides: Partial<AuditEntryDraft> = {}): AuditEntryDraft {
  return {
    scope: AuditScope.Guild,
    guildId: 'g1',
    action: 'tickets.ticket.closed',
    source: AuditSource.Command,
    actorId: 'u1',
    actorType: AuditActorType.User,
    targetType: 'ticket',
    targetId: 't1',
    channelId: null,
    correlationId: 'corr-1',
    causationId: null,
    summary: 'audit:actions.tickets.ticket.closed',
    metadata: {},
    before: null,
    after: null,
    occurredAt: new Date('2026-07-01T10:00:00Z'),
    ...overrides,
  };
}

function entryFrom(
  draft: AuditEntryDraft,
  seq: bigint,
  previousHash: string | null,
  hash: string,
): AuditEntry {
  return {
    ...draft,
    id: `e-${seq}`,
    seq,
    previousHash,
    hash,
    createdAt: new Date(),
  };
}

function build(options: { lastSeq?: bigint | null } = {}) {
  const chain = new AuditChainService();
  const persisted: AuditEntry[] = [];
  let last: AuditEntry | null =
    options.lastSeq != null
      ? entryFrom(makeDraft(), options.lastSeq, null, 'prev-hash')
      : null;

  const repo = {
    findLast: vi.fn(() => Promise.resolve(last)),
    append: vi.fn(
      (
        draft: AuditEntryDraft,
        seq: bigint,
        previousHash: string | null,
        hash: string,
      ) => {
        const entry = entryFrom(draft, seq, previousHash, hash);
        persisted.push(entry);
        last = entry;
        return Promise.resolve(entry);
      },
    ),
  };
  const retention = { run: vi.fn().mockResolvedValue({}) };
  const config = {
    global: () => ({
      hashAlgorithm: 'sha256',
      ingestConcurrency: 4,
      retentionCron: '0 4 * * *',
    }),
  };
  const emit = vi.fn().mockResolvedValue(undefined);
  const metrics = {
    recordIngest: vi.fn(),
    observePersist: vi.fn(),
  };
  const tracing = {
    withSpan: vi.fn(
      (_n: string, _a: unknown, fn: () => Promise<unknown>): Promise<unknown> =>
        fn(),
    ),
  };
  const queue = {
    connection: { host: 'x', port: 0 },
    ensureRetentionJob: vi.fn(),
  };

  const processor = new AuditIngestProcessor(
    queue as never,
    repo as never,
    chain,
    retention as never,
    config as never,
    { emit } as never,
    metrics as never,
    tracing as never,
  );
  return { processor, repo, retention, emit, metrics, chain, persisted };
}

function ingestJob(draft: AuditEntryDraft): Job {
  return {
    name: 'ingest',
    data: { draft: { ...draft, occurredAt: draft.occurredAt.toISOString() } },
  } as unknown as Job;
}

async function processJob(processor: AuditIngestProcessor, job: Job) {
  // exercise the private BullMQ handler directly — the Worker itself needs Redis
  await (processor as unknown as { process(job: Job): Promise<void> }).process(
    job,
  );
}

describe('AuditIngestProcessor', () => {
  it('persists the first entry with seq 1 and a null previousHash', async () => {
    const { processor, persisted, chain } = build();
    await processJob(processor, ingestJob(makeDraft()));

    expect(persisted).toHaveLength(1);
    expect(persisted[0].seq).toBe(1n);
    expect(persisted[0].previousHash).toBeNull();
    expect(persisted[0].hash).toBe(
      chain.computeHash(persisted[0], 1n, null, 'sha256'),
    );
  });

  it('chains onto the previous entry: seq+1 and previousHash = last.hash', async () => {
    const { processor, persisted } = build({ lastSeq: 41n });
    await processJob(processor, ingestJob(makeDraft()));
    expect(persisted[0].seq).toBe(42n);
    expect(persisted[0].previousHash).toBe('prev-hash');
  });

  it('emits audit.entry.recorded after persisting', async () => {
    const { processor, emit, metrics } = build();
    await processJob(processor, ingestJob(makeDraft()));
    expect(emit).toHaveBeenCalledWith(
      'audit.entry.recorded',
      expect.objectContaining({
        seq: '1',
        action: 'tickets.ticket.closed',
        correlationId: 'corr-1',
      }),
      'g1',
    );
    expect(metrics.recordIngest).toHaveBeenCalledWith('persisted');
  });

  it('retries on seq conflicts by re-reading the tail (optimistic append)', async () => {
    const { processor, repo, persisted } = build();
    const original = repo.append.getMockImplementation()!;
    repo.append
      .mockRejectedValueOnce(
        new AuditSeqConflictError(AuditScope.Guild, 'g1', 1n),
      )
      .mockImplementation(original);

    await processJob(processor, ingestJob(makeDraft()));
    expect(repo.append).toHaveBeenCalledTimes(2);
    expect(repo.findLast).toHaveBeenCalledTimes(2);
    expect(persisted).toHaveLength(1);
  });

  it('gives up after bounded attempts under persistent contention', async () => {
    const { processor, repo } = build();
    repo.append.mockRejectedValue(
      new AuditSeqConflictError(AuditScope.Guild, 'g1', 1n),
    );
    await expect(processJob(processor, ingestJob(makeDraft()))).rejects.toThrow(
      /seq conflict/,
    );
    expect(repo.append).toHaveBeenCalledTimes(5);
  });

  it('rethrows non-conflict persistence errors so BullMQ retries/DLQs the job', async () => {
    const { processor, repo } = build();
    repo.append.mockRejectedValue(new Error('db down'));
    await expect(processJob(processor, ingestJob(makeDraft()))).rejects.toThrow(
      'db down',
    );
    expect(repo.append).toHaveBeenCalledTimes(1);
  });

  it('does not fail (or re-append) when the recorded-event emit fails post-persist', async () => {
    const { processor, emit, persisted } = build();
    emit.mockRejectedValueOnce(new Error('bus down'));
    await expect(
      processJob(processor, ingestJob(makeDraft())),
    ).resolves.toBeUndefined();
    expect(persisted).toHaveLength(1);
  });

  it('serialises concurrent appends on the same chain (strictly monotonic seq)', async () => {
    const { processor, persisted } = build();
    await Promise.all([
      processJob(processor, ingestJob(makeDraft({ correlationId: 'a' }))),
      processJob(processor, ingestJob(makeDraft({ correlationId: 'b' }))),
      processJob(processor, ingestJob(makeDraft({ correlationId: 'c' }))),
    ]);
    expect(persisted.map((e) => e.seq)).toEqual([1n, 2n, 3n]);
    expect(persisted[1].previousHash).toBe(persisted[0].hash);
    expect(persisted[2].previousHash).toBe(persisted[1].hash);
  });

  it('dispatches the retention job name to RetentionService.run', async () => {
    const { processor, retention } = build();
    await processJob(processor, {
      name: 'retention',
      data: {},
    } as unknown as Job);
    expect(retention.run).toHaveBeenCalledOnce();
  });
});
