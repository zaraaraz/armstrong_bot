'use client';

import { use, useEffect, useState, type ReactNode } from 'react';
import { api, type GuildOverview } from '../../../../lib/api/client';
import { Card, Stat, Table, Td, Empty, fmtDate } from '../../../../lib/ui/ui';

/** Guild overview: aggregated module count + recent audit activity. */
export default function OverviewPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}): ReactNode {
  const { guildId } = use(params);
  const [data, setData] = useState<GuildOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .overview(guildId)
      .then(setData)
      .catch(() => setError('Failed to load overview'));
  }, [guildId]);

  if (error) return <p style={{ color: '#f87171' }}>{error}</p>;
  if (!data) return <p>Loading…</p>;

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Overview</h2>

      <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        <Card accent="#5865F2">
          <Stat value={data.modules.total} label="Active modules" />
        </Card>
        <Card accent="#16a34a">
          <Stat value={data.recentActivity.length} label="Recent events" />
        </Card>
      </div>

      <Card title="Recent activity">
        <Table columns={['Action', 'Actor', 'Target', 'When']}>
          {data.recentActivity.map((a, i) => (
            <tr key={i}>
              <Td>{a.action}</Td>
              <Td mono>{a.actorId}</Td>
              <Td mono>{a.target ?? '—'}</Td>
              <Td>{fmtDate(a.at)}</Td>
            </tr>
          ))}
          {data.recentActivity.length === 0 ? (
            <Empty colSpan={4} text="No recent activity" />
          ) : null}
        </Table>
      </Card>
    </div>
  );
}
