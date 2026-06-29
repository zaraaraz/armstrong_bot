import { Injectable } from '@nestjs/common';
import type { PrismaService } from '../../../database/prisma.service';
import type { ResolvedGroup } from '../domain/permission-context';

@Injectable()
export class GroupRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByGuild(
    guildId: string,
  ): Promise<readonly Record<string, unknown>[]> {
    return this.prisma['permissionGroup'].findMany({
      where: { guildId, deletedAt: null },
    });
  }

  async findGroupByKey(
    guildId: string,
    key: string,
  ): Promise<{ id: string; key: string } | null> {
    return this.prisma['permissionGroup'].findFirst({
      where: { guildId, key, deletedAt: null },
    });
  }

  async createTierDefaults(guildId: string): Promise<void> {
    const tiers = [
      { key: 'owner', name: 'Owner', priority: 1000 },
      { key: 'admin', name: 'Admin', priority: 800 },
      { key: 'mod', name: 'Mod', priority: 500 },
      { key: 'member', name: 'Member', priority: 100 },
    ];

    const groupIds: Record<string, string> = {};

    for (const tier of tiers) {
      const group = await this.prisma['permissionGroup'].upsert({
        where: { guildId_key: { guildId, key: tier.key } },
        update: {},
        create: {
          guildId,
          key: tier.key,
          name: tier.name,
          priority: tier.priority,
          isSystem: true,
        },
      });
      groupIds[tier.key] = group.id;
    }

    const defaultGrants: Array<{ groupId: string; claim: string }> = [
      { groupId: groupIds['owner'], claim: '*' },
      { groupId: groupIds['admin'], claim: 'admin.*' },
      { groupId: groupIds['admin'], claim: 'permissions.*' },
      { groupId: groupIds['admin'], claim: 'tickets.*' },
      { groupId: groupIds['admin'], claim: 'fivem.*' },
      { groupId: groupIds['mod'], claim: 'tickets.*' },
      { groupId: groupIds['mod'], claim: 'moderation.*' },
      { groupId: groupIds['mod'], claim: 'fivem.restart' },
      { groupId: groupIds['member'], claim: 'tickets.create' },
      { groupId: groupIds['member'], claim: 'tickets.view.own' },
    ];

    for (const grant of defaultGrants) {
      await this.prisma['claimGrant'].upsert({
        where: {
          groupId_claim: { groupId: grant.groupId, claim: grant.claim },
        },
        update: {},
        create: {
          guildId,
          groupId: grant.groupId,
          claim: grant.claim,
          effect: 'GRANT',
        },
      });
    }
  }

  async loadResolvedGroups(
    guildId: string,
  ): Promise<ReadonlyArray<ResolvedGroup>> {
    const groups = await this.prisma['permissionGroup'].findMany({
      where: { guildId, deletedAt: null },
      include: { grants: true, parents: true },
    });

    return groups.map((g: Record<string, unknown>) => {
      const grants =
        (g['grants'] as Array<{ claim: string; effect: string }>) ?? [];
      const parents = (g['parents'] as Array<{ parentGroupId: string }>) ?? [];
      return {
        key: g['key'] as string,
        priority: g['priority'] as number,
        grants: grants.map((gr) => ({
          claim: gr.claim,
          effect: gr.effect as 'GRANT' | 'DENY',
        })),
        parents: parents.map((p) => p.parentGroupId),
      };
    });
  }
}
