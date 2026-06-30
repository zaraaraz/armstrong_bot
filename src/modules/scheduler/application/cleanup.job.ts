import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { z } from 'zod';
import { JobRegistry } from '../domain/job-registry';
import { JobKind } from '../domain/job-kind.enum';
import type { JobHandler } from '../domain/job-handler.interface';
import { ScheduleRepository } from '../infrastructure/schedule.repository';
import { SchedulerConfigService } from '../config/scheduler-config.service';
import { SchedulerDomainService } from '../domain/scheduler.domain-service';
import { SchedulerServiceImpl } from './scheduler.service';

const cleanupPayloadSchema = z.object({}).passthrough();

/**
 * The built-in maintenance job that purges `ScheduleRun` rows older than the
 * configured retention. Registers its own handler and schedules itself as a
 * global nightly cron at bootstrap.
 */
@Injectable()
export class CleanupJob
  implements JobHandler<Record<string, unknown>>, OnApplicationBootstrap
{
  readonly kind = JobKind.Cleanup;
  private readonly logger = new Logger(CleanupJob.name);

  constructor(
    private readonly registry: JobRegistry,
    private readonly repo: ScheduleRepository,
    private readonly config: SchedulerConfigService,
    private readonly domain: SchedulerDomainService,
    private readonly scheduler: SchedulerServiceImpl,
  ) {}

  onApplicationBootstrap(): void {
    this.registry.register(this);
    // Schedule the global nightly cleanup. Idempotent — reconcile keeps it alive.
    void this.scheduler
      .scheduleRecurring({
        guildId: null,
        kind: JobKind.Cleanup,
        payload: {},
        cron: '0 4 * * *', // 04:00 daily
        timezone: 'UTC',
        idempotencyKey: 'scheduler.cleanup.global',
        deferrableInMaintenance: false,
      })
      .catch((err: unknown) =>
        this.logger.error('Failed to schedule cleanup job', err as Error),
      );
  }

  parse(raw: unknown): Record<string, unknown> {
    return cleanupPayloadSchema.parse(raw ?? {});
  }

  async handle(): Promise<void> {
    const global = this.config.global();
    const cutoff = this.domain.retentionCutoff(global, new Date());
    const purged = await this.repo.purgeRunsBefore(cutoff);
    this.logger.log(
      `Cleanup purged ${purged} schedule runs older than ${cutoff.toISOString()}`,
    );
  }
}
