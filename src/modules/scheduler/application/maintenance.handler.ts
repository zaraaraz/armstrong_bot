import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../../core/events/event-bus';
import { ScheduleRepository } from '../infrastructure/schedule.repository';
import { SchedulerQueue } from '../infrastructure/scheduler.queue';
import { SchedulerConfigService } from '../config/scheduler-config.service';

/**
 * Reacts to maintenance-window and guild-deletion events:
 *  - `maintenance.window.opened`  → defer-aware logging (sweep handled at schedule time)
 *  - `maintenance.window.closed`  → invalidate cached guild config so deferral math refreshes
 *  - `guild.deleted`              → cascade soft-delete every schedule + tear down BullMQ entries
 */
@Injectable()
export class MaintenanceHandler implements OnModuleInit {
  private readonly logger = new Logger(MaintenanceHandler.name);

  constructor(
    private readonly eventBus: EventBus,
    private readonly repo: ScheduleRepository,
    private readonly queue: SchedulerQueue,
    private readonly config: SchedulerConfigService,
  ) {}

  onModuleInit(): void {
    this.eventBus.subscribe(
      'maintenance.window.opened',
      (env) => this.onWindowOpened(env.payload.guildId),
      { handlerId: 'scheduler.maintenance.opened', durable: false },
    );
    this.eventBus.subscribe(
      'maintenance.window.closed',
      (env) => this.onWindowClosed(env.payload.guildId),
      { handlerId: 'scheduler.maintenance.closed', durable: false },
    );
    this.eventBus.subscribe(
      'guild.deleted',
      (env) => this.onGuildDeleted(env.payload.guildId),
      { handlerId: 'scheduler.guild.deleted', durable: true },
    );
  }

  private onWindowOpened(guildId: string | null): void {
    this.logger.log(
      `Maintenance window opened for ${guildId ?? 'global'}; deferrable jobs will be pushed`,
    );
  }

  private async onWindowClosed(guildId: string | null): Promise<void> {
    if (guildId) await this.config.invalidateGuild(guildId);
    this.logger.log(`Maintenance window closed for ${guildId ?? 'global'}`);
  }

  /** Cascade-cancel all jobs for a deleted guild and remove their BullMQ entries. */
  private async onGuildDeleted(guildId: string): Promise<void> {
    const affected = await this.repo.softDeleteByGuild(guildId);
    for (const schedule of affected) {
      if (!schedule.bullJobId) continue;
      if (schedule.type === 'recurring') {
        await this.queue.removeRepeatable(schedule.bullJobId);
      } else {
        await this.queue.removeJob(schedule.bullJobId);
      }
    }
    await this.config.invalidateGuild(guildId);
    this.logger.log(
      `guild.deleted: soft-deleted ${affected.length} schedules for guild ${guildId}`,
    );
  }
}
