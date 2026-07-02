import { describe, expect, it } from 'vitest';
import { AuditExportWriter } from './audit-export.writer';
import type { AuditEntry } from '../domain/audit-entry.model';
import { AuditScope } from '../domain/audit-scope.enum';

const writer = new AuditExportWriter();

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
    summary: 'audit:actions.tickets.ticket.closed',
    metadata: { note: 'plain' },
    before: null,
    after: null,
    previousHash: null,
    hash: `hash-${seq}`,
    occurredAt: new Date('2026-06-01T00:00:00Z'),
    createdAt: new Date('2026-06-01T00:00:01Z'),
    ...overrides,
  } as AuditEntry;
}

async function* iterate(entries: AuditEntry[]): AsyncIterable<AuditEntry> {
  await Promise.resolve(); // exercise the async-iteration path
  for (const e of entries) yield e;
}

async function collect(chunks: AsyncIterable<string>): Promise<string> {
  let out = '';
  for await (const c of chunks) out += c;
  return out;
}

describe('AuditExportWriter', () => {
  it('serialises json as a valid array with bigints/dates as strings', async () => {
    const body = await collect(
      writer.serialise(iterate([makeEntry(1n), makeEntry(2n)]), 'json'),
    );
    const parsed = JSON.parse(body) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      seq: '1',
      hash: 'hash-1',
      occurredAt: '2026-06-01T00:00:00.000Z',
    });
  });

  it('serialises the empty set as a valid empty json array', async () => {
    const body = await collect(writer.serialise(iterate([]), 'json'));
    expect(JSON.parse(body)).toEqual([]);
  });

  it('serialises ndjson one entry per line', async () => {
    const body = await collect(
      writer.serialise(iterate([makeEntry(1n), makeEntry(2n)]), 'ndjson'),
    );
    const lines = body.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1])).toMatchObject({ seq: '2' });
  });

  it('serialises csv with a header row and JSON-encoded object cells', async () => {
    const body = await collect(
      writer.serialise(iterate([makeEntry(1n)]), 'csv'),
    );
    const [header, row] = body.trim().split('\n');
    expect(header.startsWith('id,scope,guildId,seq,action')).toBe(true);
    expect(row).toContain('e-1');
    expect(row).toContain('"{""note"":""plain""}"');
  });

  it('escapes csv cells containing quotes, commas and newlines', async () => {
    const entry = makeEntry(1n, {
      summary: 'he said "hi", twice\nliterally',
      metadata: {},
    });
    const body = await collect(writer.serialise(iterate([entry]), 'csv'));
    expect(body).toContain('"he said ""hi"", twice\nliterally"');
  });

  it('maps formats to content types', () => {
    expect(writer.contentType('json')).toBe('application/json');
    expect(writer.contentType('ndjson')).toBe('application/x-ndjson');
    expect(writer.contentType('csv')).toBe('text/csv');
  });
});
