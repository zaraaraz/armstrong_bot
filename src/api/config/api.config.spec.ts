import { resolveApiConfig } from './api.config';

describe('resolveApiConfig', () => {
  it('applies defaults in a dev environment', () => {
    const cfg = resolveApiConfig({
      NODE_ENV: 'development',
      DISCORD_CLIENT_ID: 'c',
      DISCORD_CLIENT_SECRET: 's',
    });
    expect(cfg.defaultVersion).toBe('v1');
    expect(cfg.pagination.maxLimit).toBe(100);
    expect(cfg.jwt.secret.length).toBeGreaterThanOrEqual(32);
    expect(cfg.rateLimit.apiKeyMax).toBe(600);
  });

  it('parses CORS origins and webhook providers from CSV', () => {
    const cfg = resolveApiConfig({
      NODE_ENV: 'development',
      DISCORD_CLIENT_ID: 'c',
      DISCORD_CLIENT_SECRET: 's',
      API_CORS_ORIGINS: 'https://a.test,https://b.test',
      API_WEBHOOK_PROVIDERS: 'discord,github',
    });
    expect(cfg.corsOrigins).toEqual(['https://a.test', 'https://b.test']);
    expect(cfg.webhooks.enabledProviders).toEqual(['discord', 'github']);
  });

  it('fails in production when the JWT secret is missing', () => {
    expect(() =>
      resolveApiConfig({
        NODE_ENV: 'production',
        DISCORD_CLIENT_ID: 'c',
        DISCORD_CLIENT_SECRET: 's',
        DISCORD_OAUTH_REDIRECT_URI: 'https://x.test/cb',
      }),
    ).toThrow();
  });
});
