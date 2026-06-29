/** A stored API key row (never contains the raw key). */
export interface ApiKeyRecord {
  readonly id: string;
  readonly guildId: string | null;
  readonly name: string;
  readonly hashedKey: string;
  readonly prefix: string;
  readonly scopes: readonly string[];
  readonly lastUsedAt: Date | null;
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
}

export interface CreateApiKeyInput {
  readonly guildId: string | null;
  readonly name: string;
  readonly hashedKey: string;
  readonly prefix: string;
  readonly scopes: readonly string[];
  readonly expiresAt: Date | null;
}

/**
 * Repository Pattern boundary for API-key persistence. Only the Prisma
 * implementation touches the ORM; callers depend on this abstract class.
 */
export abstract class ApiKeyRepository {
  abstract create(input: CreateApiKeyInput): Promise<ApiKeyRecord>;
  abstract findByGuild(guildId: string | null): Promise<ApiKeyRecord[]>;
  abstract findById(id: string): Promise<ApiKeyRecord | null>;
  /** Active (non-revoked, non-expired) keys for a given prefix. */
  abstract findActiveByPrefix(prefix: string): Promise<ApiKeyRecord[]>;
  abstract revoke(id: string): Promise<void>;
  abstract touchLastUsed(id: string): Promise<void>;
}
