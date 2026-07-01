import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

/**
 * Reads the set of guilds the bot is currently a member of, as maintained by
 * the gateway's guild registry. This is the live source for the dashboard's
 * `botPresent` flag (replacing the static BOT_GUILD_IDS stopgap).
 */
@Injectable()
export class BotGuildsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async activeDiscordIds(): Promise<ReadonlySet<string>> {
    const rows = await this.prisma['guild'].findMany({
      where: { active: true, deletedAt: null },
      select: { discordId: true },
    });
    return new Set(rows.map((r) => r.discordId));
  }
}
