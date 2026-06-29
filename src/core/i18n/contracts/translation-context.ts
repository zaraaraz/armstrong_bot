export type Locale = string;

export interface TranslationContext {
  readonly guildId?: string;
  readonly userId?: string;
  readonly localeOverride?: Locale;
}

export interface ResolvedLocale {
  readonly primary: Locale;
  readonly chain: readonly Locale[];
  readonly source: 'override' | 'user' | 'guild' | 'default';
}

export type InterpolationValues = Readonly<
  Record<string, string | number | boolean | Date>
>;
