/** The authenticated principal behind a request, regardless of strategy. */
export type AuthMethod = 'session' | 'jwt' | 'api-key';

export interface AuthenticatedActor {
  /** Discord user id OR api-key subject id. */
  readonly id: string;
  readonly type: 'user' | 'service';
  readonly method: AuthMethod;
  readonly displayName: string;
  /** Resolved permission claims (wildcards expanded contextually by Permissions). */
  readonly claims: ReadonlySet<string>;
  /** Guilds this actor may act within; empty set => global/service scope. */
  readonly guildScope: ReadonlySet<string>;
}

/** Resolved guild context attached to guild-scoped routes. */
export interface GuildContext {
  readonly guildId: string;
  readonly locale: string;
}

/**
 * The shape attached to `req` by the auth pipeline. Other modules' guards
 * (e.g. the Permissions `RestPermissionGuard`) read `req.user`, so we mirror
 * the actor onto a `user` field with the structure that guard expects.
 */
export interface ApiRequestContext {
  requestId: string;
  actor?: AuthenticatedActor;
  guild?: GuildContext;
  /** Mirror for the core RestPermissionGuard (reads id/guildId/roles/owner). */
  user?: {
    readonly id: string;
    readonly guildId: string;
    readonly discordRoleIds: readonly string[];
    readonly isGuildOwner: boolean;
  };
}
