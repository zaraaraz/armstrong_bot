import { z } from 'zod';

/**
 * Zod-validated API configuration. Resolution order is ENV → DB → defaults,
 * consistent with the project Config contract. Secrets (`jwt.secret`,
 * `discordOAuth.clientSecret`) are ENV-only and never read from the DB.
 */
export const apiConfigSchema = z.object({
  port: z.coerce.number().int().positive().default(3000),
  basePath: z.string().default('/api'),
  defaultVersion: z.literal('v1').default('v1'),
  corsOrigins: z.array(z.string().url()).default(['http://localhost:5173']),

  jwt: z.object({
    issuer: z.string().default('ghost-bot'),
    accessTtlSeconds: z.coerce.number().int().positive().default(900), // 15m
    secret: z.string().min(32),
  }),

  session: z.object({
    cookieName: z.string().default('gb_session'),
    ttlSeconds: z.coerce.number().int().positive().default(86_400), // 24h
    secure: z.coerce.boolean().default(true),
  }),

  discordOAuth: z.object({
    clientId: z.string(),
    clientSecret: z.string(),
    redirectUri: z.string().url(),
    scopes: z.array(z.string()).default(['identify', 'guilds']),
  }),

  rateLimit: z.object({
    windowSeconds: z.coerce.number().int().positive().default(60),
    anonymousMax: z.coerce.number().int().positive().default(30),
    userMax: z.coerce.number().int().positive().default(120),
    apiKeyMax: z.coerce.number().int().positive().default(600),
  }),

  pagination: z.object({
    defaultLimit: z.coerce.number().int().positive().max(200).default(25),
    maxLimit: z.coerce.number().int().positive().max(200).default(100),
  }),

  webhooks: z.object({
    enabledProviders: z
      .array(z.enum(['discord', 'github', 'stripe', 'fivem']))
      .default(['discord']),
    maxBodyBytes: z.coerce.number().int().positive().default(1_048_576), // 1 MiB
  }),
});

export type ApiConfig = z.infer<typeof apiConfigSchema>;

/** DI token for the resolved {@link ApiConfig}. */
export const API_CONFIG = Symbol('API_CONFIG');

/**
 * Builds the {@link ApiConfig} from process env, applying schema defaults.
 * Throws if a required secret is missing/too short — fail fast at bootstrap.
 */
export function resolveApiConfig(
  env: NodeJS.ProcessEnv = process.env,
): ApiConfig {
  return apiConfigSchema.parse({
    port: env.HTTP_PORT,
    basePath: env.API_BASE_PATH,
    corsOrigins: parseList(env.API_CORS_ORIGINS),
    jwt: {
      issuer: env.API_JWT_ISSUER,
      accessTtlSeconds: env.API_JWT_TTL_SECONDS,
      secret: env.API_JWT_SECRET ?? devFallbackSecret(env),
    },
    session: {
      cookieName: env.API_SESSION_COOKIE,
      ttlSeconds: env.API_SESSION_TTL_SECONDS,
      secure: env.API_SESSION_SECURE,
    },
    discordOAuth: {
      clientId: env.DISCORD_CLIENT_ID ?? '',
      clientSecret: env.DISCORD_CLIENT_SECRET ?? '',
      redirectUri:
        env.DISCORD_OAUTH_REDIRECT_URI ??
        'http://localhost:3000/api/v1/auth/callback',
      scopes: parseList(env.DISCORD_OAUTH_SCOPES),
    },
    rateLimit: {
      windowSeconds: env.API_RATE_WINDOW_SECONDS,
      anonymousMax: env.API_RATE_ANON_MAX,
      userMax: env.API_RATE_USER_MAX,
      apiKeyMax: env.API_RATE_APIKEY_MAX,
    },
    pagination: {
      defaultLimit: env.API_PAGE_DEFAULT_LIMIT,
      maxLimit: env.API_PAGE_MAX_LIMIT,
    },
    webhooks: {
      enabledProviders: parseList(env.API_WEBHOOK_PROVIDERS),
      maxBodyBytes: env.API_WEBHOOK_MAX_BYTES,
    },
  });
}

function parseList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * In non-production a deterministic dev secret keeps local boot working; in
 * production a missing `API_JWT_SECRET` must fail validation (returns '').
 */
function devFallbackSecret(env: NodeJS.ProcessEnv): string {
  if (env.NODE_ENV === 'production') return '';
  return 'dev-only-insecure-jwt-secret-change-me-32+';
}
