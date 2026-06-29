import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { GuildMember } from 'discord.js';
import { EventBus } from '../../events/event-bus';
import { PermissionResolver } from '../domain/permission-resolver.service';
import type { PermissionDecision } from '../domain/permission-decision';
import { PermissionCacheFacade } from './permission-cache.facade';
import { GroupRepository } from '../infrastructure/group.repository';
import { ClaimGrantRepository } from '../infrastructure/claim-grant.repository';
import { RoleMappingRepository } from '../infrastructure/role-mapping.repository';
import { PermissionEvents } from '../events/permission.events';
import type { DecisionDeniedPayload } from '../events/permission.events';

export interface PermissionActor {
  readonly userId: string;
  readonly guildId: string;
  readonly discordRoleIds: readonly string[];
  readonly isGuildOwner: boolean;
}

export class PermissionDeniedError extends Error {
  constructor(claim: string) {
    super(`Permission denied: missing claim "${claim}"`);
    this.name = 'PermissionDeniedError';
  }
}

@Injectable()
export class PermissionService implements OnModuleInit {
  private readonly logger = new Logger(PermissionService.name);
  private botOwnerIds: readonly string[] = [];

  constructor(
    private readonly configService: ConfigService,
    @Inject(EventBus) private readonly eventBus: EventBus,
    private readonly resolver: PermissionResolver,
    private readonly cacheFacade: PermissionCacheFacade,
    private readonly groupRepo: GroupRepository,
    private readonly claimGrantRepo: ClaimGrantRepository,
    private readonly roleMappingRepo: RoleMappingRepository,
  ) {}

  onModuleInit(): void {
    const ids =
      this.configService.get<string>('PERMISSION_BOT_OWNER_IDS') ?? '';
    this.botOwnerIds = ids
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    this.eventBus.subscribe(
      PermissionEvents.ClaimGrantChanged,
      (envelope) => {
        void this.cacheFacade.invalidate(envelope.payload.guildId);
      },
      { handlerId: 'permissions:onClaimGrantChanged' },
    );
    this.eventBus.subscribe(
      PermissionEvents.GroupUpserted,
      (envelope) => {
        void this.cacheFacade.invalidate(envelope.payload.guildId);
      },
      { handlerId: 'permissions:onGroupUpserted' },
    );
    this.eventBus.subscribe(
      PermissionEvents.GroupAssigned,
      (envelope) => {
        void this.cacheFacade.invalidate(envelope.payload.guildId);
      },
      { handlerId: 'permissions:onGroupAssigned' },
    );
    this.eventBus.subscribe(
      PermissionEvents.GroupUnassigned,
      (envelope) => {
        void this.cacheFacade.invalidate(envelope.payload.guildId);
      },
      { handlerId: 'permissions:onGroupUnassigned' },
    );
    this.eventBus.subscribe(
      'guild.created',
      (envelope) => {
        void this.groupRepo.createTierDefaults(envelope.payload.guildId);
      },
      { handlerId: 'permissions:onGuildCreated' },
    );
  }

  async can(actor: PermissionActor, claim: string): Promise<boolean> {
    const context = await this.cacheFacade.getContext(
      actor.guildId,
      actor.isGuildOwner,
      this.botOwnerIds.includes(actor.userId),
      actor.discordRoleIds,
    );
    const decision = this.resolver.resolve(context, claim);
    return decision.allowed;
  }

  async canMember(member: GuildMember, claim: string): Promise<boolean> {
    const actor: PermissionActor = {
      userId: member.id,
      guildId: member.guild.id,
      discordRoleIds: [...member.roles.cache.keys()],
      isGuildOwner: member.guild.ownerId === member.id,
    };
    return this.can(actor, claim);
  }

  async explain(
    actor: PermissionActor,
    claim: string,
  ): Promise<PermissionDecision> {
    const context = await this.cacheFacade.getContext(
      actor.guildId,
      actor.isGuildOwner,
      this.botOwnerIds.includes(actor.userId),
      actor.discordRoleIds,
    );
    return this.resolver.resolve(context, claim);
  }

  async assert(actor: PermissionActor, claim: string): Promise<void> {
    const allowed = await this.can(actor, claim);
    if (!allowed) {
      const payload: DecisionDeniedPayload = {
        guildId: actor.guildId,
        userId: actor.userId,
        claim,
        surface: 'rest',
        at: new Date().toISOString(),
      };
      this.logger.warn({ msg: 'permission.denied', ...payload });
      await this.eventBus.publish(PermissionEvents.DecisionDenied, payload, {
        guildId: actor.guildId,
        actor: { type: 'system', id: 'permissions' },
      });
      throw new PermissionDeniedError(claim);
    }
  }

  async assignGroup(
    guildId: string,
    discordRoleId: string,
    groupKey: string,
  ): Promise<void> {
    const group = await this.groupRepo.findGroupByKey(guildId, groupKey);
    if (!group)
      throw new Error(`Group "${groupKey}" not found in guild ${guildId}`);
    await this.roleMappingRepo.assign(guildId, discordRoleId, group.id);
    await this.eventBus.publish(
      PermissionEvents.GroupAssigned,
      {
        guildId,
        discordRoleId,
        groupKey,
        actorUserId: 'system',
        at: new Date().toISOString(),
      },
      { guildId, actor: { type: 'system', id: 'permissions' } },
    );
  }

  async unassignGroup(
    guildId: string,
    discordRoleId: string,
    groupKey: string,
  ): Promise<void> {
    const group = await this.groupRepo.findGroupByKey(guildId, groupKey);
    if (!group) return;
    await this.roleMappingRepo.unassign(guildId, discordRoleId, group.id);
    await this.eventBus.publish(
      PermissionEvents.GroupUnassigned,
      {
        guildId,
        discordRoleId,
        groupKey,
        actorUserId: 'system',
        at: new Date().toISOString(),
      },
      { guildId, actor: { type: 'system', id: 'permissions' } },
    );
  }

  async setClaimGrant(
    guildId: string,
    groupKey: string,
    claim: string,
    effect: 'GRANT' | 'DENY',
  ): Promise<void> {
    const group = await this.groupRepo.findGroupByKey(guildId, groupKey);
    if (!group) throw new Error(`Group "${groupKey}" not found`);
    await this.claimGrantRepo.upsert(guildId, group.id, claim, effect);
    await this.eventBus.publish(
      PermissionEvents.ClaimGrantChanged,
      {
        guildId,
        groupKey,
        claim,
        effect,
        actorUserId: 'system',
        at: new Date().toISOString(),
      },
      { guildId, actor: { type: 'system', id: 'permissions' } },
    );
  }

  async removeClaimGrant(
    guildId: string,
    groupKey: string,
    claim: string,
  ): Promise<void> {
    const group = await this.groupRepo.findGroupByKey(guildId, groupKey);
    if (!group) return;
    await this.claimGrantRepo.removeGrant(group.id, claim);
    await this.eventBus.publish(
      PermissionEvents.ClaimGrantChanged,
      {
        guildId,
        groupKey,
        claim,
        effect: 'REMOVED',
        actorUserId: 'system',
        at: new Date().toISOString(),
      },
      { guildId, actor: { type: 'system', id: 'permissions' } },
    );
  }

  async listGroups(guildId: string) {
    return this.groupRepo.findByGuild(guildId);
  }
}
