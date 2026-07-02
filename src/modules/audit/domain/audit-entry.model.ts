import type {
  AuditScope,
  AuditSource,
  AuditActorType,
} from './audit-scope.enum';

/** Immutable draft handed to the ingest pipeline. No id/seq/hash yet. */
export interface AuditEntryDraft {
  readonly scope: AuditScope;
  readonly guildId: string | null; // null only when scope === Global
  readonly action: string; // e.g. "scheduler.job.completed"
  readonly source: AuditSource;
  readonly actorId: string | null; // Discord user id, or null for SYSTEM
  readonly actorType: AuditActorType;
  readonly targetType: string | null; // e.g. "job", "member", "config"
  readonly targetId: string | null;
  readonly channelId: string | null;
  readonly correlationId: string; // groups a logical operation
  readonly causationId: string | null; // the envelope that caused this one
  readonly summary: string; // short, translatable label key
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly before: Readonly<Record<string, unknown>> | null;
  readonly after: Readonly<Record<string, unknown>> | null;
  readonly occurredAt: Date;
}

/** A persisted, hash-chained, immutable audit record. */
export interface AuditEntry extends AuditEntryDraft {
  readonly id: string;
  readonly seq: bigint; // monotonic per (scope, guildId)
  readonly previousHash: string | null;
  readonly hash: string; // hex digest of canonical content + previousHash
  readonly createdAt: Date;
}

export interface Pagination {
  readonly page: number; // 1-based
  readonly pageSize: number;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export interface AuditQuery {
  readonly guildId?: string;
  readonly scope?: AuditScope;
  readonly actorId?: string;
  readonly action?: string; // exact, or prefix when it ends with '.'
  readonly targetType?: string;
  readonly targetId?: string;
  readonly correlationId?: string;
  readonly source?: AuditSource;
  readonly from?: Date;
  readonly to?: Date;
  readonly pagination: Pagination;
}

export interface ChainVerificationResult {
  readonly guildId: string | null;
  readonly scope: AuditScope;
  readonly checked: number;
  readonly valid: boolean;
  readonly firstBrokenSeq: bigint | null; // null when valid
  readonly verifiedAt: Date;
}

export type AuditExportFormat = 'json' | 'ndjson' | 'csv';
