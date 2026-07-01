import { z } from 'zod';
import { envBoolean } from '../../../shared/config/env-boolean';

/** Global (ENV-sourced) dashboard configuration. */
export const dashboardGlobalConfigSchema = z.object({
  baseUrl: z.string().url(),
  frontendOrigin: z.string().url(),
  oauth: z.object({
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
    redirectUri: z.string().url(),
    scopes: z.array(z.string()).default(['identify', 'guilds']),
  }),
  session: z.object({
    ttlSeconds: z.coerce
      .number()
      .int()
      .positive()
      .default(60 * 60 * 12), // 12h
    cookieName: z.string().default('ghost_dash_sid'),
    sameSite: z.enum(['lax', 'strict', 'none']).default('lax'),
    secure: envBoolean(true),
  }),
  realtime: z.object({
    ticketTtlSeconds: z.coerce.number().int().positive().default(30),
    maxConnectionsPerUser: z.coerce.number().int().positive().default(5),
  }),
});

/** Per-guild dashboard configuration (DB-overridable). */
export const dashboardGuildConfigSchema = z.object({
  enabled: z.boolean().default(true),
  logRetentionDays: z.number().int().min(1).max(365).default(30),
  analyticsEnabled: z.boolean().default(true),
  allowApiKeys: z.boolean().default(true),
  maxApiKeys: z.number().int().min(0).max(100).default(20),
  backupsEnabled: z.boolean().default(true),
});

export type DashboardGlobalConfig = z.infer<typeof dashboardGlobalConfigSchema>;
export type DashboardGuildConfig = z.infer<typeof dashboardGuildConfigSchema>;

export const DASHBOARD_CONFIG = Symbol('DASHBOARD_CONFIG');

/** Resolves the global dashboard config from env (secrets ENV-only). */
export function resolveDashboardConfig(
  env: NodeJS.ProcessEnv = process.env,
): DashboardGlobalConfig {
  const base = env.DASHBOARD_BASE_URL ?? 'http://localhost:3000';
  return dashboardGlobalConfigSchema.parse({
    baseUrl: base,
    frontendOrigin: env.DASHBOARD_FRONTEND_ORIGIN ?? 'http://localhost:5173',
    oauth: {
      clientId: env.DISCORD_CLIENT_ID ?? 'dev-client-id',
      clientSecret: env.DISCORD_CLIENT_SECRET ?? 'dev-client-secret',
      redirectUri:
        env.DASHBOARD_OAUTH_REDIRECT_URI ??
        `${base}/api/dashboard/auth/callback`,
      scopes: splitList(env.DISCORD_OAUTH_SCOPES),
    },
    session: {
      ttlSeconds: env.DASHBOARD_SESSION_TTL_SECONDS,
      cookieName: env.DASHBOARD_SESSION_COOKIE,
      sameSite: env.DASHBOARD_SESSION_SAMESITE,
      secure: env.DASHBOARD_SESSION_SECURE,
    },
    realtime: {
      ticketTtlSeconds: env.DASHBOARD_TICKET_TTL_SECONDS,
      maxConnectionsPerUser: env.DASHBOARD_MAX_WS_PER_USER,
    },
  });
}

export function resolveDashboardGuildConfig(
  input: unknown = {},
): DashboardGuildConfig {
  return dashboardGuildConfigSchema.parse(input ?? {});
}

function splitList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
