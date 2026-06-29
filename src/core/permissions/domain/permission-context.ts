export interface ResolvedGroup {
  readonly key: string;
  readonly priority: number;
  readonly grants: ReadonlyArray<{ claim: string; effect: 'GRANT' | 'DENY' }>;
  readonly parents: readonly string[];
}

export interface PermissionContext {
  readonly guildId: string;
  readonly isGuildOwner: boolean;
  readonly isBotOwner: boolean;
  readonly memberRoleIds: readonly string[];
  readonly roleToGroups: Readonly<Record<string, readonly string[]>>;
  readonly defaultGroupKeys: readonly string[];
  readonly groups: Readonly<Record<string, ResolvedGroup>>;
}
