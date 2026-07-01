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
 * Guild selector — the backend returns only guilds the user can manage. Guilds
 * with the bot installed open the dashboard; guilds without it show an invite
 * link that pre-selects that server in Discord’s add-bot flow.
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
      .catch(() => setError('Failed to load guilds'));
  }, []);

  if (error) return <main style={{ padding: 48 }}>{error}</main>;
  if (!guilds || !user) return <main style={{ padding: 48 }}>Loading…</main>;

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
            <GuildRow key={g.guildId} guild={g} clientId={user.clientId} />
          ))}
        </div>
      )}
    </main>
  );
}

function GuildRow({
  guild,
  clientId,
}: {
  guild: ManageableGuild;
  clientId: string;
}): ReactNode {
  const rowStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: 16,
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    background: 'white',
    textDecoration: 'none',
    color: '#111827',
  } as const;

  const body = (
    <>
      <GuildIcon guild={guild} />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600 }}>{guild.name}</div>
        <div style={{ fontSize: 12, color: '#6b7280' }}>
          {guild.botPresent ? 'Bot installed' : 'Bot not installed'}
        </div>
      </div>
      {guild.botPresent ? (
        <span style={{ color: '#9ca3af' }}>›</span>
      ) : (
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: '#5865F2',
            border: '1px solid #c7cbf5',
            borderRadius: 6,
            padding: '6px 12px',
          }}
        >
          + Add the bot
        </span>
      )}
    </>
  );

  if (guild.botPresent) {
    return (
      <a href={`/g/${guild.guildId}/overview`} style={rowStyle}>
        {body}
      </a>
    );
  }

  // Not installed → open Discord’s invite flow (new tab), pre-selecting this guild.
  return (
    <a
      href={inviteUrl(clientId, guild.guildId)}
      target="_blank"
      rel="noopener noreferrer"
      style={rowStyle}
    >
      {body}
    </a>
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
