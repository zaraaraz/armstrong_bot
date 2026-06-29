import { z } from 'zod';

export const TranslationQuerySchema = z.object({
  guildId: z.string().nullable().optional(),
  locale: z.string().min(2).optional(),
  namespace: z.string().optional(),
  contains: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type TranslationQueryDto = z.infer<typeof TranslationQuerySchema>;
