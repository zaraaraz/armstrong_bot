import { Injectable, Logger } from '@nestjs/common';
import { MetricsSnapshotRepository } from '../infrastructure/repositories/metrics-snapshot.repository';
import { MetricsSnapshotBuilder } from './metrics-snapshot.builder';
import { MetricsConfigService } from '../config/metrics-config.service';
import { MetricsEventEmitter } from '../events/metrics-event.emitter';

const RETENTION_GRACE_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Persists periodic global rollups and prunes old ones. Invoked only by the
 * recurring BullMQ job — never on the hot path. Each persisted scope emits
 * `metrics.snapshot.created`.
 */
@Injectable()
export class MetricsSnapshotWriter {
  private readonly logger = new Logger('metrics.snapshot');

  constructor(
    private readonly builder: MetricsSnapshotBuilder,
    private readonly repo: MetricsSnapshotRepository,
    private readonly config: MetricsConfigService,
    private readonly emitter: MetricsEventEmitter,
  ) {}

  /** Build + persist one snapshot per scope with data (global scope only). */
  async capture(): Promise<number> {
    const scopes = await this.builder.buildAll();
    const capturedAt = new Date();
    let written = 0;

    for (const { scope, values } of scopes) {
      try {
        const view = await this.repo.create({
          scope,
          guildId: null,
          capturedAt,
          values,
        });
        written += 1;
        await this.emitter.emitSnapshotCreated({
          snapshotId: view.id,
          scope: view.scope,
          guildId: null,
          capturedAt: view.capturedAt.toISOString(),
        });
      } catch (err) {
        this.logger.error(
          `snapshot write failed for scope ${scope}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    this.logger.log(`persisted ${written} snapshot scope(s)`);
    return written;
  }

  /**
   * Soft-delete rollups past `retentionDays`, then hard-delete rows that have
   * been soft-deleted beyond a grace window (audit-trail friendly two-stage
   * prune).
   */
  async prune(): Promise<{ softDeleted: number; hardDeleted: number }> {
    const retentionDays = this.config.global().snapshot.retentionDays;
    const now = Date.now();
    const softCutoff = new Date(now - retentionDays * MS_PER_DAY);
    const hardCutoff = new Date(now - RETENTION_GRACE_DAYS * MS_PER_DAY);

    const softDeleted = await this.repo.softDeleteOlderThan(softCutoff);
    const hardDeleted = await this.repo.hardDeleteSoftDeletedBefore(hardCutoff);
    this.logger.log(
      `retention prune: soft-deleted ${softDeleted}, hard-deleted ${hardDeleted}`,
    );
    return { softDeleted, hardDeleted };
  }
}
