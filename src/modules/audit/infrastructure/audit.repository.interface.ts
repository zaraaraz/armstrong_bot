import type {
  AuditEntry,
  AuditEntryDraft,
  AuditQuery,
  Page,
} from '../domain/audit-entry.model';
import type { AuditScope } from '../domain/audit-scope.enum';

/**
 * Repository contract — the ONLY surface that touches Prisma. Deliberately
 * append-only: there is no update, and pruning is an internal capability of
 * the concrete repository reserved for the retention job.
 */
export interface IAuditRepository {
  append(
    draft: AuditEntryDraft,
    seq: bigint,
    previousHash: string | null,
    hash: string,
  ): Promise<AuditEntry>;
  findLast(
    scope: AuditScope,
    guildId: string | null,
  ): Promise<AuditEntry | null>;
  find(query: AuditQuery): Promise<Page<AuditEntry>>;
  findByCorrelation(correlationId: string): Promise<readonly AuditEntry[]>;
  streamForExport(query: AuditQuery): AsyncIterable<AuditEntry>;
  iterateChain(
    scope: AuditScope,
    guildId: string | null,
  ): AsyncIterable<AuditEntry>;
  countOlderThan(cutoff: Date): Promise<number>;
}

/** Thrown when a concurrent append claimed the same (scope, guildId, seq). */
export class AuditSeqConflictError extends Error {
  constructor(scope: AuditScope, guildId: string | null, seq: bigint) {
    super(
      `audit seq conflict for scope=${scope} guild=${guildId ?? 'global'} seq=${seq}`,
    );
    this.name = 'AuditSeqConflictError';
  }
}
