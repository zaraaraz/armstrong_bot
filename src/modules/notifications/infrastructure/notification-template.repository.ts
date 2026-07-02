import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

export interface TemplateRow {
  readonly id: string;
  readonly guildId: string | null;
  readonly key: string;
  readonly locale: string;
  readonly subject: string | null;
  readonly body: string;
}

export interface UpsertTemplateInput {
  readonly guildId: string | null;
  readonly key: string;
  readonly locale: string;
  readonly subject: string | null;
  readonly body: string;
}

/**
 * Prisma-only persistence for {@link NotificationTemplate}. The only file in
 * this module that touches the templates table. All reads scope to
 * `deletedAt IS NULL`; the dashboard may opt into archived rows via an explicit
 * flag gated by a permission (see {@link listForGuild}).
 */
@Injectable()
export class NotificationTemplateRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get templates() {
    return this.prisma['notificationTemplate'];
  }

  /**
   * Resolves the best template for (key, locale): a guild override wins over the
   * global default. Returns null when neither exists for that locale.
   */
  async findBest(
    guildId: string | null,
    key: string,
    locale: string,
  ): Promise<TemplateRow | null> {
    // A guild override wins over the global default; match either with an OR
    // (Prisma rejects `null` inside `in`, so express the "guild OR global" set
    // explicitly).
    const rows = (await this.templates.findMany({
      where: {
        key,
        locale,
        deletedAt: null,
        OR:
          guildId === null
            ? [{ guildId: null }]
            : [{ guildId }, { guildId: null }],
      },
    })) as TemplateRow[];
    if (rows.length === 0) return null;
    return rows.find((r) => r.guildId === guildId) ?? rows[0];
  }

  async listForGuild(
    guildId: string | null,
    includeDeleted = false,
  ): Promise<TemplateRow[]> {
    return await this.templates.findMany({
      where: {
        guildId,
        ...(includeDeleted ? {} : { deletedAt: null }),
      },
      orderBy: [{ key: 'asc' }, { locale: 'asc' }],
    });
  }

  async upsert(input: UpsertTemplateInput): Promise<TemplateRow> {
    // MySQL treats NULL guildId as distinct, so the compound unique cannot be
    // used for global templates — find-then-write handles both cases.
    const existing = (await this.templates.findFirst({
      where: {
        guildId: input.guildId,
        key: input.key,
        locale: input.locale,
      },
    })) as TemplateRow | null;

    if (existing) {
      return await this.templates.update({
        where: { id: existing.id },
        data: {
          subject: input.subject,
          body: input.body,
          deletedAt: null,
        },
      });
    }
    return await this.templates.create({
      data: {
        guildId: input.guildId,
        key: input.key,
        locale: input.locale,
        subject: input.subject,
        body: input.body,
      },
    });
  }

  async softDelete(id: string): Promise<void> {
    await this.templates.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
