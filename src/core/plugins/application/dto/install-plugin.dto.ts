import { z } from 'zod';

export const InstallPluginSchema = z.object({
  source: z.string().min(1),
  scope: z.enum(['guild', 'global']),
  guildId: z.string().nullable(),
});
export type InstallPluginDto = z.infer<typeof InstallPluginSchema>;

export const UpdatePluginStateSchema = z.object({
  enabled: z.boolean(),
  guildId: z.string().nullable(),
  actorId: z.string(),
});
export type UpdatePluginStateDto = z.infer<typeof UpdatePluginStateSchema>;

export const UpdatePluginConfigSchema = z.object({
  values: z.record(z.string(), z.unknown()),
  guildId: z.string().nullable(),
});
export type UpdatePluginConfigDto = z.infer<typeof UpdatePluginConfigSchema>;

export const ListPluginsQuerySchema = z.object({
  status: z
    .enum([
      'INSTALLED',
      'ENABLED',
      'DISABLED',
      'ERRORED',
      'UPDATING',
      'REMOVED',
    ])
    .optional(),
  guildId: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});
export type ListPluginsQuery = z.infer<typeof ListPluginsQuerySchema>;
