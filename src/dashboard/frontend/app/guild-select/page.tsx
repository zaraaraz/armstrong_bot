'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { api, type ManageableGuild } from '../../lib/api/client';

/**
 * Guild selector — lists only guilds the user can manage (the backend already
 * filters to Manage-Guild / owner). Selecting one navigates into its shell.
 */
export default function GuildSelectPage(): ReactNode {
  const [guilds, setGuilds] = useState<ManageableGuild[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .guilds()
      .then((list) => setGuilds(list.filter((g) => g.hasManage)))
      .catch(() => setError('Failed to load guilds'));
  }, []);

  if (error) return <main>{error}</main>;
  if (!guilds) return <main>Loading…</main>;

  return (
    <main>
      <h1>Select a server</h1>
      <ul>
        {guilds.map((g) => (
          <li key={g.guildId}>
            <a href={`/g/${g.guildId}/overview`}>
              {g.name}
              {g.botPresent ? '' : ' (bot not installed)'}
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
