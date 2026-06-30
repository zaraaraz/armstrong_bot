/** Public contracts exposed by the Dashboard backend. */

export interface DashboardUser {
  readonly discordId: string;
  readonly username: string;
  readonly globalName: string | null;
  readonly avatarHash: string | null;
  readonly isBotOwner: boolean;
}

export interface ManageableGuild {
  readonly guildId: string; // Discord guild id
  readonly name: string;
  readonly iconHash: string | null;
  readonly botPresent: boolean;
  readonly hasManage: boolean;
}

export interface DashboardSessionData {
  readonly sessionId: string;
  readonly user: DashboardUser;
  readonly guilds: ReadonlyArray<ManageableGuild>;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface Paginated<T> {
  readonly items: ReadonlyArray<T>;
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}

export interface DashboardApiKeyView {
  readonly id: string;
  readonly guildId: string;
  readonly name: string;
  readonly prefix: string;
  readonly scopes: ReadonlyArray<string>;
  readonly lastUsedAt: Date | null;
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
}

export interface CreatedDashboardApiKey extends DashboardApiKeyView {
  readonly plaintext: string; // returned ONCE on creation, never stored
}

export interface BackupView {
  readonly id: string;
  readonly guildId: string;
  readonly status: string;
  readonly jobId: string | null;
  readonly sizeBytes: number | null;
  readonly error: string | null;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
}

export class ForbiddenDashboardError extends Error {
  constructor(message = 'Manage Guild required') {
    super(message);
    this.name = 'ForbiddenDashboardError';
  }
}
