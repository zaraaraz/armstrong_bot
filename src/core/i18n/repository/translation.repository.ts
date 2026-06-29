import type { Locale } from '../contracts/translation-context';

export interface TranslationRecord {
  readonly id: string;
  readonly guildId: string | null;
  readonly locale: Locale;
  readonly module: string;
  readonly namespace: string;
  readonly key: string;
  readonly value: string;
  readonly updatedBy: string | null;
  readonly updatedAt: Date;
}

export abstract class TranslationRepository {
  abstract findBundle(
    locale: Locale,
    namespace: string,
    guildId: string | null,
  ): Promise<readonly TranslationRecord[]>;

  abstract upsert(
    record: Omit<TranslationRecord, 'id' | 'updatedAt'>,
  ): Promise<TranslationRecord>;

  abstract softDelete(id: string, deletedBy: string): Promise<void>;

  abstract listLocales(): Promise<readonly Locale[]>;

  abstract search(query: {
    guildId: string | null;
    locale?: Locale;
    namespace?: string;
    contains?: string;
    skip: number;
    take: number;
  }): Promise<{ items: readonly TranslationRecord[]; total: number }>;

  abstract softDeleteByGuild(guildId: string): Promise<void>;
}
