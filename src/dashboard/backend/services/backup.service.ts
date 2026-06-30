import { Inject, Injectable } from '@nestjs/common';
import { EventBus } from '../../../core/events/event-bus';
import { BackupRepository } from '../repositories/backup.repository';
import { DashboardAuditRepository } from '../repositories/audit.repository';
import type { BackupView, Paginated } from '../interfaces/dashboard.interfaces';

/**
 * Backup orchestration. Creates a durable `dashboard_backups` record and emits
 * `dashboard.backup.requested`; the Backup module (Phase 4) consumes the event
 * and drives the job to completion, updating status. The dashboard never runs
 * the backup itself — it requests and observes.
 */
@Injectable()
export class BackupService {
  constructor(
    private readonly repo: BackupRepository,
    private readonly audit: DashboardAuditRepository,
    @Inject(EventBus) private readonly eventBus: EventBus,
  ) {}

  async request(guildId: string, actorDiscordId: string): Promise<BackupView> {
    const backup = await this.repo.create(guildId, actorDiscordId);
    await this.audit.record({
      guildId,
      actorId: actorDiscordId,
      action: 'backup.request',
      target: backup.id,
    });
    await this.eventBus.publish(
      'dashboard.backup.requested',
      {
        guildId,
        backupId: backup.id,
        actorDiscordId,
        at: new Date().toISOString(),
      },
      { guildId, actor: { type: 'user', id: actorDiscordId } },
    );
    return backup;
  }

  list(
    guildId: string,
    page: number,
    pageSize: number,
  ): Promise<Paginated<BackupView>> {
    return this.repo
      .listByGuild(guildId, page, pageSize)
      .then(({ items, total }) => ({
        items,
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      }));
  }

  findOne(guildId: string, id: string): Promise<BackupView | null> {
    return this.repo.findById(guildId, id);
  }
}
