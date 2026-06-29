import { z } from 'zod';

export const I18nConfigSchema = z.object({
  defaultLocale: z.string().min(2).default('pt'),
  fallbackLocale: z.string().min(2).default('en'),
  cacheTtlSeconds: z.number().int().positive().default(3600),
  missingKeyPolicy: z
    .enum(['return-key', 'return-fallback', 'return-empty'])
    .default('return-key'),
  reportMissingKeys: z.boolean().default(true),
  enabledLocales: z.array(z.string().min(2)).default(['pt', 'en']),
});

export type I18nConfig = z.infer<typeof I18nConfigSchema>;
