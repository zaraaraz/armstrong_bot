import { Injectable } from '@nestjs/common';
import { ApiKeyService as SecurityApiKeyService } from '../../../shared/security/services/api-key.service';
import type { ApiKeyRecord } from '../../../shared/security/repositories/api-key.repository';
import type {
  CreatedDashboardApiKey,
  DashboardApiKeyView,
  Paginated,
} from '../interfaces/dashboard.interfaces';

function toView(record: ApiKeyRecord): DashboardApiKeyView {
  return {
    id: record.id,
    guildId: record.guildId ?? '',
    name: record.name,
    prefix: record.prefix,
    scopes: record.scopes,
    lastUsedAt: record.lastUsedAt,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
    createdAt: record.createdAt,
  };
}

/**
 * Dashboard API-key management. Delegates all hashing/persistence to the shared
 * `@shared/security` ApiKeyService (single source of truth) and adapts results
 * into the dashboard's paginated view contract.
 */
@Injectable()
export class DashboardApiKeyService {
  constructor(private readonly security: SecurityApiKeyService) {}

  async list(
    guildId: string,
    page: number,
    pageSize: number,
  ): Promise<Paginated<DashboardApiKeyView>> {
    const all = await this.security.list(guildId);
    const total = all.length;
    const start = (page - 1) * pageSize;
    const items = all.slice(start, start + pageSize).map(toView);
    return {
      items,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async create(
    guildId: string,
    name: string,
    scopes: string[],
    expiresAt: Date | null,
  ): Promise<CreatedDashboardApiKey> {
    const { record, rawKey } = await this.security.create({
      guildId,
      name,
      scopes,
      expiresAt,
    });
    return { ...toView(record), plaintext: rawKey };
  }

  async revoke(guildId: string, id: string): Promise<void> {
    const keys = await this.security.list(guildId);
    if (!keys.some((k) => k.id === id)) {
      throw new Error('api_key_not_found');
    }
    await this.security.revoke(id);
  }
}
