import { GuildAccessService } from './guild-access.service';
import { ForbiddenDashboardError } from '../interfaces/dashboard.interfaces';
import type { DashboardSessionService } from './session.service';
import type { PermissionService } from '../../../core/permissions/application/permission.service';
import type { DashboardSessionData } from '../interfaces/dashboard.interfaces';

function sessionWith(
  overrides: Partial<DashboardSessionData> & {
    isBotOwner?: boolean;
    guilds?: DashboardSessionData['guilds'];
  } = {},
): DashboardSessionData {
  return {
    sessionId: 's1',
    user: {
      discordId: 'u1',
      username: 'u',
      globalName: null,
      avatarHash: null,
      isBotOwner: overrides.isBotOwner ?? false,
    },
    guilds: overrides.guilds ?? [],
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 1000),
  };
}

function build(
  session: DashboardSessionData | null,
  can = false,
): GuildAccessService {
  const sessions = {
    resolve: () => Promise.resolve(session),
  } as unknown as DashboardSessionService;
  const perms = {
    can: () => Promise.resolve(can),
  } as unknown as PermissionService;
  return new GuildAccessService(sessions, perms);
}

describe('GuildAccessService.assertManage', () => {
  it('allows a bot owner for any guild', async () => {
    const svc = build(sessionWith({ isBotOwner: true }));
    await expect(svc.assertManage('s1', 'g1')).resolves.toBeUndefined();
  });

  it('allows a user with Manage on the guild', async () => {
    const svc = build(
      sessionWith({
        guilds: [
          {
            guildId: 'g1',
            name: 'G',
            iconHash: null,
            botPresent: true,
            hasManage: true,
          },
        ],
      }),
    );
    await expect(svc.assertManage('s1', 'g1')).resolves.toBeUndefined();
  });

  it('throws for a user without Manage', async () => {
    const svc = build(
      sessionWith({
        guilds: [
          {
            guildId: 'g1',
            name: 'G',
            iconHash: null,
            botPresent: true,
            hasManage: false,
          },
        ],
      }),
    );
    await expect(svc.assertManage('s1', 'g1')).rejects.toBeInstanceOf(
      ForbiddenDashboardError,
    );
  });

  it('throws when there is no session', async () => {
    const svc = build(null);
    await expect(svc.assertManage('s1', 'g1')).rejects.toBeInstanceOf(
      ForbiddenDashboardError,
    );
  });
});

describe('GuildAccessService.hasClaim', () => {
  it('grants everything to a bot owner', async () => {
    const svc = build(sessionWith({ isBotOwner: true }));
    await expect(
      svc.hasClaim('s1', 'g1', 'dashboard.config.write'),
    ).resolves.toBe(true);
  });

  it('delegates to the permissions core for normal users', async () => {
    const svc = build(
      sessionWith({
        guilds: [
          {
            guildId: 'g1',
            name: 'G',
            iconHash: null,
            botPresent: true,
            hasManage: true,
          },
        ],
      }),
      true,
    );
    await expect(
      svc.hasClaim('s1', 'g1', 'dashboard.config.write'),
    ).resolves.toBe(true);
  });

  it('returns false with no session', async () => {
    const svc = build(null);
    await expect(svc.hasClaim('s1', 'g1', 'x')).resolves.toBe(false);
  });
});
