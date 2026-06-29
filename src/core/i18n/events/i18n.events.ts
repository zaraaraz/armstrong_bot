import type { Locale } from '../contracts/translation-context';

export const I18N_EVENTS = {
  TranslationUpdated: 'i18n.translation.updated',
  TranslationDeleted: 'i18n.translation.deleted',
  MissingKeyDetected: 'i18n.missingKey.detected',
  LocaleAdded: 'i18n.locale.added',
} as const;

export interface TranslationUpdatedPayload {
  guildId: string | null;
  locale: Locale;
  module: string;
  namespace: string;
  key: string;
  updatedBy: string;
}

export interface TranslationDeletedPayload {
  id: string;
  guildId: string | null;
  locale: Locale;
  namespace: string;
  deletedBy: string;
}

export interface MissingKeyPayload {
  key: string;
  locale: Locale;
  chainTried: readonly Locale[];
  guildId: string | null;
  occurredAt: string;
}

export interface LocaleAddedPayload {
  locale: Locale;
  addedBy: string;
}
