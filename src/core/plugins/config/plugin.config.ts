import { z } from 'zod';

export const PluginSystemConfigSchema = z.object({
  pluginsDir: z.string().default('./plugins'),
  allowUnsigned: z.boolean().default(false),
  verifyChecksum: z.boolean().default(true),
  maxPluginsPerGuild: z.number().int().positive().default(50),
  sdkVersion: z.string().default('1.0.0'),
  hookTimeoutMs: z.number().int().positive().default(15_000),
  errorThreshold: z.number().int().positive().default(5),
});

export type PluginSystemConfig = z.infer<typeof PluginSystemConfigSchema>;

export const StoredPluginConfigSchema = z.object({
  pluginName: z.string(),
  guildId: z.string().nullable(),
  values: z.record(z.string(), z.unknown()),
});
export type StoredPluginConfig = z.infer<typeof StoredPluginConfigSchema>;
