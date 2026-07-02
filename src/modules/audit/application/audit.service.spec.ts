import { describe, expect, it, vi } from 'vitest';
import { AuditServiceImpl } from './audit.service';
import { AuditChainService } from '../domain/audit-chain.service';
import { AuditExportWriter } from '../infrastructure/audit-export.writer';
import type { AuditEntry, AuditQuery } from '../domain/audit-entry.model';
import { AuditScope, AuditSource } from '../domain/audit-scope.enum';

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
    occurredAt: new Date('2026-06-01T00:00:00Z'),
    createdAt: new Date('2026-06-01T00:00:00Z'),
    ...overrides,
  } as AuditEntry;
}

function makeQuery(overrides: Partial<AuditQuery> = {}): AuditQuery {
  return { guildId: 'g1', pagination: { page: 1, pageSize: 25 }, ...overrides };
}

interface BuildOptions {
  queryCacheTtlSeconds?: number;
  maxPageSize?: number;
  firstSeq?: bigint | null;
  anchor?: { toSeq: bigint; rootHash: string } | null;
  chainEntries?: AuditEntry[];
}

function build(options: BuildOptions = {}) {
  const chain = new AuditChainService();
  const writer = new AuditExportWriter();
  const entries = options.chainEntries ?? [];

  const repo = {
    find: vi.fn().mockResolvedValue({
      items: [makeEntry(1n)],
      page: 1,
      pageSize: 25,
      total: 1,
    }),
    findByCorrelation: vi.fn().mockResolvedValue([makeEntry(1n)]),
    firstSeq: vi.fn().mockResolvedValue(options.firstSeq ?? 1n),
    findAnchor: vi.fn().mockResolvedValue(options.anchor ?? null),
    findBySeq: vi.fn().mockResolvedValue(entries[0] ?? null),
    iterateChain: vi.fn().mockReturnValue(
      (async function* () {
        await Promise.resolve();
        for (const e of entries) yield e;
      })(),
    ),
    streamForExport: vi.fn().mockReturnValue(
      (async function* () {
        await Promise.resolve();
        yield makeEntry(1n);
        yield makeEntry(2n);
      })(),
    ),
  };
  const cacheStore = new Map<string, unknown>();
  const cache = {
    keys: {
      forGuild: (g: string, ns: string, ...parts: string[]) =>
        `guild:${g}:${ns}:${parts.join(':')}`,
      forGlobal: (ns: string, ...parts: string[]) =>
        `global:${ns}:${parts.join(':')}`,
    },
    getOrSet: vi.fn(
      async (key: string, loader: () => Promise<unknown>): Promise<unknown> => {
        if (!cacheStore.has(key)) {
          // simulate the Redis round-trip: values survive JSON only
          cacheStore.set(
            key,
            JSON.parse(JSON.stringify(await loader())) as unknown,
          );
        }
        return cacheStore.get(key);
      },
    ),
  };
  const config = {
    global: () => ({
      hashAlgorithm: 'sha256',
      maxPageSize: options.maxPageSize ?? 100,
      queryCacheTtlSeconds: options.queryCacheTtlSeconds ?? 15,
    }),
  };
  const emit = vi.fn().mockResolvedValue(undefined);
  const record = vi.fn().mockResolvedValue(undefined);
  const metrics = {
    recordVerification: vi.fn(),
    recordExport: vi.fn(),
  };
  const tracing = {
    withSpan: vi.fn(
      (_n: string, _a: unknown, fn: () => Promise<unknown>): Promise<unknown> =>
        fn(),
    ),
  };

  const service = new AuditServiceImpl(
    repo as never,
    chain,
    config as never,
    cache as never,
    writer,
    { emit } as never,
    { record } as never,
    metrics as never,
    tracing as never,
  );
  return { service, repo, cache, emit, record, metrics, chain, cacheStore };
}

describe('AuditServiceImpl.query', () => {
  it('returns domain entries rehydrated from the JSON cache (bigint seq, Date fields)', async () => {
    const { service, repo } = build();
    const page = await service.query(makeQuery());
    expect(page.total).toBe(1);
    expect(page.items[0].seq).toBe(1n);
    expect(page.items[0].occurredAt).toBeInstanceOf(Date);
    expect(repo.find).toHaveBeenCalledOnce();
  });

  it('serves repeated queries from cache without touching the repository again', async () => {
    const { service, repo } = build();
    await service.query(makeQuery());
    await service.query(makeQuery());
    expect(repo.find).toHaveBeenCalledTimes(1);
  });

  it('uses distinct cache keys for distinct queries', async () => {
    const { service, repo } = build();
    await service.query(makeQuery());
    await service.query(makeQuery({ actorId: 'someone-else' }));
    expect(repo.find).toHaveBeenCalledTimes(2);
  });

  it('bypasses the cache entirely when TTL is 0', async () => {
    const { service, repo, cache } = build({ queryCacheTtlSeconds: 0 });
    await service.query(makeQuery());
    expect(cache.getOrSet).not.toHaveBeenCalled();
    expect(repo.find).toHaveBeenCalledOnce();
  });

  it('clamps pageSize to the configured maximum', async () => {
    const { service, repo } = build({ maxPageSize: 50 });
    await service.query(makeQuery({ pagination: { page: 1, pageSize: 500 } }));
    const q = repo.find.mock.calls[0][0] as AuditQuery;
    expect(q.pagination.pageSize).toBe(50);
  });
});

describe('AuditServiceImpl.verifyChain', () => {
  it('verifies a valid chain, emits chain.verified and records a meta-audit entry', async () => {
    const chain = new AuditChainService();
    const draft = makeEntry(1n);
    const hash = chain.computeHash(draft, 1n, null, 'sha256');
    const entry = { ...draft, hash };

    const { service, emit, record, metrics } = build({
      chainEntries: [entry],
    });
    const result = await service.verifyChain(AuditScope.Guild, 'g1', {
      actorId: 'admin-1',
      source: AuditSource.Api,
    });

    expect(result.valid).toBe(true);
    expect(result.checked).toBe(1);
    expect(metrics.recordVerification).toHaveBeenCalledWith(true);
    expect(emit).toHaveBeenCalledWith(
      'audit.chain.verified',
      expect.objectContaining({ valid: true, checked: 1 }),
      'g1',
    );
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'audit.verify.performed',
        actorId: 'admin-1',
      }),
    );
  });

  it('emits chain.broken with the offending seq when verification fails', async () => {
    const tampered = makeEntry(1n, { hash: 'not-the-real-hash' });
    const { service, emit, metrics } = build({ chainEntries: [tampered] });

    const result = await service.verifyChain(AuditScope.Guild, 'g1');
    expect(result.valid).toBe(false);
    expect(result.firstBrokenSeq).toBe(1n);
    expect(metrics.recordVerification).toHaveBeenCalledWith(false);
    expect(emit).toHaveBeenCalledWith(
      'audit.chain.broken',
      expect.objectContaining({ seq: '1', actualHash: 'not-the-real-hash' }),
      'g1',
    );
  });

  it('resolves the archive anchor when the chain no longer starts at seq 1', async () => {
    const { service, repo } = build({
      firstSeq: 6n,
      anchor: { toSeq: 5n, rootHash: 'root' },
      chainEntries: [],
    });
    await service.verifyChain(AuditScope.Guild, 'g1');
    expect(repo.findAnchor).toHaveBeenCalledWith(AuditScope.Guild, 'g1', 5n);
  });
});

describe('AuditServiceImpl.export', () => {
  async function drain(stream: NodeJS.ReadableStream): Promise<string> {
    let out = '';
    for await (const chunk of stream as AsyncIterable<Buffer | string>) {
      out += chunk.toString();
    }
    return out;
  }

  it('streams ndjson whose lines carry the original hashes', async () => {
    const { service } = build();
    const stream = await service.export(makeQuery(), 'ndjson', {
      actorId: 'admin-1',
      source: AuditSource.Api,
    });
    const body = await drain(stream);
    const lines = body.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({ seq: '1', hash: 'hash-1' });
  });

  it('emits export.requested, counts the export, and records a meta-audit entry', async () => {
    const { service, emit, record, metrics } = build();
    await service.export(makeQuery(), 'csv', {
      actorId: 'admin-1',
      source: AuditSource.Api,
    });
    expect(metrics.recordExport).toHaveBeenCalledWith('csv');
    expect(emit).toHaveBeenCalledWith(
      'audit.export.requested',
      expect.objectContaining({ format: 'csv', actorId: 'admin-1' }),
      'g1',
    );
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'audit.export.performed' }),
    );
  });
});

describe('AuditServiceImpl.getByCorrelation', () => {
  it('delegates to the repository', async () => {
    const { service, repo } = build();
    const entries = await service.getByCorrelation('c-1');
    expect(entries).toHaveLength(1);
    expect(repo.findByCorrelation).toHaveBeenCalledWith('c-1');
  });
});
