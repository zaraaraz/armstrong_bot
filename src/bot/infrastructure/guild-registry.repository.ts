import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/** The gateway-observed identity of a guild the bot is a member of. */
export interface GuildSnapshot {
  readonly discordId: string;
  readonly name: string;
  readonly iconHash: string | null;
  readonly ownerId: string;
}

/**
 * Persists the bot's guild membership into the `Guild` table — the root of all
 * guild-scoped data and the source of truth the dashboard uses for
 * `botPresent`. Upserts on join/ready; soft-deactivates on leave.
 */
@Injectable()
export class GuildRegistryRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get guilds() {
    return this.prisma['guild'];
  }

  async upsert(snapshot: GuildSnapshot): Promise<void> {
    await this.guilds.upsert({
      where: { discordId: snapshot.discordId },
      create: {
        discordId: snapshot.discordId,
        name: snapshot.name,
        iconHash: snapshot.iconHash,
        ownerId: snapshot.ownerId,
      },
      update: {
        name: snapshot.name,
        iconHash: snapshot.iconHash,
        ownerId: snapshot.ownerId,
        active: true,
        deletedAt: null,
      },
    });
  }

  /** Mark a guild the bot left as inactive (kept for history / re-join). */
  async deactivate(discordId: string): Promise<void> {
    await this.guilds.updateMany({
      where: { discordId },
      data: { active: false, deletedAt: new Date() },
    });
  }

  /**
   * Reconcile on startup: everything in `known` is upserted active; previously
   * active rows NOT in `known` are deactivated (the bot was removed while
   * offline).
   */
  async reconcile(known: readonly GuildSnapshot[]): Promise<void> {
    for (const snapshot of known) {
      await this.upsert(snapshot);
    }
    const ids = known.map((g) => g.discordId);
    await this.guilds.updateMany({
      where: {
        active: true,
        ...(ids.length ? { discordId: { notIn: ids } } : {}),
      },
      data: { active: false, deletedAt: new Date() },
    });
  }
}
