'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  api,
  type DashboardUser,
  type ManageableGuild,
} from '../../lib/api/client';

// Permissions the bot requests when invited (Administrator for now; tighten later).
const BOT_PERMISSIONS = '8';

function inviteUrl(clientId: string, guildId: string): string {
  const p = new URLSearchParams({
    client_id: clientId,
    scope: 'bot applications.commands',
    permissions: BOT_PERMISSIONS,
    guild_id: guildId,
    disable_guild_select: 'true',
  });
  return `https://discord.com/oauth2/authorize?${p.toString()}`;
}

/**
 * Guild selector — servers where the bot is installed come first (primary
 * action: open the dashboard); the rest sit in an "invite" section below.
 */
export default function GuildSelectPage(): ReactNode {
  const [guilds, setGuilds] = useState<ManageableGuild[] | null>(null);
  const [user, setUser] = useState<DashboardUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.guilds(), api.me()])
      .then(([list, me]) => {
        setGuilds(list);
        setUser(me);
      })
      .catch(() => setError('Failed to load your servers.'));
  }, []);

  const logout = async (): Promise<void> => {
    await api.logout().catch(() => undefined);
    window.location.href = '/login';
  };

  const installed = (guilds ?? []).filter((g) => g.botPresent);
  const notInstalled = (guilds ?? []).filter((g) => !g.botPresent);

  return (
    <div className="gs-page">
      <style>{styles}</style>

      <header className="gs-topbar">
        <div className="gs-brand">
          <span className="gs-brand-icon">👻</span> Ghost Bot
        </div>
        {user ? (
          <div className="gs-user">
            <UserAvatar user={user} />
            <span className="gs-user-name">
              {user.globalName ?? user.username}
            </span>
            <button className="gs-logout" onClick={logout}>
              Logout
            </button>
          </div>
        ) : null}
      </header>

      <main className="gs-main">
        <h1 className="gs-title">Select a server</h1>
        <p className="gs-subtitle">
          Manage the servers where Ghost Bot lives — or invite it to a new one.
        </p>

        {error ? <p className="gs-error">{error}</p> : null}

        {!guilds && !error ? <SkeletonList /> : null}

        {guilds && guilds.length === 0 ? (
          <p className="gs-empty">
            You don’t manage any servers the bot can see yet.
          </p>
        ) : null}

        {installed.length > 0 ? (
          <>
            <h2 className="gs-section">
              Your servers <span className="gs-count">{installed.length}</span>
            </h2>
            <div className="gs-grid">
              {installed.map((g) => (
                <a
                  key={g.guildId}
                  href={`/g/${g.guildId}/overview`}
                  className="gs-card gs-card-active"
                >
                  <GuildIcon guild={g} />
                  <div className="gs-card-body">
                    <div className="gs-card-name">{g.name}</div>
                    <div className="gs-card-status">
                      <span className="gs-dot gs-dot-on" /> Bot installed
                    </div>
                  </div>
                  <span className="gs-card-cta">Open ›</span>
                </a>
              ))}
            </div>
          </>
        ) : null}

        {notInstalled.length > 0 ? (
          <>
            <h2 className="gs-section">
              Add Ghost Bot to…{' '}
              <span className="gs-count">{notInstalled.length}</span>
            </h2>
            <div className="gs-grid">
              {notInstalled.map((g) => (
                <a
                  key={g.guildId}
                  href={user ? inviteUrl(user.clientId, g.guildId) : '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="gs-card gs-card-invite"
                >
                  <GuildIcon guild={g} dim />
                  <div className="gs-card-body">
                    <div className="gs-card-name">{g.name}</div>
                    <div className="gs-card-status">
                      <span className="gs-dot" /> Not installed
                    </div>
                  </div>
                  <span className="gs-card-add">+ Invite</span>
                </a>
              ))}
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}

function UserAvatar({ user }: { user: DashboardUser }): ReactNode {
  if (user.avatarHash) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className="gs-avatar"
        src={`https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatarHash}.png?size=64`}
        alt=""
        width={30}
        height={30}
      />
    );
  }
  return <span className="gs-avatar gs-avatar-fallback">👤</span>;
}

function GuildIcon({
  guild,
  dim,
}: {
  guild: ManageableGuild;
  dim?: boolean;
}): ReactNode {
  if (guild.iconHash) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className={`gs-icon${dim ? ' gs-icon-dim' : ''}`}
        src={`https://cdn.discordapp.com/icons/${guild.guildId}/${guild.iconHash}.png?size=96`}
        alt=""
        width={52}
        height={52}
      />
    );
  }
  return (
    <div className={`gs-icon gs-icon-letters${dim ? ' gs-icon-dim' : ''}`}>
      {guild.name.slice(0, 2).toUpperCase()}
    </div>
  );
}

function SkeletonList(): ReactNode {
  return (
    <div className="gs-grid" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="gs-card gs-skeleton">
          <div className="gs-icon gs-skeleton-block" />
          <div className="gs-card-body">
            <div className="gs-skeleton-line" style={{ width: '60%' }} />
            <div className="gs-skeleton-line" style={{ width: '35%' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

const styles = `
  .gs-page {
    min-height: 100vh;
    background:
      radial-gradient(1200px 500px at 80% -10%, rgba(88, 101, 242, 0.18), transparent 60%),
      radial-gradient(900px 400px at 10% 110%, rgba(88, 101, 242, 0.10), transparent 60%),
      #0f1117;
    color: #e5e7eb;
  }
  .gs-topbar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 18px 28px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .gs-brand { font-weight: 700; font-size: 16px; letter-spacing: 0.2px; }
  .gs-brand-icon { margin-right: 6px; }
  .gs-user { display: flex; align-items: center; gap: 10px; }
  .gs-user-name { font-size: 13px; color: #b6bac3; }
  .gs-avatar { border-radius: 50%; display: block; }
  .gs-avatar-fallback {
    width: 30px; height: 30px; display: grid; place-items: center;
    background: #23262f; border-radius: 50%; font-size: 14px;
  }
  .gs-logout {
    background: transparent; color: #9ca3af; font-size: 12.5px;
    border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 7px;
    padding: 6px 12px; cursor: pointer; transition: all 0.15s ease;
  }
  .gs-logout:hover { color: #fff; border-color: rgba(255, 255, 255, 0.3); }

  .gs-main { max-width: 860px; margin: 0 auto; padding: 56px 24px 80px; }
  .gs-title { margin: 0; font-size: 30px; letter-spacing: -0.3px; }
  .gs-subtitle { margin: 8px 0 0; color: #9ca3af; font-size: 14.5px; }
  .gs-error { color: #f87171; margin-top: 24px; }
  .gs-empty { color: #9ca3af; margin-top: 32px; }

  .gs-section {
    margin: 40px 0 14px; font-size: 12.5px; font-weight: 600;
    color: #9ca3af; text-transform: uppercase; letter-spacing: 1px;
  }
  .gs-count {
    background: rgba(255, 255, 255, 0.08); color: #b6bac3;
    border-radius: 999px; padding: 1px 9px; font-size: 11.5px; margin-left: 6px;
  }

  .gs-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  @media (max-width: 640px) { .gs-grid { grid-template-columns: 1fr; } }

  .gs-card {
    display: flex; align-items: center; gap: 14px;
    padding: 16px; border-radius: 14px;
    background: rgba(255, 255, 255, 0.035);
    border: 1px solid rgba(255, 255, 255, 0.07);
    text-decoration: none; color: inherit;
    transition: transform 0.15s ease, border-color 0.15s ease, background 0.15s ease;
    animation: gs-in 0.25s ease both;
  }
  .gs-card:hover { transform: translateY(-2px); }
  .gs-card-active:hover {
    border-color: rgba(88, 101, 242, 0.65);
    background: rgba(88, 101, 242, 0.10);
  }
  .gs-card-invite { opacity: 0.78; }
  .gs-card-invite:hover {
    opacity: 1; border-color: rgba(255, 255, 255, 0.22);
  }

  .gs-icon {
    width: 52px; height: 52px; border-radius: 14px; flex-shrink: 0;
    object-fit: cover;
  }
  .gs-icon-letters {
    display: grid; place-items: center; font-weight: 700; font-size: 15px;
    background: linear-gradient(135deg, #5865F2, #7983f5); color: #fff;
  }
  .gs-icon-dim { filter: grayscale(0.5); opacity: 0.8; }

  .gs-card-body { flex: 1; min-width: 0; }
  .gs-card-name {
    font-weight: 600; font-size: 14.5px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .gs-card-status {
    display: flex; align-items: center; gap: 6px;
    font-size: 12px; color: #9ca3af; margin-top: 3px;
  }
  .gs-dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: #4b5563; display: inline-block;
  }
  .gs-dot-on { background: #23a55a; box-shadow: 0 0 6px rgba(35, 165, 90, 0.7); }

  .gs-card-cta { color: #7983f5; font-size: 13px; font-weight: 600; }
  .gs-card-add {
    color: #b6bac3; font-size: 12.5px; font-weight: 600;
    border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 999px;
    padding: 5px 12px; transition: all 0.15s ease;
  }
  .gs-card-invite:hover .gs-card-add {
    color: #fff; border-color: #5865F2; background: rgba(88, 101, 242, 0.25);
  }

  .gs-skeleton { pointer-events: none; }
  .gs-skeleton-block { background: rgba(255,255,255,0.06); }
  .gs-skeleton-line {
    height: 11px; border-radius: 6px; background: rgba(255,255,255,0.07);
    margin: 7px 0;
  }
  .gs-skeleton-block, .gs-skeleton-line { animation: gs-pulse 1.4s ease infinite; }

  @keyframes gs-in { from { opacity: 0; transform: translateY(4px); } }
  @keyframes gs-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
`;
