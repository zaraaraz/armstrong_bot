import { Injectable, Logger } from '@nestjs/common';

export interface StorageAuditEntry {
  /** Actor performing the control action (user id, 'system', 'api', etc.). */
  readonly actor: string;
  readonly guildId: string | null;
  readonly action: 'storage.delete' | 'storage.sign' | 'storage.config';
  readonly key: string | null;
  readonly before?: string | null;
  readonly after?: string | null;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Audit sink for storage control actions. For now it emits structured Pino
 * logs under the `storage.audit` category; once the core Audit module
 * (roadmap item 15) lands, this delegates to it without changing callers.
 */
@Injectable()
export class StorageAuditService {
  private readonly logger = new Logger('storage.audit');

  record(entry: StorageAuditEntry): void {
    this.logger.log(
      JSON.stringify({
        category: 'storage.audit',
        actor: entry.actor,
        guildId: entry.guildId,
        action: entry.action,
        key: entry.key,
        before: entry.before ?? null,
        after: entry.after ?? null,
        ...(entry.metadata ? { metadata: entry.metadata } : {}),
      }),
    );
  }
}
