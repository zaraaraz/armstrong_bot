export type TranslationKey = string & { readonly __brand: 'TranslationKey' };

export interface ParsedKey {
  readonly module: string;
  readonly namespace: string;
  readonly path: string;
}

const KEY_PATTERN = /^([a-z0-9_-]+):([a-z0-9_-]+)\.(.+)$/i;

export function parseKey(key: TranslationKey): ParsedKey {
  const match = KEY_PATTERN.exec(key);
  if (!match)
    throw new Error(
      `Invalid TranslationKey format: "${key}". Expected "module:namespace.path"`,
    );
  return { module: match[1], namespace: match[2], path: match[3] };
}

export function isTranslationKey(value: string): value is TranslationKey {
  return KEY_PATTERN.test(value);
}

export function toTranslationKey(value: string): TranslationKey {
  if (!isTranslationKey(value))
    throw new Error(`Invalid TranslationKey: "${value}"`);
  return value;
}
