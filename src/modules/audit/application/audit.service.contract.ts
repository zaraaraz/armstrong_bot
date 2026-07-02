import type {
  AuditEntry,
  AuditEntryDraft,
  AuditExportFormat,
  AuditQuery,
  ChainVerificationResult,
  Page,
} from '../domain/audit-entry.model';
import type { AuditScope } from '../domain/audit-scope.enum';

/**
 * Public application contract of the Audit module — the only surface other
 * parts of the system may depend on. There is deliberately no update or
 * delete: the ledger is append-only by design.
 */
export abstract class AuditPublicApi {
  /** Enqueues a draft for asynchronous, chain-hashed persistence. */
  abstract record(draft: AuditEntryDraft): Promise<void>;

  abstract query(query: AuditQuery): Promise<Page<AuditEntry>>;

  abstract getByCorrelation(
    correlationId: string,
  ): Promise<readonly AuditEntry[]>;

  abstract verifyChain(
    scope: AuditScope,
    guildId: string | null,
  ): Promise<ChainVerificationResult>;

  abstract export(
    query: AuditQuery,
    format: AuditExportFormat,
  ): Promise<NodeJS.ReadableStream>;
}
