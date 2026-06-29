import { Injectable } from '@nestjs/common';
import type {
  Locale,
  ResolvedLocale,
  TranslationContext,
} from '../contracts/translation-context';

@Injectable()
export class LocaleResolver {
  /**
   * Pure, stateless resolver. Returns the full fallback chain for a context.
   * Priority: localeOverride → user → guild → defaultLocale → fallbackLocale
   */
  resolve(
    context: TranslationContext,
    guildLocale: Locale | undefined,
    userLocale: Locale | undefined,
    defaultLocale: Locale,
    fallbackLocale: Locale,
  ): ResolvedLocale {
    const seen = new Set<Locale>();
    const chain: Locale[] = [];
    let source: ResolvedLocale['source'] = 'default';

    const push = (locale: Locale | undefined) => {
      if (locale && !seen.has(locale)) {
        seen.add(locale);
        chain.push(locale);
      }
    };

    if (context.localeOverride) {
      push(context.localeOverride);
      source = 'override';
    } else if (userLocale) {
      push(userLocale);
      source = 'user';
    } else if (guildLocale) {
      push(guildLocale);
      source = 'guild';
    }

    push(defaultLocale);
    push(fallbackLocale);

    return { primary: chain[0] ?? defaultLocale, chain, source };
  }
}
