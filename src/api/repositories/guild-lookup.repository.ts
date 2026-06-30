import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface GuildLocaleInfo {
  readonly discordId: string;
  readonly locale: string;
  readonly ownerId: string;
}

/** Read-only lookup of guild metadata needed by the API guild-scope guard. */
export abstract class GuildLookupRepository {
  /** Resolves a guild by its Discord id, or null if unknown to the bot. */
  abstract findByDiscordId(discordId: string): Promise<GuildLocaleInfo | null>;
}

@Injectable()
export class PrismaGuildLookupRepository extends GuildLookupRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findByDiscordId(discordId: string): Promise<GuildLocaleInfo | null> {
    const row = await this.prisma.guild.findFirst({
      where: { discordId, deletedAt: null },
      select: { discordId: true, locale: true, ownerId: true },
    });
    return row;
  }
}
