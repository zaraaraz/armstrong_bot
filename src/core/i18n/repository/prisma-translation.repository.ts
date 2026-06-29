import { Injectable } from '@nestjs/common';
import type { PrismaService } from '../../../database/prisma.service';
import type { Locale } from '../contracts/translation-context';
import { TranslationRepository } from './translation.repository';
import type { TranslationRecord } from './translation.repository';

@Injectable()
export class PrismaTranslationRepository implements TranslationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findBundle(
    locale: Locale,
    namespace: string,
    guildId: string | null,
  ): Promise<readonly TranslationRecord[]> {
    const rows = await this.prisma['translation'].findMany({
      where: { locale, namespace, guildId, deletedAt: null },
    });
    return rows.map(toRecord);
  }

  async upsert(
    record: Omit<TranslationRecord, 'id' | 'updatedAt'>,
  ): Promise<TranslationRecord> {
    const existing = await this.prisma['translation'].findFirst({
      where: {
        guildId: record.guildId,
        locale: record.locale,
        module: record.module,
        namespace: record.namespace,
        key: record.key,
        deletedAt: null,
      },
    });

    const row = existing
      ? await this.prisma['translation'].update({
          where: { id: (existing as { id: string }).id },
          data: {
            value: record.value,
            updatedBy: record.updatedBy,
            deletedAt: null,
          },
        })
      : await this.prisma['translation'].create({
          data: {
            guildId: record.guildId,
            locale: record.locale,
            module: record.module,
            namespace: record.namespace,
            key: record.key,
            value: record.value,
            updatedBy: record.updatedBy,
          },
        });

    return toRecord(row);
  }

  async softDelete(id: string, deletedBy: string): Promise<void> {
    void deletedBy;
    await this.prisma['translation'].update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async listLocales(): Promise<readonly Locale[]> {
    const rows = await this.prisma['locale'].findMany({
      where: { enabled: true, deletedAt: null },
    });
    return rows.map((r: { code: string }) => r.code);
  }

  async search(query: {
    guildId: string | null;
    locale?: Locale;
    namespace?: string;
    contains?: string;
    skip: number;
    take: number;
  }): Promise<{ items: readonly TranslationRecord[]; total: number }> {
    const where: Record<string, unknown> = { deletedAt: null };
    if (query.guildId !== undefined) where['guildId'] = query.guildId;
    if (query.locale) where['locale'] = query.locale;
    if (query.namespace) where['namespace'] = query.namespace;
    if (query.contains) where['value'] = { contains: query.contains };

    const [rows, total] = await Promise.all([
      this.prisma['translation'].findMany({
        where,
        skip: query.skip,
        take: query.take,
      }),
      this.prisma['translation'].count({ where }),
    ]);

    return { items: rows.map(toRecord), total };
  }

  async softDeleteByGuild(guildId: string): Promise<void> {
    await this.prisma['translation'].updateMany({
      where: { guildId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }
}

function toRecord(row: Record<string, unknown>): TranslationRecord {
  return {
    id: row['id'] as string,
    guildId: row['guildId'] as string | null,
    locale: row['locale'] as string,
    module: row['module'] as string,
    namespace: row['namespace'] as string,
    key: row['key'] as string,
    value: row['value'] as string,
    updatedBy: row['updatedBy'] as string | null,
    updatedAt: row['updatedAt'] as Date,
  };
}
