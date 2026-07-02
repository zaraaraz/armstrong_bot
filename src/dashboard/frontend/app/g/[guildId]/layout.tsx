'use client';

import { use, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { api, type DashboardUser } from '../../../lib/api/client';
import { palette } from '../../../lib/ui/ui';

const NAV = [
  ['overview', 'Overview'],
  ['modules', 'Modules'],
  ['scheduler', 'Scheduler'],
  ['audit', 'Audit'],
  ['logs', 'Logs'],
  ['api-keys', 'API Keys'],
  ['backups', 'Backups'],
] as const;

/** Guild shell: branded dark side nav + header (user + logout) + content. */
export default function GuildLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ guildId: string }>;
}): ReactNode {
  const { guildId } = use(params);
  const pathname = usePathname();
  const [user, setUser] = useState<DashboardUser | null>(null);

  useEffect(() => {
    api.me().then(setUser).catch(() => undefined);
  }, []);

  const logout = async (): Promise<void> => {
    await api.logout().catch(() => undefined);
    window.location.href = '/login';
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <nav
        style={{
          width: 220,
          background: '#0b0d13',
          borderRight: `1px solid ${palette.faint}`,
          color: palette.text,
          padding: '20px 12px',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 16, padding: '0 12px 20px' }}>
          👻 Ghost Bot
        </div>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, flex: 1 }}>
          {NAV.map(([slug, label]) => {
            const href = `/g/${guildId}/${slug}`;
            const active = pathname === href;
            return (
              <li key={slug}>
                <a
                  href={href}
                  style={{
                    display: 'block',
                    padding: '10px 12px',
                    borderRadius: 8,
                    marginBottom: 2,
                    color: active ? 'white' : palette.muted,
                    background: active ? palette.accent : 'transparent',
                    textDecoration: 'none',
                    fontSize: 14,
                  }}
                >
                  {label}
                </a>
              </li>
            );
          })}
        </ul>
        <a
          href="/guild-select"
          style={{
            color: palette.muted,
            fontSize: 12,
            padding: '0 12px',
            textDecoration: 'none',
          }}
        >
          ← Switch server
        </a>
      </nav>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <header
          style={{
            height: 56,
            borderBottom: `1px solid ${palette.faint}`,
            background: 'rgba(255, 255, 255, 0.02)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 12,
            padding: '0 24px',
          }}
        >
          {user ? (
            <span style={{ fontSize: 13, color: palette.muted }}>
              {user.globalName ?? user.username}
              {user.isBotOwner ? ' · owner' : ''}
            </span>
          ) : null}
          <button
            onClick={logout}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255, 255, 255, 0.14)',
              color: palette.muted,
              borderRadius: 7,
              padding: '6px 12px',
              fontSize: 12.5,
              cursor: 'pointer',
            }}
          >
            Logout
          </button>
        </header>
        <main style={{ flex: 1, padding: 24 }}>{children}</main>
      </div>
    </div>
  );
}
