import type { ReactNode } from 'react';

const NAV = [
  ['overview', 'Overview'],
  ['modules', 'Modules'],
  ['logs', 'Logs'],
  ['api-keys', 'API Keys'],
  ['backups', 'Backups'],
] as const;

/** Guild shell: side nav + content. Realtime provider is wired per-page. */
export default async function GuildLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ guildId: string }>;
}): Promise<ReactNode> {
  const { guildId } = await params;
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <nav style={{ width: 200, borderRight: '1px solid #ddd', padding: 16 }}>
        <ul>
          {NAV.map(([slug, label]) => (
            <li key={slug}>
              <a href={`/g/${guildId}/${slug}`}>{label}</a>
            </li>
          ))}
        </ul>
      </nav>
      <main style={{ flex: 1, padding: 24 }}>{children}</main>
    </div>
  );
}
