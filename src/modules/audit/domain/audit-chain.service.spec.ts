import { describe, expect, it } from 'vitest';
import { AuditChainService, type ChainAnchor } from './audit-chain.service';
import type { AuditEntry, AuditEntryDraft } from './audit-entry.model';
import { AuditActorType, AuditScope, AuditSource } from './audit-scope.enum';

const chain = new AuditChainService();

function makeDraft(overrides: Partial<AuditEntryDraft> = {}): AuditEntryDraft {
  return {
    scope: AuditScope.Guild,
    guildId: 'g1',
    action: 'tickets.ticket.closed',
    source: AuditSource.Command,
    actorId: 'user-1',
    actorType: AuditActorType.User,
    targetType: 'ticket',
    targetId: 't-1',
    channelId: null,
    correlationId: 'corr-1',
    causationId: null,
    summary: 'audit:actions.tickets.ticket.closed',
    metadata: { reason: 'resolved' },
    before: null,
    after: null,
    occurredAt: new Date('2026-07-01T10:00:00Z'),
    ...overrides,
  };
}

/** Builds a well-linked chain of n entries using the real hash function. */
function buildChain(
  n: number,
  startSeq = 1n,
  previousHash: string | null = null,
): AuditEntry[] {
  const entries: AuditEntry[] = [];
  let prev = previousHash;
  for (let i = 0; i < n; i += 1) {
    const seq = startSeq + BigInt(i);
    const draft = makeDraft({
      correlationId: `corr-${seq}`,
      metadata: { index: i, noise: `payload-${(i * 7919) % 13}` },
      occurredAt: new Date(Date.UTC(2026, 0, 1 + i)),
    });
    const hash = chain.computeHash(draft, seq, prev, 'sha256');
    entries.push({
      ...draft,
      id: `e-${seq}`,
      seq,
      previousHash: prev,
      hash,
      createdAt: draft.occurredAt,
    });
    prev = hash;
  }
  return entries;
}

async function* iterate(
  entries: readonly AuditEntry[],
): AsyncIterable<AuditEntry> {
  await Promise.resolve(); // exercise the async-iteration path
  for (const e of entries) yield e;
}

async function verify(
  entries: readonly AuditEntry[],
  anchor: ChainAnchor | null = null,
) {
  return chain.verify(
    AuditScope.Guild,
    'g1',
    iterate(entries),
    'sha256',
    anchor,
  );
}

describe('AuditChainService', () => {
  it('computes deterministic hashes: same draft + seq + previous => same hash', () => {
    const draft = makeDraft();
    const a = chain.computeHash(draft, 1n, null, 'sha256');
    const b = chain.computeHash({ ...draft }, 1n, null, 'sha256');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes the hash when any content field or the previousHash changes', () => {
    const draft = makeDraft();
    const base = chain.computeHash(draft, 1n, null, 'sha256');
    expect(
      chain.computeHash(makeDraft({ actorId: 'user-2' }), 1n, null, 'sha256'),
    ).not.toBe(base);
    expect(chain.computeHash(draft, 2n, null, 'sha256')).not.toBe(base);
    expect(chain.computeHash(draft, 1n, 'ff'.repeat(32), 'sha256')).not.toBe(
      base,
    );
  });

  it('supports sha512 with 128-hex digests', () => {
    expect(chain.computeHash(makeDraft(), 1n, null, 'sha512')).toMatch(
      /^[0-9a-f]{128}$/,
    );
  });

  it('verifies an untampered chain end to end', async () => {
    const result = await verify(buildChain(25));
    expect(result.valid).toBe(true);
    expect(result.checked).toBe(25);
    expect(result.firstBrokenSeq).toBeNull();
  });

  it('verifies the empty chain as valid', async () => {
    const result = await verify([]);
    expect(result.valid).toBe(true);
    expect(result.checked).toBe(0);
  });

  it('pinpoints the first broken seq when content is mutated in place', async () => {
    const entries = buildChain(10);
    const tampered = entries.map((e) =>
      e.seq === 6n ? { ...e, metadata: { index: 999 } } : e,
    );
    const result = await verify(tampered);
    expect(result.valid).toBe(false);
    expect(result.firstBrokenSeq).toBe(6n);
  });

  it('detects a broken link when a middle entry is deleted', async () => {
    const entries = buildChain(10).filter((e) => e.seq !== 4n);
    const result = await verify(entries);
    expect(result.valid).toBe(false);
    expect(result.firstBrokenSeq).toBe(5n);
  });

  it('property: flipping any single hash byte breaks verification at that seq', async () => {
    const entries = buildChain(15);
    for (const target of [1n, 7n, 15n]) {
      const tampered = entries.map((e) => {
        if (e.seq !== target) return e;
        const flipped = (e.hash[0] === 'a' ? 'b' : 'a') + e.hash.slice(1);
        return { ...e, hash: flipped };
      });
      const result = await verify(tampered);
      expect(result.valid).toBe(false);
      expect(result.firstBrokenSeq).toBe(target);
    }
  });

  it('accepts a pruned chain when it links to the archive anchor', async () => {
    const full = buildChain(10);
    const remaining = full.slice(5); // seqs 6..10 survive retention
    const anchor: ChainAnchor = { toSeq: 5n, rootHash: full[4].hash };
    const result = await verify(remaining, anchor);
    expect(result.valid).toBe(true);
    expect(result.checked).toBe(5);
  });

  it('rejects a pruned chain whose first entry does not match the anchor', async () => {
    const full = buildChain(10);
    const remaining = full.slice(5);
    const badAnchor: ChainAnchor = { toSeq: 5n, rootHash: '0'.repeat(64) };
    const result = await verify(remaining, badAnchor);
    expect(result.valid).toBe(false);
    expect(result.firstBrokenSeq).toBe(6n);
  });

  it('rejects a chain that starts past seq 1 with no anchor at all', async () => {
    const remaining = buildChain(10).slice(5);
    const result = await verify(remaining, null);
    expect(result.valid).toBe(false);
    expect(result.firstBrokenSeq).toBe(6n);
  });
});
