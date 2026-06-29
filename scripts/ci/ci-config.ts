import { z } from 'zod';

export const ciConfigSchema = z.object({
  NODE_ENV: z.enum(['test', 'staging', 'production']).default('test'),
  DEPLOY_ENVIRONMENT: z.enum(['staging', 'production']),
  IMAGE_REGISTRY: z.string().default('ghcr.io/armstrong-bot'),
  IMAGE_TAG: z.string().min(1),
  PREVIOUS_IMAGE_TAG: z.string().min(1).nullable().default(null),
  DATABASE_URL: z.string().url(),
  DEPLOY_HOST: z.string().min(1),
  HEALTH_URL: z.string().url(),
  HEALTH_MAX_ATTEMPTS: z.coerce.number().int().positive().default(30),
  HEALTH_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  NOTIFY_INGRESS_URL: z.string().url(),
  NOTIFY_INGRESS_TOKEN: z.string().min(1),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
});

export type CiConfig = z.infer<typeof ciConfigSchema>;

export function loadCiConfig(env: NodeJS.ProcessEnv): CiConfig {
  return ciConfigSchema.parse(env);
}
