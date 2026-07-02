import { beforeEach, describe, expect, it } from 'vitest';
import { PreferenceResolver } from './preference-resolver.service';
import type { CacheService } from '../../../cache/cache.service';
import type { NotificationsConfigService } from '../config/notifications-config.service';
import type { NotificationsGuildConfig } from '../config/notifications.config';
import type {
  NotificationPreferenceRepository,
  PreferenceRow,
} from '../infrastructure/notification-preference.repository';

class FakePrefRepo {
  rows: PreferenceRow[] = [];
  findForUser(): Promise<PreferenceRow[]> {
    return Promise.resolve(this.rows);
  }
}

const noCache = {
  getOrSet: <T>(_k: string, loader: () => Promise<T>) => loader(),
  delete: () => Promise.resolve(),
  keys: { forGuild: (...p: string[]) => p.join(':') },
} as unknown as CacheService;

function makeConfig(
  guild: Partial<NotificationsGuildConfig>,
): NotificationsConfigService {
  const full: NotificationsGuildConfig = {
    enabledChannels: ['DISCORD_CHANNEL'],
    announceChannelId: null,
    staffChannelId: null,
    quietHours: {
      enabled: false,
      startHour: 23,
      endHour: 7,
      timezone: 'Europe/Lisbon',
    },
    digest: { enabled: false, cron: '0 9 * * *' },
    ...guild,
  };
  return {
    global: () => ({ preferenceCacheTtlSeconds: 0 }),
    forGuild: () => Promise.resolve(full),
  } as unknown as NotificationsConfigService;
}

function makeResolver(
  repo: FakePrefRepo,
  guild: Partial<NotificationsGuildConfig>,
): PreferenceResolver {
  return new PreferenceResolver(
    repo as unknown as NotificationPreferenceRepository,
    noCache,
    makeConfig(guild),
  );
}

describe('PreferenceResolver.resolve', () => {
  let repo: FakePrefRepo;

  beforeEach(() => {
    repo = new FakePrefRepo();
  });

  it('starts from the guild enabled channels', async () => {
    const resolver = makeResolver(repo, {
      enabledChannels: ['DISCORD_CHANNEL', 'EMAIL'],
    });
    const decisions = await resolver.resolve({
      guildId: 'g1',
      userId: 'u1',
      category: 'system',
      priority: 'normal',
    });
    expect(decisions.map((d) => d.channel)).toEqual([
      'DISCORD_CHANNEL',
      'EMAIL',
    ]);
    expect(decisions.every((d) => d.allowed)).toBe(true);
  });

  it('forced channels win over the guild config', async () => {
    const resolver = makeResolver(repo, {
      enabledChannels: ['DISCORD_CHANNEL'],
    });
    const decisions = await resolver.resolve({
      guildId: 'g1',
      category: 'system',
      priority: 'normal',
      forcedChannels: ['EMAIL', 'PUSH'],
    });
    expect(decisions.map((d) => d.channel)).toEqual(['EMAIL', 'PUSH']);
  });

  it('drops a channel the user has explicitly disabled', async () => {
    repo.rows = [
      {
        id: 'p',
        guildId: 'g1',
        userId: 'u1',
        category: 'system',
        channel: 'DISCORD_CHANNEL',
        enabled: false,
      },
    ];
    const resolver = makeResolver(repo, {
      enabledChannels: ['DISCORD_CHANNEL'],
    });
    const [decision] = await resolver.resolve({
      guildId: 'g1',
      userId: 'u1',
      category: 'system',
      priority: 'normal',
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('user-disabled');
  });

  it('defers non-critical channels during quiet hours', async () => {
    const resolver = makeResolver(repo, {
      enabledChannels: ['DISCORD_CHANNEL'],
      quietHours: {
        enabled: true,
        startHour: 0,
        endHour: 23,
        timezone: 'UTC',
      },
    });
    // 12:00 UTC is inside [0, 23).
    const now = new Date('2026-07-02T12:00:00Z');
    const [decision] = await resolver.resolve({
      guildId: 'g1',
      category: 'system',
      priority: 'normal',
      now,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('quiet-hours');
  });

  it('critical priority bypasses quiet hours', async () => {
    const resolver = makeResolver(repo, {
      enabledChannels: ['DISCORD_CHANNEL'],
      quietHours: { enabled: true, startHour: 0, endHour: 23, timezone: 'UTC' },
    });
    const now = new Date('2026-07-02T12:00:00Z');
    const [decision] = await resolver.resolve({
      guildId: 'g1',
      category: 'system',
      priority: 'critical',
      now,
    });
    expect(decision.allowed).toBe(true);
  });
});

describe('PreferenceResolver.inQuietHours', () => {
  const resolver = makeResolver(new FakePrefRepo(), {});

  const cfg = (
    over: Partial<NotificationsGuildConfig['quietHours']>,
  ): NotificationsGuildConfig =>
    ({
      quietHours: {
        enabled: true,
        startHour: 23,
        endHour: 7,
        timezone: 'UTC',
        ...over,
      },
    }) as NotificationsGuildConfig;

  it('handles a window that wraps midnight (23 -> 7)', () => {
    // 02:00 UTC is inside the 23->7 window.
    expect(
      resolver.inQuietHours(cfg({}), new Date('2026-07-02T02:00:00Z')),
    ).toBe(true);
    // 12:00 UTC is outside.
    expect(
      resolver.inQuietHours(cfg({}), new Date('2026-07-02T12:00:00Z')),
    ).toBe(false);
  });

  it('handles a same-day window (1 -> 6)', () => {
    const c = cfg({ startHour: 1, endHour: 6 });
    expect(resolver.inQuietHours(c, new Date('2026-07-02T03:00:00Z'))).toBe(
      true,
    );
    expect(resolver.inQuietHours(c, new Date('2026-07-02T08:00:00Z'))).toBe(
      false,
    );
  });

  it('respects the configured timezone', () => {
    // 23:00 UTC == 00:00 Europe/Lisbon (summer, UTC+1) -> inside a 23->7 window
    // computed in Lisbon local time.
    const c = cfg({ timezone: 'Europe/Lisbon' });
    expect(resolver.inQuietHours(c, new Date('2026-07-02T23:00:00Z'))).toBe(
      true,
    );
  });

  it('is never active when disabled', () => {
    expect(resolver.inQuietHours(cfg({ enabled: false }), new Date())).toBe(
      false,
    );
  });
});
