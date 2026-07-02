import { Injectable, Logger } from '@nestjs/common';
import type { AuditScope } from './audit-scope.enum';
import { AuditConfigService } from '../config/audit-config.service';
import { AuditRepository } from '../infrastructure/audit.repository';
import { AuditArchiveStore } from '../infrastructure/audit-archive.store';
import { AuditExportWriter } from '../infrastructure/audit-export.writer';
import { AuditEventEmitter } from '../events/audit-event.emitter';
import { AuditEvents } from '../events/audit.events';
import { AuditMetrics } from '../observability/audit.metrics';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionSweepResult {
  readonly chainsExamined: number;
  readonly chainsPruned: number;
  readonly entriesPruned: number;
}

/**
 * Retention policy evaluation and archive-then-prune execution. Only a
 * contiguous chain PREFIX is ever pruned (largest seq N such that every
 * entry <= N is past retention), so the surviving chain still verifies —
 * anchored at the archive's rootHash.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger('audit.retention');

  constructor(
    private readonly config: AuditConfigService,
    private readonly repo: AuditRepository,
    private readonly store: AuditArchiveStore,
    private readonly writer: AuditExportWriter,
    private readonly emitter: AuditEventEmitter,
    private readonly metrics: AuditMetrics,
  ) {}

  computeCutoff(now: Date, retentionDays: number): Date {
    return new Date(now.getTime() - retentionDays * DAY_MS);
  }

  async run(now = new Date()): Promise<RetentionSweepResult> {
    const heads = await this.repo.chainHeads();
    let chainsPruned = 0;
    let entriesPruned = 0;

    for (const head of heads) {
      try {
        const pruned = await this.sweepChain(head.scope, head.guildId, now);
        if (pruned > 0) {
          chainsPruned += 1;
          entriesPruned += pruned;
        }
      } catch (err) {
        // fault isolation: one broken chain must not block the others
        this.logger.error(
          `retention sweep failed for scope=${head.scope} guild=${
            head.guildId ?? 'global'
          }: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (entriesPruned > 0) {
      this.logger.log(
        `retention pruned ${entriesPruned} entries across ${chainsPruned} chains`,
      );
    }
    return { chainsExamined: heads.length, chainsPruned, entriesPruned };
  }

  private async sweepChain(
    scope: AuditScope,
    guildId: string | null,
    now: Date,
  ): Promise<number> {
    const cfg = await this.config.forGuild(guildId);
    const cutoff = this.computeCutoff(now, cfg.retentionDays);

    const firstSeq = await this.repo.firstSeq(scope, guildId);
    if (firstSeq === null) return 0;

    // Prune bound: everything strictly below the first entry still inside
    // the retention window. Late-arriving entries keep the prefix honest.
    const firstRetained = await this.repo.firstSeqAtOrAfter(
      scope,
      guildId,
      cutoff,
    );
    const last = await this.repo.findLast(scope, guildId);
    const bound = firstRetained !== null ? firstRetained - 1n : last!.seq;
    if (bound < firstSeq) return 0;

    if (cfg.archiveBeforeDelete) {
      const boundary = await this.repo.findBySeq(scope, guildId, bound);
      if (!boundary) {
        throw new Error(`prune boundary seq=${bound} vanished mid-sweep`);
      }
      const ext = cfg.archiveFormat;
      const stamp = now.toISOString().slice(0, 10);
      const relativePath = [
        scope.toLowerCase(),
        guildId ?? 'global',
        `${stamp}-${firstSeq}-${bound}.${ext}`,
      ].join('/');

      const written = await this.store.write(
        this.config.global().archiveDir,
        relativePath,
        this.writer.serialise(
          this.repo.iterateChainRange(scope, guildId, firstSeq - 1n, bound),
          ext,
        ),
      );

      await this.repo.createArchive({
        scope,
        guildId,
        format: ext,
        fromSeq: firstSeq,
        toSeq: bound,
        entryCount: Number(bound - firstSeq + 1n),
        byteSize: written.byteSize,
        storageRef: written.storageRef,
        rootHash: boundary.hash,
      });

      await this.emitter.emit(
        AuditEvents.RetentionArchived,
        {
          scope,
          guildId,
          fromSeq: firstSeq.toString(),
          toSeq: bound.toString(),
          entryCount: Number(bound - firstSeq + 1n),
          storageRef: written.storageRef,
          occurredAt: now.toISOString(),
        },
        guildId,
      );
    }

    const pruned = await this.repo.pruneUpTo(scope, guildId, bound);
    this.metrics.recordPruned(pruned);
    return pruned;
  }
}
