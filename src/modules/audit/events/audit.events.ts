import type { AuditScope } from '../domain/audit-scope.enum';

/** Namespaced event names emitted by the Audit module on the core Event Bus. */
export const AuditEvents = {
  EntryRecorded: 'audit.entry.recorded',
  ChainVerified: 'audit.chain.verified',
  ChainBroken: 'audit.chain.broken', // critical — fans out to alerting
  RetentionArchived: 'audit.retention.archived',
  ExportRequested: 'audit.export.requested',
} as const;

export type AuditEventName = (typeof AuditEvents)[keyof typeof AuditEvents];

export interface AuditEntryRecordedPayload {
  readonly entryId: string;
  readonly scope: AuditScope;
  readonly guildId: string | null;
  readonly seq: string; // bigint serialised
  readonly action: string;
  readonly correlationId: string;
  readonly occurredAt: string; // ISO
}

export interface ChainVerifiedPayload {
  readonly scope: AuditScope;
  readonly guildId: string | null;
  readonly checked: number;
  readonly valid: boolean;
  readonly verifiedAt: string; // ISO
}

export interface ChainBrokenPayload {
  readonly scope: AuditScope;
  readonly guildId: string | null;
  readonly expectedHash: string;
  readonly actualHash: string;
  readonly seq: string; // bigint serialised
  readonly detectedAt: string; // ISO
}

export interface RetentionArchivedPayload {
  readonly scope: AuditScope;
  readonly guildId: string | null;
  readonly fromSeq: string;
  readonly toSeq: string;
  readonly entryCount: number;
  readonly storageRef: string;
  readonly occurredAt: string; // ISO
}

export interface ExportRequestedPayload {
  readonly scope: AuditScope;
  readonly guildId: string | null;
  readonly format: string;
  readonly actorId: string;
  readonly occurredAt: string; // ISO
}
