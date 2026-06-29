export interface PermissionsEventPayloads {
  'permission.group.assigned': {
    readonly guildId: string;
    readonly discordRoleId: string;
    readonly groupKey: string;
    readonly actorUserId: string;
    readonly at: string;
  };
  'permission.group.unassigned': {
    readonly guildId: string;
    readonly discordRoleId: string;
    readonly groupKey: string;
    readonly actorUserId: string;
    readonly at: string;
  };
  'permission.claim.grant_changed': {
    readonly guildId: string;
    readonly groupKey: string;
    readonly claim: string;
    readonly effect: 'GRANT' | 'DENY' | 'REMOVED';
    readonly actorUserId: string;
    readonly at: string;
  };
  'permission.group.upserted': {
    readonly guildId: string;
    readonly groupKey: string;
    readonly actorUserId: string;
    readonly at: string;
  };
  'permission.decision.denied': {
    readonly guildId: string;
    readonly userId: string;
    readonly claim: string;
    readonly surface: 'command' | 'rest';
    readonly at: string;
  };
}
