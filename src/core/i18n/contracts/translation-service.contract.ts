import type {
  InterpolationValues,
  Locale,
  ResolvedLocale,
  TranslationContext,
} from './translation-context';
import type { TranslationKey } from './translation-key';

export abstract class TranslationService {
  abstract t(
    key: TranslationKey,
    values?: InterpolationValues,
    context?: TranslationContext,
  ): Promise<string>;
  abstract tSync(
    key: TranslationKey,
    values: InterpolationValues | undefined,
    locale: Locale,
  ): string;
  abstract resolveLocale(context: TranslationContext): Promise<ResolvedLocale>;
  abstract listLocales(): Promise<readonly Locale[]>;
  abstract has(key: TranslationKey, locale: Locale): Promise<boolean>;
  abstract invalidate(namespace: string, locale?: Locale): Promise<void>;
}
