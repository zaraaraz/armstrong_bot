'use client';

import { use, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { api, type DashboardUser } from '../../../lib/api/client';

const NAV = [
  ['overview', 'Overview'],
  ['modules', 'Modules'],
  ['scheduler', 'Scheduler'],
  ['logs', 'Logs'],
  ['api-keys', 'API Keys'],
  ['backups', 'Backups'],
] as const;

/** Guild shell: branded side nav + header (user + logout) + content. */
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
          background: '#111827',
          color: '#e5e7eb',
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
                    borderRadius: 6,
                    marginBottom: 2,
                    color: active ? 'white' : '#9ca3af',
                    background: active ? '#5865F2' : 'transparent',
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
          style={{ color: '#9ca3af', fontSize: 12, padding: '0 12px', textDecoration: 'none' }}
        >
          ← Switch server
        </a>
      </nav>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <header
          style={{
            height: 56,
            borderBottom: '1px solid #e5e7eb',
            background: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 12,
            padding: '0 24px',
          }}
        >
          {user ? (
            <span style={{ fontSize: 13, color: '#374151' }}>
              {user.globalName ?? user.username}
              {user.isBotOwner ? ' · owner' : ''}
            </span>
          ) : null}
          <button
            onClick={logout}
            style={{
              background: '#f3f4f6',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              padding: '6px 12px',
              fontSize: 13,
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
