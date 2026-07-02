import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

export type IntegrationProviderName = 'TWITCH' | 'YOUTUBE' | 'GITHUB';

export interface IntegrationSubscriptionRecord {
  readonly id: string;
  readonly guildId: string;
  readonly provider: IntegrationProviderName;
  readonly externalId: string;
  readonly announceChannelId: string | null;
  readonly cursor: string | null;
  readonly active: boolean;
}

export interface CreateSubscriptionInput {
  readonly guildId: string;
  readonly provider: IntegrationProviderName;
  readonly externalId: string;
  readonly announceChannelId: string | null;
}

interface SubscriptionRow {
  readonly id: string;
  readonly guildId: string;
  readonly provider: string;
  readonly externalId: string;
  readonly announceChannelId: string | null;
  readonly cursor: string | null;
  readonly active: boolean;
}

/**
 * Prisma-only persistence for {@link IntegrationSubscription}. The only file in
 * this module that touches that table. Reads scope to `deletedAt IS NULL`.
 */
@Injectable()
export class IntegrationSubscriptionRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get subs() {
    return this.prisma['integrationSubscription'];
  }

  async create(
    input: CreateSubscriptionInput,
  ): Promise<IntegrationSubscriptionRecord> {
    const row = (await this.subs.upsert({
      where: {
        guildId_provider_externalId: {
          guildId: input.guildId,
          provider: input.provider,
          externalId: input.externalId,
        },
      },
      create: {
        guildId: input.guildId,
        provider: input.provider,
        externalId: input.externalId,
        announceChannelId: input.announceChannelId,
      },
      update: {
        announceChannelId: input.announceChannelId,
        active: true,
        deletedAt: null,
      },
    })) as SubscriptionRow;
    return this.toRecord(row);
  }

  async listForGuild(
    guildId: string,
  ): Promise<IntegrationSubscriptionRecord[]> {
    return (
      (await this.subs.findMany({
        where: { guildId, deletedAt: null },
        orderBy: [{ provider: 'asc' }, { externalId: 'asc' }],
      })) as SubscriptionRow[]
    ).map((r) => this.toRecord(r));
  }

  /** All active subscriptions for a provider (used by the poller). */
  async listActiveByProvider(
    provider: IntegrationProviderName,
  ): Promise<IntegrationSubscriptionRecord[]> {
    return (
      (await this.subs.findMany({
        where: {
          provider: provider,
          active: true,
          deletedAt: null,
        },
      })) as SubscriptionRow[]
    ).map((r) => this.toRecord(r));
  }

  async findById(id: string): Promise<IntegrationSubscriptionRecord | null> {
    const row = (await this.subs.findFirst({
      where: { id, deletedAt: null },
    })) as SubscriptionRow | null;
    return row ? this.toRecord(row) : null;
  }

  /** Advances the last-seen cursor after fanning out an upstream event. */
  async setCursor(id: string, cursor: string): Promise<void> {
    await this.subs.update({ where: { id }, data: { cursor } });
  }

  async softDelete(id: string): Promise<void> {
    await this.subs.update({
      where: { id },
      data: { deletedAt: new Date(), active: false },
    });
  }

  private toRecord(row: SubscriptionRow): IntegrationSubscriptionRecord {
    return {
      id: row.id,
      guildId: row.guildId,
      provider: row.provider as IntegrationProviderName,
      externalId: row.externalId,
      announceChannelId: row.announceChannelId,
      cursor: row.cursor,
      active: row.active,
    };
  }
}
