import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  AUDIT_INGEST_JOB,
  AUDIT_QUEUE,
  AUDIT_RETENTION_JOB,
} from '../audit.constants';
import type { AuditEntryDraft } from '../domain/audit-entry.model';

/** Draft as it travels through Redis (Dates/bigints serialised). */
export interface AuditIngestJobData {
  readonly draft: Omit<AuditEntryDraft, 'occurredAt'> & {
    readonly occurredAt: string;
  };
}

/**
 * Module-private wrapper over the BullMQ producer for `audit.ingest`.
 * Mirrors the scheduler's queue pattern — no shared core Queue layer exists.
 */
@Injectable()
export class AuditQueue implements OnModuleDestroy {
  private readonly logger = new Logger(AuditQueue.name);
  readonly connection: { host: string; port: number };
  readonly queue: Queue<AuditIngestJobData | Record<string, never>>;

  constructor(config: ConfigService) {
    this.connection = {
      host: config.get<string>('REDIS_HOST', 'localhost'),
      port: config.get<number>('REDIS_PORT', 6379),
    };
    this.queue = new Queue(AUDIT_QUEUE, { connection: this.connection });
  }

  /**
   * Enqueues one draft for persistence. `dedupeKey` (the envelope id) makes
   * the enqueue idempotent so an event replayed on the bus cannot produce a
   * duplicate ledger entry.
   */
  async enqueueDraft(draft: AuditEntryDraft, dedupeKey: string): Promise<void> {
    const data: AuditIngestJobData = {
      draft: { ...draft, occurredAt: draft.occurredAt.toISOString() },
    };
    await this.queue.add(AUDIT_INGEST_JOB, data, {
      jobId: `ingest:${dedupeKey}`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: false,
    });
  }

  /** Registers (idempotently) the recurring retention sweep. */
  async ensureRetentionJob(cron: string): Promise<void> {
    await this.queue.add(
      AUDIT_RETENTION_JOB,
      {},
      {
        jobId: AUDIT_RETENTION_JOB,
        repeat: { pattern: cron },
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 10 },
      },
    );
  }

  async depth(): Promise<number> {
    const counts = await this.queue.getJobCounts('waiting', 'delayed');
    return (counts['waiting'] ?? 0) + (counts['delayed'] ?? 0);
  }

  async failedCount(): Promise<number> {
    const counts = await this.queue.getJobCounts('failed');
    return counts['failed'] ?? 0;
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close().catch(() => undefined);
    this.logger.debug('audit queue closed');
  }
}
