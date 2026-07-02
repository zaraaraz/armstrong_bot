// Module class
export { AuditModule } from './audit.module';

// Public application contract (abstract token bound to impl in module.ts)
export { AuditPublicApi } from './application/audit.service.contract';

// Public domain types
export {
  AuditScope,
  AuditSource,
  AuditActorType,
} from './domain/audit-scope.enum';
export type {
  AuditEntry,
  AuditEntryDraft,
  AuditQuery,
  AuditExportFormat,
  ChainVerificationResult,
  Page,
  Pagination,
} from './domain/audit-entry.model';

// Event names & payload types
export {
  AuditEvents,
  type AuditEventName,
  type AuditEntryRecordedPayload,
  type ChainVerifiedPayload,
  type ChainBrokenPayload,
  type RetentionArchivedPayload,
  type ExportRequestedPayload,
} from './events/audit.events';

// Claims (for guards in other surfaces, e.g. the dashboard BFF)
export { AuditClaims } from './audit.constants';
