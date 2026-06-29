export const PermissionEvents = {
  GroupAssigned: 'permission.group.assigned',
  GroupUnassigned: 'permission.group.unassigned',
  ClaimGrantChanged: 'permission.claim.grant_changed',
  GroupUpserted: 'permission.group.upserted',
  DecisionDenied: 'permission.decision.denied',
} as const;

export interface GroupAssignedPayload {
  readonly guildId: string;
  readonly discordRoleId: string;
  readonly groupKey: string;
  readonly actorUserId: string;
  readonly at: string;
}

export interface ClaimGrantChangedPayload {
  readonly guildId: string;
  readonly groupKey: string;
  readonly claim: string;
  readonly effect: 'GRANT' | 'DENY' | 'REMOVED';
  readonly actorUserId: string;
  readonly at: string;
}

export interface DecisionDeniedPayload {
  readonly guildId: string;
  readonly userId: string;
  readonly claim: string;
  readonly surface: 'command' | 'rest';
  readonly at: string;
}
