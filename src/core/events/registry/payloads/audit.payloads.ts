import type {
  AuditEntryRecordedPayload,
  ChainVerifiedPayload,
  ChainBrokenPayload,
  RetentionArchivedPayload,
  ExportRequestedPayload,
} from '../../../../modules/audit/events/audit.events';

/**
 * Events emitted by the Audit module (the ledger's own lifecycle).
 * `audit.entry.recorded` is hard deny-listed by the module's ingest pipeline
 * so recording an entry never produces a recursive entry.
 */
export interface AuditEventPayloads {
  'audit.entry.recorded': AuditEntryRecordedPayload;
  'audit.chain.verified': ChainVerifiedPayload;
  'audit.chain.broken': ChainBrokenPayload;
  'audit.retention.archived': RetentionArchivedPayload;
  'audit.export.requested': ExportRequestedPayload;
}
