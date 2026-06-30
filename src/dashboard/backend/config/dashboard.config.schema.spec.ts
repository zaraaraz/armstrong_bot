import {
  resolveDashboardConfig,
  resolveDashboardGuildConfig,
} from './dashboard.config.schema';

describe('resolveDashboardConfig', () => {
  it('applies defaults from a minimal env', () => {
    const cfg = resolveDashboardConfig({
      DASHBOARD_BASE_URL: 'https://dash.test',
      DISCORD_CLIENT_ID: 'c',
      DISCORD_CLIENT_SECRET: 's',
    });
    expect(cfg.session.cookieName).toBe('ghost_dash_sid');
    expect(cfg.session.ttlSeconds).toBe(60 * 60 * 12);
    expect(cfg.oauth.redirectUri).toBe(
      'https://dash.test/api/dashboard/auth/callback',
    );
    expect(cfg.realtime.ticketTtlSeconds).toBe(30);
  });

  it('parses custom OAuth scopes from CSV', () => {
    const cfg = resolveDashboardConfig({
      DASHBOARD_BASE_URL: 'https://dash.test',
      DISCORD_CLIENT_ID: 'c',
      DISCORD_CLIENT_SECRET: 's',
      DISCORD_OAUTH_SCOPES: 'identify,guilds,email',
    });
    expect(cfg.oauth.scopes).toEqual(['identify', 'guilds', 'email']);
  });
});

describe('resolveDashboardGuildConfig', () => {
  it('applies guild defaults', () => {
    const cfg = resolveDashboardGuildConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.maxApiKeys).toBe(20);
    expect(cfg.logRetentionDays).toBe(30);
  });

  it('accepts overrides', () => {
    const cfg = resolveDashboardGuildConfig({
      maxApiKeys: 5,
      backupsEnabled: false,
    });
    expect(cfg.maxApiKeys).toBe(5);
    expect(cfg.backupsEnabled).toBe(false);
  });
});
