import { Injectable } from '@nestjs/common';
import { CacheService } from '../../../cache/cache.service';
import { CacheKeyBuilder } from '../../../cache/keys/cache-key.builder';
import { CacheNamespace } from '../../../cache/keys/cache-namespace.enum';
import type { PermissionContext } from '../domain/permission-context';
import { GroupRepository } from '../infrastructure/group.repository';
import { RoleMappingRepository } from '../infrastructure/role-mapping.repository';

const SNAPSHOT_TTL_SECONDS = 300;

@Injectable()
export class PermissionCacheFacade {
  constructor(
    private readonly cacheService: CacheService,
    private readonly cacheKeyBuilder: CacheKeyBuilder,
    private readonly groupRepo: GroupRepository,
    private readonly roleMappingRepo: RoleMappingRepository,
  ) {}

  async getContext(
    guildId: string,
    isGuildOwner: boolean,
    isBotOwner: boolean,
    memberRoleIds: readonly string[],
  ): Promise<PermissionContext> {
    const cacheKey = this.cacheKeyBuilder.forGuild(
      guildId,
      CacheNamespace.Permissions,
      'ctx',
    );

    type SnapshotData = Pick<
      PermissionContext,
      'roleToGroups' | 'defaultGroupKeys' | 'groups'
    >;

    const snapshot = await this.cacheService.getOrSet<SnapshotData>(
      cacheKey,
      () => this.loadSnapshot(guildId),
      { ttlSeconds: SNAPSHOT_TTL_SECONDS },
    );

    return {
      guildId,
      isGuildOwner,
      isBotOwner,
      memberRoleIds,
      roleToGroups: snapshot.roleToGroups,
      defaultGroupKeys: snapshot.defaultGroupKeys,
      groups: snapshot.groups,
    };
  }

  async invalidate(guildId: string): Promise<void> {
    await this.cacheService.delete(
      this.cacheKeyBuilder.forGuild(guildId, CacheNamespace.Permissions, 'ctx'),
    );
  }

  private async loadSnapshot(
    guildId: string,
  ): Promise<
    Pick<PermissionContext, 'roleToGroups' | 'defaultGroupKeys' | 'groups'>
  > {
    const [resolvedGroups, roleToGroupsMap] = await Promise.all([
      this.groupRepo.loadResolvedGroups(guildId),
      this.roleMappingRepo.buildRoleToGroupsMap(guildId),
    ]);

    const groupsRecord: Record<string, (typeof resolvedGroups)[0]> = {};
    for (const g of resolvedGroups) groupsRecord[g.key] = g;

    return {
      roleToGroups: roleToGroupsMap,
      defaultGroupKeys: ['member'],
      groups: groupsRecord,
    };
  }
}
