import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { EncryptionService } from '../../../shared/security/services/encryption.service';
import type { PageResult } from '../domain/integration-event';
import type { WebhookProvider } from '../domain/webhook-provider.enum';
import type { CreateEndpointInput } from '../dto/create-endpoint.dto';
import type { UpdateEndpointInput } from '../dto/update-endpoint.dto';
import {
  WebhookEndpointRepository,
  type WebhookEndpointRecord,
} from '../repositories/webhook-endpoint.repository';

/** Bytes of entropy for a public ingress token (base64url-encoded). */
const TOKEN_BYTES = 24;
/** Bytes of entropy for a generated signing secret (base64-encoded). */
const SECRET_BYTES = 32;

/**
 * Thrown when a guild-scoped mutation targets an endpoint the guild does not
 * own (or that does not exist). Surfaces as a 404 at the controller so scope
 * mismatches are indistinguishable from missing rows.
 */
export class EndpointNotFoundError extends Error {
  constructor() {
    super('endpoint not found');
    this.name = 'EndpointNotFoundError';
  }
}

/** Public endpoint view for the dashboard (never carries the secret). */
export interface EndpointView {
  readonly id: string;
  readonly provider: WebhookProvider;
  readonly label: string;
  readonly enabled: boolean;
  readonly guildId: string | null;
  readonly createdAt: Date;
}

/**
 * The once-only reveal returned by create/rotate: the public ingress token and
 * the plaintext signing secret. Never returned by any read path.
 */
export interface EndpointReveal extends EndpointView {
  readonly token: string;
  readonly signingSecret: string;
}

/**
 * Dashboard-facing CRUD for inbound endpoints (spec §10, guild-scoped). Secrets
 * are encrypted before persistence and returned in plaintext EXACTLY ONCE on
 * create/rotate; every read view omits them. Rotate/update/delete invalidate the
 * endpoint-by-token cache so a revoked token stops resolving immediately.
 */
@Injectable()
export class WebhookEndpointService {
  constructor(
    private readonly repo: WebhookEndpointRepository,
    private readonly encryption: EncryptionService,
  ) {}

  /** Creates an endpoint and returns the one-time token + secret reveal. */
  async createEndpoint(
    guildId: string,
    createdById: string,
    dto: CreateEndpointInput,
  ): Promise<EndpointReveal> {
    const token = this.generateToken();
    const secret = dto.signingSecret ?? this.generateSecret();

    const record = await this.repo.create({
      provider: dto.provider as WebhookProvider,
      token,
      signingSecret: this.encryption.encrypt(secret),
      label: dto.label,
      guildId,
      createdById,
    });
    return this.toReveal(record, token, secret);
  }

  /** Applies a label/enabled patch (guild-scoped). */
  async updateEndpoint(
    guildId: string,
    id: string,
    dto: UpdateEndpointInput,
  ): Promise<EndpointView> {
    const current = await this.requireOwned(guildId, id);
    const updated = await this.repo.update(
      id,
      { label: dto.label, enabled: dto.enabled },
      current.token,
    );
    if (!updated) throw new EndpointNotFoundError();
    return this.toView(updated);
  }

  /**
   * Rotates the token + signing secret, invalidates the old token's cache entry,
   * and returns a fresh one-time reveal.
   */
  async rotate(guildId: string, id: string): Promise<EndpointReveal> {
    const current = await this.requireOwned(guildId, id);
    const token = this.generateToken();
    const secret = this.generateSecret();

    const updated = await this.repo.rotate(
      id,
      { token, signingSecret: this.encryption.encrypt(secret) },
      current.token,
    );
    if (!updated) throw new EndpointNotFoundError();
    return this.toReveal(updated, token, secret);
  }

  /** Disables an endpoint without deleting it (guild-scoped). */
  async disable(guildId: string, id: string): Promise<EndpointView> {
    const current = await this.requireOwned(guildId, id);
    const updated = await this.repo.update(
      id,
      { enabled: false },
      current.token,
    );
    if (!updated) throw new EndpointNotFoundError();
    return this.toView(updated);
  }

  /** Soft-deletes an endpoint and invalidates its cache entry (guild-scoped). */
  async softDelete(guildId: string, id: string): Promise<void> {
    const current = await this.requireOwned(guildId, id);
    const deleted = await this.repo.softDelete(id, current.token);
    if (!deleted) throw new EndpointNotFoundError();
  }

  /** Paginated endpoint list for a guild (no secret exposed). */
  async list(
    guildId: string,
    page: number,
    pageSize: number,
  ): Promise<PageResult<EndpointView>> {
    const paged = await this.repo.listForGuild(guildId, page, pageSize);
    return {
      items: paged.items.map((r) => this.toView(r)),
      total: paged.total,
      page: paged.page,
      pageSize: paged.pageSize,
    };
  }

  /** Loads an endpoint, asserting the requesting guild owns it. */
  private async requireOwned(
    guildId: string,
    id: string,
  ): Promise<WebhookEndpointRecord> {
    const record = await this.repo.findById(id);
    if (!record || record.guildId !== guildId) {
      throw new EndpointNotFoundError();
    }
    return record;
  }

  private generateToken(): string {
    return randomBytes(TOKEN_BYTES).toString('base64url');
  }

  private generateSecret(): string {
    return randomBytes(SECRET_BYTES).toString('base64');
  }

  private toView(record: WebhookEndpointRecord): EndpointView {
    return {
      id: record.id,
      provider: record.provider,
      label: record.label,
      enabled: record.enabled,
      guildId: record.guildId,
      createdAt: record.createdAt,
    };
  }

  private toReveal(
    record: WebhookEndpointRecord,
    token: string,
    signingSecret: string,
  ): EndpointReveal {
    return { ...this.toView(record), token, signingSecret };
  }
}
