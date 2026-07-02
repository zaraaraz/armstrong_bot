import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import {
  AUDIT_INGEST_JOB,
  AUDIT_QUEUE,
  AUDIT_RETENTION_JOB,
} from '../audit.constants';
import type { AuditEntry, AuditEntryDraft } from '../domain/audit-entry.model';
import { AuditChainService } from '../domain/audit-chain.service';
import { RetentionService } from '../domain/retention.service';
import { AuditConfigService } from '../config/audit-config.service';
import {
  AuditQueue,
  type AuditIngestJobData,
} from '../infrastructure/audit.queue';
import { AuditRepository } from '../infrastructure/audit.repository';
import { AuditSeqConflictError } from '../infrastructure/audit.repository.interface';
import { AuditEventEmitter } from '../events/audit-event.emitter';
import { AuditEvents } from '../events/audit.events';
import { AuditMetrics } from '../observability/audit.metrics';
import { AuditTracing } from '../observability/audit.tracing';

const MAX_APPEND_ATTEMPTS = 5;

/**
 * BullMQ worker draining `audit.ingest`. Appends are serialised per chain by
 * an in-process mutex; the DB unique (scope, guildId, seq) plus a bounded
 * optimistic retry keep seq strictly monotonic even if a second bot instance
 * ever appends concurrently. The same worker executes the recurring
 * retention sweep.
 */
@Injectable()
export class AuditIngestProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('audit.ingest.worker');
  private readonly chainLocks = new Map<string, Promise<void>>();
  private worker: Worker<AuditIngestJobData | Record<string, never>> | null =
    null;

  constructor(
    private readonly queue: AuditQueue,
    private readonly repo: AuditRepository,
    private readonly chain: AuditChainService,
    private readonly retention: RetentionService,
    private readonly config: AuditConfigService,
    private readonly emitter: AuditEventEmitter,
    private readonly metrics: AuditMetrics,
    private readonly tracing: AuditTracing,
  ) {}

  onModuleInit(): void {
    const global = this.config.global();
    this.worker = new Worker(AUDIT_QUEUE, (job) => this.process(job), {
      connection: this.queue.connection,
      concurrency: global.ingestConcurrency,
    });
    this.worker.on('error', (err) => {
      this.logger.warn(`worker error: ${err.message}`);
    });
    this.worker.on('failed', (job, err) => {
      const attempts = job?.opts?.attempts ?? 1;
      if ((job?.attemptsMade ?? 0) >= attempts) {
        this.metrics.recordIngest('failed');
        this.logger.error(
          `job ${job?.id} dead-lettered after ${attempts} attempts: ${err.message}`,
        );
      }
    });

    void this.queue
      .ensureRetentionJob(global.retentionCron)
      .catch((err: Error) => {
        this.logger.warn(`could not register retention job: ${err.message}`);
      });
  }

  private async process(
    job: Job<AuditIngestJobData | Record<string, never>>,
  ): Promise<void> {
    if (job.name === AUDIT_RETENTION_JOB) {
      await this.retention.run();
      return;
    }
    if (job.name === AUDIT_INGEST_JOB) {
      const data = job.data as AuditIngestJobData;
      const draft: AuditEntryDraft = {
        ...data.draft,
        occurredAt: new Date(data.draft.occurredAt),
      };
      await this.persist(draft);
    }
  }

  /** Chain-hash and insert one draft; emits `audit.entry.recorded`. */
  private async persist(draft: AuditEntryDraft): Promise<void> {
    const started = Date.now();
    const entry = await this.tracing.withSpan(
      'audit.persist',
      {
        action: draft.action,
        scope: draft.scope,
        correlationId: draft.correlationId,
      },
      () => this.appendSerialised(draft),
    );
    this.metrics.recordIngest('persisted');
    this.metrics.observePersist(Date.now() - started);

    // Post-persist notification failures must not re-run the append: the
    // entry is already in the ledger and a retry would duplicate it.
    try {
      await this.emitter.emit(
        AuditEvents.EntryRecorded,
        {
          entryId: entry.id,
          scope: entry.scope,
          guildId: entry.guildId,
          seq: entry.seq.toString(),
          action: entry.action,
          correlationId: entry.correlationId,
          occurredAt: entry.occurredAt.toISOString(),
        },
        entry.guildId,
      );
    } catch (err) {
      this.logger.warn(
        `entry ${entry.id} persisted but recorded-event emit failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async appendSerialised(draft: AuditEntryDraft): Promise<AuditEntry> {
    const key = `${draft.scope}:${draft.guildId ?? 'global'}`;
    return this.withChainLock(key, () => this.appendWithRetry(draft));
  }

  private async appendWithRetry(draft: AuditEntryDraft): Promise<AuditEntry> {
    const algorithm = this.config.global().hashAlgorithm;
    let lastError: Error = new Error('unreachable');
    for (let attempt = 1; attempt <= MAX_APPEND_ATTEMPTS; attempt += 1) {
      const last = await this.repo.findLast(draft.scope, draft.guildId);
      const seq = (last?.seq ?? 0n) + 1n;
      const previousHash = last?.hash ?? null;
      const hash = this.chain.computeHash(draft, seq, previousHash, algorithm);
      try {
        return await this.repo.append(draft, seq, previousHash, hash);
      } catch (err) {
        if (err instanceof AuditSeqConflictError) {
          lastError = err;
          continue; // another writer claimed this seq — re-read the tail
        }
        throw err;
      }
    }
    throw lastError;
  }

  /** Serialises appends per (scope, guildId) within this process. */
  private withChainLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.chainLocks.get(key) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    this.chainLocks.set(
      key,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
  }
}
