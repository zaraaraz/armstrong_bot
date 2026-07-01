'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { api, type ManageableGuild } from '../../lib/api/client';

/**
 * Guild selector — the backend already returns only guilds the user can manage
 * (Manage-Guild or bot owner). Selecting one navigates into its shell.
 */
export default function GuildSelectPage(): ReactNode {
  const [guilds, setGuilds] = useState<ManageableGuild[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .guilds()
      .then(setGuilds)
      .catch(() => setError('Failed to load guilds'));
  }, []);

  if (error)
    return <main style={{ padding: 48 }}>{error}</main>;
  if (!guilds)
    return <main style={{ padding: 48 }}>Loading…</main>;

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px' }}>
      <h1>Select a server</h1>
      {guilds.length === 0 ? (
        <p style={{ color: '#6b7280' }}>
          You don’t manage any servers the bot can see yet.
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 12, marginTop: 24 }}>
          {guilds.map((g) => (
            <a
              key={g.guildId}
              href={g.botPresent ? `/g/${g.guildId}/overview` : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                padding: 16,
                border: '1px solid #e5e7eb',
                borderRadius: 10,
                background: 'white',
                textDecoration: 'none',
                color: '#111827',
                cursor: g.botPresent ? 'pointer' : 'not-allowed',
                opacity: g.botPresent ? 1 : 0.6,
              }}
            >
              <GuildIcon guild={g} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{g.name}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  {g.botPresent ? 'Bot installed' : 'Bot not installed'}
                </div>
              </div>
              {!g.botPresent ? (
                <span style={{ fontSize: 12, color: '#d97706' }}>Add the bot →</span>
              ) : (
                <span style={{ color: '#9ca3af' }}>›</span>
              )}
            </a>
          ))}
        </div>
      )}
    </main>
  );
}

function GuildIcon({ guild }: { guild: ManageableGuild }): ReactNode {
  const size = 44;
  if (guild.iconHash) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`https://cdn.discordapp.com/icons/${guild.guildId}/${guild.iconHash}.png?size=64`}
        alt=""
        width={size}
        height={size}
        style={{ borderRadius: 10 }}
      />
    );
  }
  const initials = guild.name.slice(0, 2).toUpperCase();
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 10,
        background: '#5865F2',
        color: 'white',
        display: 'grid',
        placeItems: 'center',
        fontWeight: 700,
        fontSize: 14,
      }}
    >
      {initials}
    </div>
  );
}
