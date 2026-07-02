import { Injectable } from '@nestjs/common';
import type {
  AuditEntry,
  AuditExportFormat,
} from '../domain/audit-entry.model';

/** Wire shape of one exported entry (bigints/dates serialised, hash kept). */
export interface ExportedEntry {
  readonly id: string;
  readonly scope: string;
  readonly guildId: string | null;
  readonly seq: string;
  readonly action: string;
  readonly source: string;
  readonly actorId: string | null;
  readonly actorType: string;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly channelId: string | null;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly summary: string;
  readonly metadata: Record<string, unknown>;
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
  readonly previousHash: string | null;
  readonly hash: string;
  readonly occurredAt: string;
  readonly createdAt: string;
}

const CSV_COLUMNS: ReadonlyArray<keyof ExportedEntry> = [
  'id',
  'scope',
  'guildId',
  'seq',
  'action',
  'source',
  'actorId',
  'actorType',
  'targetType',
  'targetId',
  'channelId',
  'correlationId',
  'causationId',
  'summary',
  'metadata',
  'before',
  'after',
  'previousHash',
  'hash',
  'occurredAt',
  'createdAt',
];

/**
 * Streaming serialisers for export/archival. Each generator yields string
 * chunks so large result sets are never buffered fully in memory.
 */
@Injectable()
export class AuditExportWriter {
  serialise(
    entries: AsyncIterable<AuditEntry>,
    format: AuditExportFormat,
  ): AsyncIterable<string> {
    switch (format) {
      case 'json':
        return this.toJson(entries);
      case 'ndjson':
        return this.toNdjson(entries);
      case 'csv':
        return this.toCsv(entries);
    }
  }

  contentType(format: AuditExportFormat): string {
    switch (format) {
      case 'json':
        return 'application/json';
      case 'ndjson':
        return 'application/x-ndjson';
      case 'csv':
        return 'text/csv';
    }
  }

  toWire(entry: AuditEntry): ExportedEntry {
    return {
      id: entry.id,
      scope: entry.scope,
      guildId: entry.guildId,
      seq: entry.seq.toString(),
      action: entry.action,
      source: entry.source,
      actorId: entry.actorId,
      actorType: entry.actorType,
      targetType: entry.targetType,
      targetId: entry.targetId,
      channelId: entry.channelId,
      correlationId: entry.correlationId,
      causationId: entry.causationId,
      summary: entry.summary,
      metadata: { ...entry.metadata },
      before: entry.before ? { ...entry.before } : null,
      after: entry.after ? { ...entry.after } : null,
      previousHash: entry.previousHash,
      hash: entry.hash,
      occurredAt: entry.occurredAt.toISOString(),
      createdAt: entry.createdAt.toISOString(),
    };
  }

  private async *toJson(
    entries: AsyncIterable<AuditEntry>,
  ): AsyncIterable<string> {
    yield '[';
    let first = true;
    for await (const entry of entries) {
      yield `${first ? '' : ','}\n${JSON.stringify(this.toWire(entry))}`;
      first = false;
    }
    yield first ? ']' : '\n]';
  }

  private async *toNdjson(
    entries: AsyncIterable<AuditEntry>,
  ): AsyncIterable<string> {
    for await (const entry of entries) {
      yield `${JSON.stringify(this.toWire(entry))}\n`;
    }
  }

  private async *toCsv(
    entries: AsyncIterable<AuditEntry>,
  ): AsyncIterable<string> {
    yield `${CSV_COLUMNS.join(',')}\n`;
    for await (const entry of entries) {
      const wire = this.toWire(entry);
      const cells = CSV_COLUMNS.map((col) => this.csvCell(wire[col]));
      yield `${cells.join(',')}\n`;
    }
  }

  private csvCell(value: unknown): string {
    if (value === null || value === undefined) return '';
    const raw =
      typeof value === 'string'
        ? value
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : JSON.stringify(value);
    if (/[",\n\r]/.test(raw)) {
      return `"${raw.replace(/"/g, '""')}"`;
    }
    return raw;
  }
}
