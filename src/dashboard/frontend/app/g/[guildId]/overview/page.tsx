'use client';

import { use, useEffect, useState, type ReactNode } from 'react';
import { api } from '../../../../lib/api/client';

/** Guild overview: aggregated counts + recent activity from the backend. */
export default function OverviewPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}): ReactNode {
  const { guildId } = use(params);
  const [data, setData] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .overview(guildId)
      .then(setData)
      .catch(() => setError('Failed to load overview'));
  }, [guildId]);

  if (error) return <p>{error}</p>;
  if (!data) return <p>Loading…</p>;
  return <pre>{JSON.stringify(data, null, 2)}</pre>;
}
