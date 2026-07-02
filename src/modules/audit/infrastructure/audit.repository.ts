import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import type {
  AuditEntry,
  AuditEntryDraft,
  AuditQuery,
  Page,
} from '../domain/audit-entry.model';
import type {
  AuditScope,
  AuditSource,
  AuditActorType,
} from '../domain/audit-scope.enum';
import {
  AuditSeqConflictError,
  type IAuditRepository,
} from './audit.repository.interface';
import type { ChainAnchor } from '../domain/audit-chain.service';

interface AuditEntryRow {
  readonly id: string;
  readonly scope: string;
  readonly guildId: string | null;
  readonly seq: bigint;
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
  readonly metadata: unknown;
  readonly before: unknown;
  readonly after: unknown;
  readonly previousHash: string | null;
  readonly hash: string;
  readonly occurredAt: Date;
  readonly createdAt: Date;
}

export interface CreateArchiveInput {
  readonly scope: AuditScope;
  readonly guildId: string | null;
  readonly format: string;
  readonly fromSeq: bigint;
  readonly toSeq: bigint;
  readonly entryCount: number;
  readonly byteSize: number;
  readonly storageRef: string;
  readonly rootHash: string;
}

export interface ChainHead {
  readonly scope: AuditScope;
  readonly guildId: string | null;
}

const EXPORT_BATCH = 500;

@Injectable()
export class AuditRepository implements IAuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get entries() {
    return this.prisma['auditEntry'];
  }

  private get archives() {
    return this.prisma['auditArchive'];
  }

  async append(
    draft: AuditEntryDraft,
    seq: bigint,
    previousHash: string | null,
    hash: string,
  ): Promise<AuditEntry> {
    try {
      const row = (await this.entries.create({
        data: {
          scope: draft.scope,
          guildId: draft.guildId,
          seq,
          action: draft.action,
          source: draft.source,
          actorId: draft.actorId,
          actorType: draft.actorType,
          targetType: draft.targetType,
          targetId: draft.targetId,
          channelId: draft.channelId,
          correlationId: draft.correlationId,
          causationId: draft.causationId,
          summary: draft.summary,
          metadata: draft.metadata as Prisma.InputJsonValue,
          before:
            draft.before === null
              ? Prisma.DbNull
              : (draft.before as Prisma.InputJsonValue),
          after:
            draft.after === null
              ? Prisma.DbNull
              : (draft.after as Prisma.InputJsonValue),
          previousHash,
          hash,
          occurredAt: draft.occurredAt,
        },
      })) as AuditEntryRow;
      return this.toEntry(row);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new AuditSeqConflictError(draft.scope, draft.guildId, seq);
      }
      throw err;
    }
  }

  async findLast(
    scope: AuditScope,
    guildId: string | null,
  ): Promise<AuditEntry | null> {
    const row = (await this.entries.findFirst({
      where: { scope, guildId },
      orderBy: { seq: 'desc' },
    })) as AuditEntryRow | null;
    return row ? this.toEntry(row) : null;
  }

  async find(query: AuditQuery): Promise<Page<AuditEntry>> {
    const where = this.toWhere(query);
    const { page, pageSize } = query.pagination;
    const [rows, total] = await Promise.all([
      this.entries.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }) as Promise<AuditEntryRow[]>,
      this.entries.count({ where }),
    ]);
    return {
      items: rows.map((r) => this.toEntry(r)),
      page,
      pageSize,
      total,
    };
  }

  async findByCorrelation(
    correlationId: string,
  ): Promise<readonly AuditEntry[]> {
    const rows = (await this.entries.findMany({
      where: { correlationId },
      orderBy: [{ occurredAt: 'asc' }, { seq: 'asc' }],
    })) as AuditEntryRow[];
    return rows.map((r) => this.toEntry(r));
  }

  async *streamForExport(query: AuditQuery): AsyncIterable<AuditEntry> {
    const where = this.toWhere(query);
    let cursor: { occurredAt: Date; id: string } | null = null;
    for (;;) {
      const rows = (await this.entries.findMany({
        where: cursor
          ? {
              AND: [
                where,
                {
                  OR: [
                    { occurredAt: { gt: cursor.occurredAt } },
                    {
                      occurredAt: cursor.occurredAt,
                      id: { gt: cursor.id },
                    },
                  ],
                },
              ],
            }
          : where,
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        take: EXPORT_BATCH,
      })) as AuditEntryRow[];
      if (rows.length === 0) return;
      for (const row of rows) yield this.toEntry(row);
      const last = rows[rows.length - 1];
      cursor = { occurredAt: last.occurredAt, id: last.id };
    }
  }

  async *iterateChain(
    scope: AuditScope,
    guildId: string | null,
  ): AsyncIterable<AuditEntry> {
    yield* this.iterateChainRange(scope, guildId, 0n, null);
  }

  /** Chain segment iterator: seq in (afterSeq, upToSeq] ordered ascending. */
  async *iterateChainRange(
    scope: AuditScope,
    guildId: string | null,
    afterSeq: bigint,
    upToSeq: bigint | null,
  ): AsyncIterable<AuditEntry> {
    let cursor = afterSeq;
    for (;;) {
      const rows = (await this.entries.findMany({
        where: {
          scope,
          guildId,
          seq: upToSeq === null ? { gt: cursor } : { gt: cursor, lte: upToSeq },
        },
        orderBy: { seq: 'asc' },
        take: EXPORT_BATCH,
      })) as AuditEntryRow[];
      if (rows.length === 0) return;
      for (const row of rows) yield this.toEntry(row);
      cursor = rows[rows.length - 1].seq;
    }
  }

  async countOlderThan(cutoff: Date): Promise<number> {
    return this.entries.count({ where: { occurredAt: { lt: cutoff } } });
  }

  // ── Internal surface for the retention job (not on IAuditRepository) ──────

  /** Distinct (scope, guildId) chains present in the ledger. */
  async chainHeads(): Promise<readonly ChainHead[]> {
    const groups = (await this.entries.findMany({
      distinct: ['scope', 'guildId'],
      select: { scope: true, guildId: true },
    })) as ReadonlyArray<{ scope: string; guildId: string | null }>;
    return groups.map((g) => ({
      scope: g.scope as AuditScope,
      guildId: g.guildId,
    }));
  }

  /** First seq of the chain still present (post-pruning start point). */
  async firstSeq(
    scope: AuditScope,
    guildId: string | null,
  ): Promise<bigint | null> {
    const row = await this.entries.findFirst({
      where: { scope, guildId },
      orderBy: { seq: 'asc' },
      select: { seq: true },
    });
    return row?.seq ?? null;
  }

  async findBySeq(
    scope: AuditScope,
    guildId: string | null,
    seq: bigint,
  ): Promise<AuditEntry | null> {
    const row = (await this.entries.findFirst({
      where: { scope, guildId, seq },
    })) as AuditEntryRow | null;
    return row ? this.toEntry(row) : null;
  }

  /**
   * Smallest seq whose entry occurred at/after the cutoff. Everything below
   * it is a contiguous prunable prefix even when events arrived out of
   * occurredAt order.
   */
  async firstSeqAtOrAfter(
    scope: AuditScope,
    guildId: string | null,
    cutoff: Date,
  ): Promise<bigint | null> {
    const row = await this.entries.findFirst({
      where: { scope, guildId, occurredAt: { gte: cutoff } },
      orderBy: { seq: 'asc' },
      select: { seq: true },
    });
    return row?.seq ?? null;
  }

  /** Anchor for verification across a pruned boundary: archive ending at `toSeq`. */
  async findAnchor(
    scope: AuditScope,
    guildId: string | null,
    toSeq: bigint,
  ): Promise<ChainAnchor | null> {
    const row = await this.archives.findFirst({
      where: { scope, guildId, toSeq },
      orderBy: { createdAt: 'desc' },
      select: { toSeq: true, rootHash: true },
    });
    return row ? { toSeq: row.toSeq, rootHash: row.rootHash } : null;
  }

  async createArchive(input: CreateArchiveInput): Promise<void> {
    await this.archives.create({
      data: {
        scope: input.scope,
        guildId: input.guildId,
        format: input.format,
        fromSeq: input.fromSeq,
        toSeq: input.toSeq,
        entryCount: input.entryCount,
        byteSize: input.byteSize,
        storageRef: input.storageRef,
        rootHash: input.rootHash,
      },
    });
  }

  /** Retention-job-only hard delete of an archived chain prefix. */
  async pruneUpTo(
    scope: AuditScope,
    guildId: string | null,
    toSeq: bigint,
  ): Promise<number> {
    const result = await this.entries.deleteMany({
      where: { scope, guildId, seq: { lte: toSeq } },
    });
    return result.count;
  }

  private toWhere(query: AuditQuery): Prisma.AuditEntryWhereInput {
    const where: Prisma.AuditEntryWhereInput = {};
    if (query.scope) where.scope = query.scope;
    if (query.guildId !== undefined) where.guildId = query.guildId;
    if (query.actorId) where.actorId = query.actorId;
    if (query.targetType) where.targetType = query.targetType;
    if (query.targetId) where.targetId = query.targetId;
    if (query.correlationId) where.correlationId = query.correlationId;
    if (query.source) where.source = query.source;
    if (query.action) {
      where.action = query.action.endsWith('.')
        ? { startsWith: query.action }
        : query.action;
    }
    if (query.from || query.to) {
      where.occurredAt = {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      };
    }
    return where;
  }

  private toEntry(row: AuditEntryRow): AuditEntry {
    return {
      id: row.id,
      scope: row.scope as AuditScope,
      guildId: row.guildId,
      seq: row.seq,
      action: row.action,
      source: row.source as AuditSource,
      actorId: row.actorId,
      actorType: row.actorType as AuditActorType,
      targetType: row.targetType,
      targetId: row.targetId,
      channelId: row.channelId,
      correlationId: row.correlationId,
      causationId: row.causationId,
      summary: row.summary,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      before: (row.before ?? null) as Record<string, unknown> | null,
      after: (row.after ?? null) as Record<string, unknown> | null,
      previousHash: row.previousHash,
      hash: row.hash,
      occurredAt: row.occurredAt,
      createdAt: row.createdAt,
    };
  }
}
