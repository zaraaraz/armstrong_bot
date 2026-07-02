import { describe, expect, it, vi } from 'vitest';
import { RetentionService } from './retention.service';
import { AuditScope } from './audit-scope.enum';
import type { AuditEntry } from './audit-entry.model';

const NOW = new Date('2026-07-02T04:00:00Z');

function makeEntry(
  seq: bigint,
  overrides: Partial<AuditEntry> = {},
): AuditEntry {
  return {
    id: `e-${seq}`,
    scope: AuditScope.Guild,
    guildId: 'g1',
    seq,
    action: 'tickets.ticket.closed',
    source: 'COMMAND',
    actorId: 'u1',
    actorType: 'USER',
    targetType: 'ticket',
    targetId: 't1',
    channelId: null,
    correlationId: `c-${seq}`,
    causationId: null,
    summary: 's',
    metadata: {},
    before: null,
    after: null,
    previousHash: null,
    hash: `hash-${seq}`,
    occurredAt: new Date('2025-01-01T00:00:00Z'),
    createdAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  } as AuditEntry;
}

interface BuildOptions {
  heads?: Array<{ scope: AuditScope; guildId: string | null }>;
  firstSeq?: bigint | null;
  firstRetained?: bigint | null;
  last?: AuditEntry | null;
  boundary?: AuditEntry | null;
  guildConfig?: Partial<{
    retentionDays: number;
    archiveBeforeDelete: boolean;
    archiveFormat: string;
  }>;
}

function build(options: BuildOptions = {}) {
  const repo = {
    chainHeads: vi
      .fn()
      .mockResolvedValue(
        options.heads ?? [{ scope: AuditScope.Guild, guildId: 'g1' }],
      ),
    firstSeq: vi
      .fn()
      .mockResolvedValue(
        options.firstSeq === undefined ? 1n : options.firstSeq,
      ),
    firstSeqAtOrAfter: vi
      .fn()
      .mockResolvedValue(
        options.firstRetained === undefined ? 51n : options.firstRetained,
      ),
    findLast: vi.fn().mockResolvedValue(options.last ?? makeEntry(80n)),
    findBySeq: vi
      .fn()
      .mockResolvedValue(
        options.boundary === undefined ? makeEntry(50n) : options.boundary,
      ),
    iterateChainRange: vi.fn().mockReturnValue(
      (async function* () {
        await Promise.resolve();
        yield makeEntry(1n);
      })(),
    ),
    createArchive: vi.fn().mockResolvedValue(undefined),
    pruneUpTo: vi.fn().mockResolvedValue(50),
  };
  const config = {
    global: () => ({ archiveDir: '/archives' }),
    forGuild: vi.fn().mockResolvedValue({
      retentionDays: 365,
      archiveBeforeDelete: true,
      archiveFormat: 'ndjson',
      ...options.guildConfig,
    }),
  };
  const store = {
    write: vi.fn().mockResolvedValue({
      storageRef: '/archives/guild/g1/x.ndjson',
      byteSize: 1234,
      checksum: 'sum',
    }),
  };
  const writer = {
    serialise: vi.fn().mockReturnValue(
      (async function* () {
        await Promise.resolve();
        yield 'line\n';
      })(),
    ),
  };
  const emit = vi.fn().mockResolvedValue(undefined);
  const metrics = { recordPruned: vi.fn() };
  const service = new RetentionService(
    config as never,
    repo as never,
    store as never,
    writer as never,
    { emit } as never,
    metrics as never,
  );
  return { service, repo, store, writer, emit, metrics, config };
}

describe('RetentionService', () => {
  it('computes the cutoff from retentionDays', () => {
    const { service } = build();
    const cutoff = service.computeCutoff(NOW, 30);
    expect(cutoff.toISOString()).toBe('2026-06-02T04:00:00.000Z');
  });

  it('archives before pruning: write -> archive row -> prune, with the boundary hash as rootHash', async () => {
    const { service, repo, store } = build();
    const result = await service.run(NOW);

    expect(store.write).toHaveBeenCalledOnce();
    const [rootDir, relativePath] = store.write.mock.calls[0] as [
      string,
      string,
    ];
    expect(rootDir).toBe('/archives');
    expect(relativePath).toBe('guild/g1/2026-07-02-1-50.ndjson');

    expect(repo.createArchive).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: AuditScope.Guild,
        guildId: 'g1',
        fromSeq: 1n,
        toSeq: 50n,
        entryCount: 50,
        byteSize: 1234,
        rootHash: 'hash-50',
        storageRef: '/archives/guild/g1/x.ndjson',
      }),
    );
    expect(repo.pruneUpTo).toHaveBeenCalledWith(AuditScope.Guild, 'g1', 50n);
    // ordering: archive row exists before pruning happens
    expect(repo.createArchive.mock.invocationCallOrder[0]).toBeLessThan(
      repo.pruneUpTo.mock.invocationCallOrder[0],
    );
    expect(result).toEqual({
      chainsExamined: 1,
      chainsPruned: 1,
      entriesPruned: 50,
    });
  });

  it('emits audit.retention.archived with the pruned range', async () => {
    const { service, emit } = build();
    await service.run(NOW);
    expect(emit).toHaveBeenCalledWith(
      'audit.retention.archived',
      expect.objectContaining({ fromSeq: '1', toSeq: '50', entryCount: 50 }),
      'g1',
    );
  });

  it('prunes without archiving when archiveBeforeDelete is false', async () => {
    const { service, repo, store } = build({
      guildConfig: { archiveBeforeDelete: false },
    });
    await service.run(NOW);
    expect(store.write).not.toHaveBeenCalled();
    expect(repo.createArchive).not.toHaveBeenCalled();
    expect(repo.pruneUpTo).toHaveBeenCalledOnce();
  });

  it('prunes the whole chain when every entry is past retention', async () => {
    const { service, repo } = build({
      firstRetained: null,
      last: makeEntry(80n),
      boundary: makeEntry(80n),
    });
    await service.run(NOW);
    expect(repo.pruneUpTo).toHaveBeenCalledWith(AuditScope.Guild, 'g1', 80n);
  });

  it('does nothing when the first retained entry is the chain start', async () => {
    const { service, repo, store } = build({ firstRetained: 1n });
    const result = await service.run(NOW);
    expect(store.write).not.toHaveBeenCalled();
    expect(repo.pruneUpTo).not.toHaveBeenCalled();
    expect(result.entriesPruned).toBe(0);
  });

  it('skips empty chains', async () => {
    const { service, repo } = build({ firstSeq: null });
    const result = await service.run(NOW);
    expect(repo.pruneUpTo).not.toHaveBeenCalled();
    expect(result.chainsPruned).toBe(0);
  });

  it('isolates faults: a failing chain does not stop the sweep of the next one', async () => {
    const { service, repo, store } = build({
      heads: [
        { scope: AuditScope.Guild, guildId: 'g-bad' },
        { scope: AuditScope.Guild, guildId: 'g-good' },
      ],
    });
    store.write
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce({
        storageRef: '/archives/ok',
        byteSize: 10,
        checksum: 'sum',
      });

    const result = await service.run(NOW);
    expect(result.chainsExamined).toBe(2);
    expect(result.chainsPruned).toBe(1); // only the good one
    expect(repo.pruneUpTo).toHaveBeenCalledTimes(1);
  });

  it('respects per-guild retentionDays overrides via config.forGuild', async () => {
    const { service, repo, config } = build({
      guildConfig: { retentionDays: 30 },
    });
    await service.run(NOW);
    expect(config.forGuild).toHaveBeenCalledWith('g1');
    const cutoff = repo.firstSeqAtOrAfter.mock.calls[0][2] as Date;
    expect(cutoff.toISOString()).toBe('2026-06-02T04:00:00.000Z');
  });
});
