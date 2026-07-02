import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { CacheService } from '../../../cache/cache.service';
import { CacheNamespace } from '../../../cache/keys/cache-namespace.enum';
import { WEBHOOKS_CACHE } from '../webhooks.constants';
import { WebhookProvider } from '../domain/webhook-provider.enum';
import type { PageResult } from '../domain/integration-event';

/** Row shape returned by the `webhookEndpoint` Prisma delegate. */
interface WebhookEndpointRow {
  readonly id: string;
  readonly guildId: string | null;
  readonly provider: string;
  readonly token: string;
  readonly signingSecret: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly createdById: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

/** Clean domain view of a webhook endpoint (secret stays ciphertext). */
export interface WebhookEndpointRecord {
  readonly id: string;
  readonly guildId: string | null;
  readonly provider: WebhookProvider;
  readonly token: string;
  /** Encrypted signing secret (ciphertext) — never plaintext. */
  readonly signingSecret: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly createdById: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

/** Input to persist a new inbound endpoint. */
export interface CreateWebhookEndpointInput {
  readonly provider: WebhookProvider;
  readonly token: string;
  /** Encrypted signing secret (ciphertext). */
  readonly signingSecret: string;
  readonly label: string;
  readonly guildId: string | null;
  readonly createdById: string;
}

/** Patchable fields on an existing endpoint. */
export interface UpdateWebhookEndpointInput {
  readonly label?: string;
  readonly enabled?: boolean;
}

/** New credentials produced by a rotate operation. */
export interface RotateWebhookEndpointInput {
  readonly token: string;
  /** Encrypted signing secret (ciphertext). */
  readonly signingSecret: string;
}

/**
 * TTL for the endpoint-by-token cache-through. Mirrors the
 * `cacheTtlSeconds` default in `config/webhooks.config.ts`; repositories inject
 * only Prisma + Cache, so the value is kept local rather than pulled from the
 * config service.
 */
const ENDPOINT_CACHE_TTL_SECONDS = 300;

/**
 * Prisma-only persistence for {@link WebhookEndpoint}. The only file in this
 * module that touches the `webhook_endpoints` table. All reads scope
 * `deletedAt IS NULL`; deletes are soft (set `deletedAt`). The endpoint-by-token
 * lookup is cache-through (namespace `CacheNamespace.Generic`, spec §7).
 */
@Injectable()
export class WebhookEndpointRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  private get endpoints() {
    return this.prisma['webhookEndpoint'];
  }

  /** Persists a new endpoint (enabled by default). */
  async create(
    input: CreateWebhookEndpointInput,
  ): Promise<WebhookEndpointRecord> {
    const row = (await this.endpoints.create({
      data: {
        provider: input.provider,
        token: input.token,
        signingSecret: input.signingSecret,
        label: input.label,
        guildId: input.guildId,
        createdById: input.createdById,
        enabled: true,
      },
    })) as WebhookEndpointRow;
    return this.toRecord(row);
  }

  /**
   * Resolves an endpoint by its public token, cache-through. Misses are NOT
   * cached (manual `get`/`set`) so a probe on an unknown token cannot poison the
   * cache with a null. The caller checks `enabled` after resolution.
   */
  async findByToken(token: string): Promise<WebhookEndpointRecord | null> {
    const key = this.cacheKey(token);
    const cached = await this.cache.get<WebhookEndpointRecord>(key);
    if (cached !== null) return cached;

    const row = (await this.endpoints.findFirst({
      where: { token, deletedAt: null },
    })) as WebhookEndpointRow | null;
    if (!row) return null;

    const record = this.toRecord(row);
    await this.cache.set(key, record, {
      ttlSeconds: ENDPOINT_CACHE_TTL_SECONDS,
    });
    return record;
  }

  async findById(id: string): Promise<WebhookEndpointRecord | null> {
    const row = (await this.endpoints.findFirst({
      where: { id, deletedAt: null },
    })) as WebhookEndpointRow | null;
    return row ? this.toRecord(row) : null;
  }

  /** Paginated list of endpoints owned by a guild (newest first). */
  async listForGuild(
    guildId: string,
    page: number,
    pageSize: number,
  ): Promise<PageResult<WebhookEndpointRecord>> {
    const where = { guildId, deletedAt: null };
    const [rows, total] = await Promise.all([
      this.endpoints.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }) as Promise<WebhookEndpointRow[]>,
      this.endpoints.count({ where }) as Promise<number>,
    ]);
    return {
      items: rows.map((r) => this.toRecord(r)),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Applies a label/enabled patch. The caller passes the endpoint's current
   * token so the cache-through entry is invalidated.
   */
  async update(
    id: string,
    patch: UpdateWebhookEndpointInput,
    oldToken: string,
  ): Promise<WebhookEndpointRecord | null> {
    const result = await this.endpoints.updateMany({
      where: { id, deletedAt: null },
      data: {
        label: patch.label,
        enabled: patch.enabled,
      },
    });
    await this.invalidateToken(oldToken);
    if (result.count === 0) return null;
    return this.findById(id);
  }

  /**
   * Rotates the token + signing secret. The caller passes the previous token so
   * its cache-through entry is invalidated.
   */
  async rotate(
    id: string,
    input: RotateWebhookEndpointInput,
    oldToken: string,
  ): Promise<WebhookEndpointRecord | null> {
    const result = await this.endpoints.updateMany({
      where: { id, deletedAt: null },
      data: {
        token: input.token,
        signingSecret: input.signingSecret,
      },
    });
    await this.invalidateToken(oldToken);
    if (result.count === 0) return null;
    return this.findById(id);
  }

  /**
   * Soft-deletes an endpoint (sets `deletedAt`). The caller passes the token so
   * the cache-through entry is invalidated.
   */
  async softDelete(id: string, oldToken: string): Promise<boolean> {
    const result = await this.endpoints.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    await this.invalidateToken(oldToken);
    return result.count > 0;
  }

  /** Evicts a token's cache-through entry. */
  async invalidateToken(token: string): Promise<void> {
    await this.cache.delete(this.cacheKey(token));
  }

  private cacheKey(token: string): string {
    return this.cache.keys.forGlobal(
      CacheNamespace.Generic,
      WEBHOOKS_CACHE.Endpoint,
      token,
    );
  }

  private toRecord(row: WebhookEndpointRow): WebhookEndpointRecord {
    return {
      id: row.id,
      guildId: row.guildId,
      provider: row.provider as WebhookProvider,
      token: row.token,
      signingSecret: row.signingSecret,
      label: row.label,
      enabled: row.enabled,
      createdById: row.createdById,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    };
  }
}
