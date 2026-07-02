/** BullMQ queue name owned exclusively by the Audit module. */
export const AUDIT_QUEUE = 'audit.ingest';

/** BullMQ job names on {@link AUDIT_QUEUE}. */
export const AUDIT_INGEST_JOB = 'ingest';
export const AUDIT_RETENTION_JOB = 'retention';

/** handlerId used when tapping the core Event Bus. */
export const AUDIT_TAP_HANDLER_ID = 'audit:global-sink';

/** Cache key parts under CacheNamespace.Generic. */
export const AUDIT_CACHE_PREFIX = 'audit';

/** Claims defined by this module (wildcard-compatible: audit.*). */
export const AuditClaims = {
  Read: 'audit.read',
  ReadGlobal: 'audit.read.global',
  Verify: 'audit.verify',
  Export: 'audit.export',
  RetentionManage: 'audit.retention.manage',
} as const;

/**
 * Actions that must never re-enter the ledger regardless of configuration —
 * recording an entry emits `audit.entry.recorded`, which would otherwise
 * recurse forever.
 */
export const HARD_DENIED_ACTIONS: ReadonlySet<string> = new Set([
  'audit.entry.recorded',
]);
