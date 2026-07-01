'use client';

import { use, useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, type BackupView } from '../../../../lib/api/client';
import { useRealtime } from '../../../../lib/realtime/useRealtime';
import { Button, Card, Empty, Table, Td, fmtBytes, fmtDate } from '../../../../lib/ui/ui';

const STATUS_COLOR: Record<string, string> = {
  pending: '#9ca3af',
  'in-progress': '#2563eb',
  completed: '#16a34a',
  failed: '#dc2626',
};

export default function BackupsPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}): ReactNode {
  const { guildId } = use(params);
  const [backups, setBackups] = useState<BackupView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.backups
      .list(guildId)
      .then((r) => setBackups(r.items))
      .catch(() => setError('Failed to load backups'));
  }, [guildId]);

  useEffect(() => {
    load();
  }, [load]);

  // Live-refresh when the backup job changes state on the server.
  useRealtime(guildId, 'jobs', (event) => {
    if (event === 'job:state') load();
  });

  const requestBackup = useCallback(async () => {
    setBusy(true);
    try {
      await api.backups.request(guildId);
      load();
    } catch {
      setError('Failed to request backup');
    } finally {
      setBusy(false);
    }
  }, [guildId, load]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ marginTop: 0 }}>Backups</h2>
        <Button variant="primary" disabled={busy} onClick={requestBackup}>
          {busy ? 'Requesting…' : '+ Request backup'}
        </Button>
      </div>

      {error ? <p style={{ color: '#dc2626' }}>{error}</p> : null}

      <Card>
        <Table columns={['Status', 'Size', 'Created', 'Completed', 'Error']}>
          {backups.map((b) => (
            <tr key={b.id}>
              <Td>
                <span style={{ color: STATUS_COLOR[b.status] ?? '#6b7280', fontWeight: 600 }}>
                  {b.status}
                </span>
              </Td>
              <Td>{fmtBytes(b.sizeBytes)}</Td>
              <Td>{fmtDate(b.createdAt)}</Td>
              <Td>{fmtDate(b.completedAt)}</Td>
              <Td>{b.error ?? '—'}</Td>
            </tr>
          ))}
          {backups.length === 0 ? <Empty colSpan={5} text="No backups yet" /> : null}
        </Table>
      </Card>

      <p style={{ fontSize: 13, color: '#6b7280', marginTop: 16 }}>
        Backups run asynchronously. The list updates live as jobs complete.
      </p>
    </div>
  );
}
