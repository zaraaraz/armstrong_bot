import { z } from 'zod';

export const UpsertTranslationSchema = z.object({
  guildId: z.string().nullable(),
  locale: z.string().min(2),
  module: z.string().min(1),
  namespace: z.string().min(1),
  key: z.string().min(1),
  value: z.string().min(1),
});

export type UpsertTranslationDto = z.infer<typeof UpsertTranslationSchema>;
