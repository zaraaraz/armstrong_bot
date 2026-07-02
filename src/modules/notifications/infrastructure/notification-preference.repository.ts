import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import type { NotificationChannel } from '../notifications.public';

export interface PreferenceRow {
  readonly id: string;
  readonly guildId: string;
  readonly userId: string;
  readonly category: string;
  readonly channel: NotificationChannel;
  readonly enabled: boolean;
}

export interface UpsertPreferenceInput {
  readonly guildId: string;
  readonly userId: string;
  readonly category: string;
  readonly channel: NotificationChannel;
  readonly enabled: boolean;
}

/**
 * Prisma-only persistence for {@link NotificationPreference}. The only file in
 * this module that touches the preferences table. Reads scope to
 * `deletedAt IS NULL`.
 */
@Injectable()
export class NotificationPreferenceRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get prefs() {
    return this.prisma['notificationPreference'];
  }

  /** All active preference rows for one user in one guild. */
  async findForUser(guildId: string, userId: string): Promise<PreferenceRow[]> {
    return await this.prefs.findMany({
      where: { guildId, userId, deletedAt: null },
    });
  }

  async upsertMany(inputs: readonly UpsertPreferenceInput[]): Promise<void> {
    // Small batches (bounded by categories × channels), so a per-row upsert
    // inside a transaction keeps the code simple and atomic.
    await this.prisma.$transaction(
      inputs.map((input) =>
        this.prefs.upsert({
          where: {
            guildId_userId_category_channel: {
              guildId: input.guildId,
              userId: input.userId,
              category: input.category,
              channel: input.channel,
            },
          },
          create: { ...input },
          update: { enabled: input.enabled, deletedAt: null },
        }),
      ),
    );
  }
}
