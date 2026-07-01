import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class RoleMappingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByGuild(
    guildId: string,
  ): Promise<readonly Record<string, unknown>[]> {
    return this.prisma['roleGroupMapping'].findMany({ where: { guildId } });
  }

  async assign(
    guildId: string,
    discordRoleId: string,
    groupId: string,
  ): Promise<void> {
    await this.prisma['roleGroupMapping'].upsert({
      where: {
        guildId_discordRoleId_groupId: { guildId, discordRoleId, groupId },
      },
      update: {},
      create: { guildId, discordRoleId, groupId },
    });
  }

  async unassign(
    guildId: string,
    discordRoleId: string,
    groupId: string,
  ): Promise<void> {
    await this.prisma['roleGroupMapping'].deleteMany({
      where: { guildId, discordRoleId, groupId },
    });
  }

  async buildRoleToGroupsMap(
    guildId: string,
  ): Promise<Record<string, readonly string[]>> {
    const mappings = await this.findByGuild(guildId);
    const result: Record<string, string[]> = {};
    for (const m of mappings) {
      const roleId = m['discordRoleId'] as string;
      const groupId = m['groupId'] as string;
      if (!result[roleId]) result[roleId] = [];
      result[roleId].push(groupId);
    }
    return result;
  }
}
