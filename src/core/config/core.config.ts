import { z } from 'zod';

export const coreConfigSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_DEV_GUILD_ID: z.string().optional(),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  BOOTSTRAP_FAIL_FAST: z.coerce.boolean().default(true),
  HEALTH_READY_GRACE_MS: z.coerce.number().int().nonnegative().default(5_000),
  EVENT_BUS_DRIVER: z
    .enum(['in-process', 'distributed'])
    .default('distributed'),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  HTTP_PORT: z.coerce.number().int().positive().default(3000),
});

export type CoreConfig = z.infer<typeof coreConfigSchema>;
