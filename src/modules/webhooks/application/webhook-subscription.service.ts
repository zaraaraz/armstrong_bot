import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { EncryptionService } from '../../../shared/security/services/encryption.service';
import type { CreateSubscriptionInput } from '../dto/create-subscription.dto';
import { WebhooksConfigService } from '../config/webhooks-config.service';
import {
  WebhookSubscriptionRepository,
  type WebhookSubscriptionRecord,
} from '../repositories/webhook-subscription.repository';

/** Bytes of entropy for a generated outbound signing secret (base64-encoded). */
const SECRET_BYTES = 32;

/** Thrown when an outbound subscription targets a non-allowlisted event. */
export class EventTypeNotAllowedError extends Error {
  constructor(eventType: string) {
    super(`event type not allowed for outbound subscription: ${eventType}`);
    this.name = 'EventTypeNotAllowedError';
  }
}

/**
 * Thrown when a guild-scoped mutation targets a subscription the guild does not
 * own (or that does not exist). Surfaces as a 404 at the controller.
 */
export class SubscriptionNotFoundError extends Error {
  constructor() {
    super('subscription not found');
    this.name = 'SubscriptionNotFoundError';
  }
}

/** Public subscription view for the dashboard (never carries the secret). */
export interface SubscriptionView {
  readonly id: string;
  readonly guildId: string;
  readonly eventType: string;
  readonly targetUrl: string;
  readonly enabled: boolean;
  readonly filter: Readonly<Record<string, unknown>> | null;
  readonly createdAt: Date;
}

/**
 * Dashboard-facing management for outbound subscriptions (spec §10,
 * guild-scoped). Validates the event type against the configured outbound
 * allowlist, encrypts the signing secret before persistence (generating one when
 * omitted), and returns views that never expose the secret.
 */
@Injectable()
export class WebhookSubscriptionService {
  constructor(
    private readonly repo: WebhookSubscriptionRepository,
    private readonly encryption: EncryptionService,
    private readonly config: WebhooksConfigService,
  ) {}

  /** Creates a subscription after allowlist validation. */
  async create(
    guildId: string,
    createdById: string,
    dto: CreateSubscriptionInput,
  ): Promise<SubscriptionView> {
    const allowed = this.config.global().outbound.allowedOutboundEvents;
    if (!allowed.includes(dto.eventType)) {
      throw new EventTypeNotAllowedError(dto.eventType);
    }

    const secret = dto.signingSecret ?? this.generateSecret();
    const record = await this.repo.create({
      guildId,
      eventType: dto.eventType,
      targetUrl: dto.targetUrl,
      signingSecret: this.encryption.encrypt(secret),
      filter: dto.filter ?? null,
      createdById,
    });
    return this.toView(record);
  }

  /** Live subscriptions owned by a guild (no secret exposed). */
  async list(guildId: string): Promise<readonly SubscriptionView[]> {
    const records = await this.repo.listForGuild(guildId);
    return records.map((r) => this.toView(r));
  }

  /** Soft-deletes a subscription (guild-scoped). */
  async remove(guildId: string, id: string): Promise<void> {
    await this.requireOwned(guildId, id);
    const deleted = await this.repo.softDelete(id);
    if (!deleted) throw new SubscriptionNotFoundError();
  }

  /** Loads a subscription, asserting the requesting guild owns it. */
  private async requireOwned(
    guildId: string,
    id: string,
  ): Promise<WebhookSubscriptionRecord> {
    const record = await this.repo.findById(id);
    if (!record || record.guildId !== guildId) {
      throw new SubscriptionNotFoundError();
    }
    return record;
  }

  private generateSecret(): string {
    return randomBytes(SECRET_BYTES).toString('base64');
  }

  private toView(record: WebhookSubscriptionRecord): SubscriptionView {
    return {
      id: record.id,
      guildId: record.guildId,
      eventType: record.eventType,
      targetUrl: record.targetUrl,
      enabled: record.enabled,
      filter: record.filter,
      createdAt: record.createdAt,
    };
  }
}
