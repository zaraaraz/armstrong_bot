import { z } from 'zod';

export const createApiKeySchema = z.object({
  name: z.string().min(3).max(64),
  scopes: z.array(z.string().regex(/^[a-z0-9.*_-]+$/)).min(1),
  expiresAt: z.string().datetime().nullable().default(null),
});
export type CreateApiKeyDto = z.infer<typeof createApiKeySchema>;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type PaginationDto = z.infer<typeof paginationSchema>;

export const toggleModuleSchema = z.object({ enabled: z.boolean() });
export type ToggleModuleDto = z.infer<typeof toggleModuleSchema>;
