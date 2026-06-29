import { z } from 'zod';

/**
 * Global security configuration. Resolution follows the project contract:
 * ENV → Database → Defaults.
 */
export const SecurityConfigSchema = z.object({
  rateLimit: z.object({
    commands: z.object({
      points: z.number().int().positive().default(20),
      duration: z.number().int().positive().default(60),
    }),
    api: z.object({
      points: z.number().int().positive().default(120),
      duration: z.number().int().positive().default(60),
    }),
  }),
  encryption: z.object({
    /** ENV var holding the 32-byte base64 master key. */
    masterKeyEnv: z.string().default('GHOST_MASTER_KEY'),
    rotationDays: z.number().int().positive().default(90),
  }),
  session: z.object({
    secureCookies: z.boolean().default(true),
    sameSite: z.enum(['strict', 'lax']).default('lax'),
    maxAgeHours: z.number().int().positive().default(168),
  }),
  cors: z.object({
    origins: z.array(z.string().url()).default([]),
  }),
});

export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;

/** Parse a partial/empty input into a fully-defaulted SecurityConfig. */
export function resolveSecurityConfig(input: unknown = {}): SecurityConfig {
  return SecurityConfigSchema.parse(input ?? {});
}
