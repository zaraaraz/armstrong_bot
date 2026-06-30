import { z } from 'zod';

export const PluginManifestSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/, 'Must be kebab-case'),
  version: z.string().regex(/^\d+\.\d+\.\d+/, 'Must be semver'),
  displayName: z.string().min(1),
  description: z.string().min(1),
  author: z.string().min(1),
  scope: z.enum(['guild', 'global']),
  sdkRange: z.string().min(1),
  dependencies: z.array(
    z.object({
      name: z.string().min(1),
      range: z.string().min(1),
      required: z.boolean().optional(),
    }),
  ),
  permissions: z.array(
    z.object({
      claim: z.string().min(1),
      description: z.string().min(1),
    }),
  ),
  services: z.array(z.string()),
  configSchema: z.any(),
  i18nNamespaces: z.array(z.string()),
  checksum: z.string().optional(),
});
