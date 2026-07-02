import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { CacheService } from '../../../cache/cache.service';

/** Row shape returned by the `webhookSubscription` Prisma delegate. */
interface WebhookSubscriptionRow {
  readonly id: string;
  readonly guildId: string;
  readonly eventType: string;
  readonly targetUrl: string;
  readonly signingSecret: string;
  readonly enabled: boolean;
  readonly filter: unknown;
  readonly createdById: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

/** Clean domain view of an outbound subscription (secret stays ciphertext). */
export interface WebhookSubscriptionRecord {
  readonly id: string;
  readonly guildId: string;
  readonly eventType: string;
  readonly targetUrl: string;
  /** Encrypted HMAC signing secret (ciphertext). */
  readonly signingSecret: string;
  readonly enabled: boolean;
  /** Optional JSON filter applied to the event payload, or null. */
  readonly filter: Readonly<Record<string, unknown>> | null;
  readonly createdById: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

/** Input to persist a new outbound subscription. */
export interface CreateWebhookSubscriptionInput {
  readonly guildId: string;
  readonly eventType: string;
  readonly targetUrl: string;
  /** Encrypted HMAC signing secret (ciphertext). */
  readonly signingSecret: string;
  readonly filter: Readonly<Record<string, unknown>> | null;
  readonly createdById: string;
}

/**
 * Prisma-only persistence for {@link WebhookSubscription}. The only file in this
 * module that touches the `webhook_subscriptions` table. All reads scope
 * `deletedAt IS NULL`; deletes are soft (set `deletedAt`).
 */
@Injectable()
export class WebhookSubscriptionRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  private get subscriptions() {
    return this.prisma['webhookSubscription'];
  }

  /** Persists a new outbound subscription. */
  async create(
    input: CreateWebhookSubscriptionInput,
  ): Promise<WebhookSubscriptionRecord> {
    const row = (await this.subscriptions.create({
      data: {
        guildId: input.guildId,
        eventType: input.eventType,
        targetUrl: input.targetUrl,
        signingSecret: input.signingSecret,
        filter: (input.filter ?? undefined) as
          Prisma.InputJsonValue | undefined,
        createdById: input.createdById,
        enabled: true,
      },
    })) as WebhookSubscriptionRow;
    return this.toRecord(row);
  }

  async findById(id: string): Promise<WebhookSubscriptionRecord | null> {
    const row = (await this.subscriptions.findFirst({
      where: { id, deletedAt: null },
    })) as WebhookSubscriptionRow | null;
    return row ? this.toRecord(row) : null;
  }

  /** Every live subscription owned by a guild (newest first). */
  async listForGuild(
    guildId: string,
  ): Promise<readonly WebhookSubscriptionRecord[]> {
    const rows = (await this.subscriptions.findMany({
      where: { guildId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    })) as WebhookSubscriptionRow[];
    return rows.map((r) => this.toRecord(r));
  }

  /**
   * Live, enabled subscriptions across ALL guilds that match a domain event
   * type — the fan-out set for the outbound dispatcher. Kept a plain query
   * (no cache-through) so newly created/disabled subscriptions take effect
   * immediately.
   */
  async findEnabledForEvent(
    eventType: string,
  ): Promise<readonly WebhookSubscriptionRecord[]> {
    const rows = (await this.subscriptions.findMany({
      where: { eventType, enabled: true, deletedAt: null },
    })) as WebhookSubscriptionRow[];
    return rows.map((r) => this.toRecord(r));
  }

  /** Soft-deletes a subscription (sets `deletedAt`). */
  async softDelete(id: string): Promise<boolean> {
    const result = await this.subscriptions.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return result.count > 0;
  }

  private toRecord(row: WebhookSubscriptionRow): WebhookSubscriptionRecord {
    return {
      id: row.id,
      guildId: row.guildId,
      eventType: row.eventType,
      targetUrl: row.targetUrl,
      signingSecret: row.signingSecret,
      enabled: row.enabled,
      filter:
        row.filter && typeof row.filter === 'object'
          ? (row.filter as Readonly<Record<string, unknown>>)
          : null,
      createdById: row.createdById,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    };
  }
}
