import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { EncryptionService } from './encryption.service';
import {
  ApiKeyRepository,
  type ApiKeyRecord,
} from '../repositories/api-key.repository';

const RAW_KEY_BYTES = 24;
const PREFIX_LENGTH = 8;

export interface CreatedApiKey {
  readonly record: ApiKeyRecord;
  /** The raw key — shown to the caller exactly once, never persisted. */
  readonly rawKey: string;
}

export interface CreateApiKeyParams {
  readonly guildId: string | null;
  readonly name: string;
  readonly scopes: readonly string[];
  readonly expiresAt: Date | null;
}

/**
 * API-key lifecycle: generate a high-entropy raw key, persist only its hash,
 * and authenticate incoming keys by prefix lookup + constant-time verify.
 */
@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);

  constructor(
    @Inject(ApiKeyRepository) private readonly repo: ApiKeyRepository,
    private readonly encryption: EncryptionService,
  ) {}

  async create(params: CreateApiKeyParams): Promise<CreatedApiKey> {
    const rawKey = `ghk_${randomBytes(RAW_KEY_BYTES).toString('base64url')}`;
    const prefix = rawKey.slice(0, PREFIX_LENGTH);
    const hashedKey = await this.encryption.hash(rawKey);

    const record = await this.repo.create({
      guildId: params.guildId,
      name: params.name,
      hashedKey,
      prefix,
      scopes: params.scopes,
      expiresAt: params.expiresAt,
    });

    return { record, rawKey };
  }

  list(guildId: string | null): Promise<ApiKeyRecord[]> {
    return this.repo.findByGuild(guildId);
  }

  revoke(id: string): Promise<void> {
    return this.repo.revoke(id);
  }

  /**
   * Resolve a raw key to its record, or null if no active key matches.
   * Verifies against every active key sharing the prefix (constant-time hash).
   */
  async authenticate(rawKey: string): Promise<ApiKeyRecord | null> {
    const prefix = rawKey.slice(0, PREFIX_LENGTH);
    const candidates = await this.repo.findActiveByPrefix(prefix);

    for (const candidate of candidates) {
      const ok = await this.encryption.verify(rawKey, candidate.hashedKey);
      if (ok) {
        await this.repo.touchLastUsed(candidate.id);
        return candidate;
      }
    }
    return null;
  }
}
