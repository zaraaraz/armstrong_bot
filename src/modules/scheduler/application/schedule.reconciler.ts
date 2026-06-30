import {
  Injectable,
  Logger,
  OnModuleInit,
  OnApplicationShutdown,
} from '@nestjs/common';
import { SchedulerQueue } from '../infrastructure/scheduler.queue';
import { ScheduleRepository } from '../infrastructure/schedule.repository';
import { SchedulerConfigService } from '../config/scheduler-config.service';
import { SchedulerServiceImpl } from './scheduler.service';
import { SchedulerMetrics } from '../observability/scheduler.metrics';
import { SchedulerTracing } from '../observability/scheduler.tracing';
import { SchedulerHealthState } from './scheduler-health.state';

interface RepeatableSummary {
  key: string;
  name: string;
  pattern?: string;
  tz?: string;
  id?: string | null;
}

/**
 * Converges the durable DB schedule definitions with BullMQ's repeatable-job
 * registry on boot and on a heartbeat: re-hydrates missing repeats, removes
 * orphans, and corrects drifted cron/timezone. This is what makes schedules
 * survive a process restart.
 */
@Injectable()
export class ScheduleReconciler implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ScheduleReconciler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly queue: SchedulerQueue,
    private readonly repo: ScheduleRepository,
    private readonly config: SchedulerConfigService,
    private readonly service: SchedulerServiceImpl,
    private readonly metrics: SchedulerMetrics,
    private readonly tracing: SchedulerTracing,
    private readonly health: SchedulerHealthState,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reconcile().catch((err: unknown) =>
      this.logger.error('Initial reconcile failed', err as Error),
    );
    const interval = this.config.global().reconcileIntervalMs;
    this.timer = setInterval(() => {
      void this.reconcile().catch((err: unknown) =>
        this.logger.error('Heartbeat reconcile failed', err as Error),
      );
    }, interval);
    this.timer.unref?.();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One convergence pass. Safe to call concurrently — guarded by `running`. */
  async reconcile(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.tracing.withSpan('scheduler.reconcile', {}, async () => {
        const dbActive = (await this.repo.findActiveRecurring()).filter(
          (s) => s.status === 'active',
        );
        const repeatables = await this.listRepeatables();
        const byScheduleId = new Map(
          repeatables.map((r) => [r.id ?? r.key, r]),
        );

        let added = 0;
        let corrected = 0;

        for (const schedule of dbActive) {
          const existing = byScheduleId.get(schedule.id);
          if (!existing) {
            const key = await this.service.enqueueRecurring(schedule);
            await this.repo.update(schedule.id, { bullJobId: key });
            added++;
            continue;
          }
          byScheduleId.delete(schedule.id);
          if (this.hasDrifted(schedule.cron, schedule.timezone, existing)) {
            await this.queue.removeRepeatable(existing.key);
            const key = await this.service.enqueueRecurring(schedule);
            await this.repo.update(schedule.id, { bullJobId: key });
            corrected++;
          }
        }

        // Anything left in the map is an orphaned repeat with no live DB row.
        let removed = 0;
        for (const orphan of byScheduleId.values()) {
          await this.queue.removeRepeatable(orphan.key);
          removed++;
        }

        if (added) this.metrics.recordDrift('added', added);
        if (removed) this.metrics.recordDrift('removed', removed);
        if (corrected) this.metrics.recordDrift('corrected', corrected);

        this.metrics.setQueueDepth(await this.queue.depth());
        this.health.markReconciled(new Date());

        if (added || removed || corrected) {
          this.logger.log(
            `Reconcile: +${added} added, -${removed} orphans, ~${corrected} corrected`,
          );
        }
      });
    } finally {
      this.running = false;
    }
  }

  private async listRepeatables(): Promise<RepeatableSummary[]> {
    const raw = await this.queue.queue.getRepeatableJobs();
    return raw.map((r) => ({
      key: r.key,
      name: r.name,
      pattern: r.pattern ?? undefined,
      tz: r.tz ?? undefined,
      id: r.id,
    }));
  }

  private hasDrifted(
    cron: string | null,
    timezone: string,
    existing: RepeatableSummary,
  ): boolean {
    if (!cron) return false; // interval jobs: BullMQ key encodes `every`, no drift check
    return existing.pattern !== cron || (existing.tz ?? 'UTC') !== timezone;
  }
}
