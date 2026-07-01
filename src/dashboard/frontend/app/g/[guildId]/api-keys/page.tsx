'use client';

import { use, useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  api,
  type CreatedDashboardApiKey,
  type DashboardApiKeyView,
} from '../../../../lib/api/client';
import { Button, Card, Empty, Table, Td, fmtDate } from '../../../../lib/ui/ui';

function keyStatus(k: DashboardApiKeyView): { label: string; color: string } {
  if (k.revokedAt) return { label: 'revoked', color: '#dc2626' };
  if (k.expiresAt && new Date(k.expiresAt) < new Date())
    return { label: 'expired', color: '#d97706' };
  return { label: 'active', color: '#16a34a' };
}

export default function ApiKeysPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}): ReactNode {
  const { guildId } = use(params);
  const [keys, setKeys] = useState<DashboardApiKeyView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedDashboardApiKey | null>(null);

  const load = useCallback(() => {
    api.apiKeys
      .list(guildId)
      .then((r) => setKeys(r.items))
      .catch(() => setError('Failed to load API keys'));
  }, [guildId]);

  useEffect(() => {
    load();
  }, [load]);

  const revoke = useCallback(
    async (id: string) => {
      if (!confirm('Revoke this API key? This cannot be undone.')) return;
      await api.apiKeys.revoke(guildId, id).catch(() => undefined);
      load();
    },
    [guildId, load],
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ marginTop: 0 }}>API Keys</h2>
        <Button variant="primary" onClick={() => setCreating(true)}>
          + New key
        </Button>
      </div>

      {error ? <p style={{ color: '#dc2626' }}>{error}</p> : null}

      <Card>
        <Table columns={['Name', 'Prefix', 'Scopes', 'Status', 'Last used', 'Created', '']}>
          {keys.map((k) => {
            const st = keyStatus(k);
            return (
              <tr key={k.id}>
                <Td>{k.name}</Td>
                <Td mono>{k.prefix}…</Td>
                <Td>{k.scopes.join(', ')}</Td>
                <Td>
                  <span style={{ color: st.color, fontWeight: 600 }}>{st.label}</span>
                </Td>
                <Td>{fmtDate(k.lastUsedAt)}</Td>
                <Td>{fmtDate(k.createdAt)}</Td>
                <Td>
                  {!k.revokedAt ? (
                    <Button variant="danger" onClick={() => revoke(k.id)}>
                      Revoke
                    </Button>
                  ) : null}
                </Td>
              </tr>
            );
          })}
          {keys.length === 0 ? <Empty colSpan={7} text="No API keys yet" /> : null}
        </Table>
      </Card>

      {creating ? (
        <CreateKeyModal
          guildId={guildId}
          onClose={() => setCreating(false)}
          onCreated={(k) => {
            setCreating(false);
            setCreated(k);
            load();
          }}
        />
      ) : null}

      {created ? (
        <ShowKeyModal apiKey={created} onClose={() => setCreated(null)} />
      ) : null}
    </div>
  );
}

function CreateKeyModal({
  guildId,
  onClose,
  onCreated,
}: {
  guildId: string;
  onClose: () => void;
  onCreated: (k: CreatedDashboardApiKey) => void;
}): ReactNode {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState('read.*');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const key = await api.apiKeys.create(guildId, {
        name: name.trim(),
        scopes: scopes
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      });
      onCreated(key);
    } catch {
      setErr('Failed to create key (name ≥ 3 chars, ≥ 1 scope).');
    } finally {
      setBusy(false);
    }
  }, [guildId, name, scopes, onCreated]);

  return (
    <Modal title="Create API key" onClose={onClose}>
      <label style={LABEL}>Name</label>
      <input style={INPUT} value={name} onChange={(e) => setName(e.target.value)} placeholder="My integration" />
      <label style={LABEL}>Scopes (comma-separated)</label>
      <input style={INPUT} value={scopes} onChange={(e) => setScopes(e.target.value)} placeholder="read.*, write.config" />
      {err ? <p style={{ color: '#dc2626', fontSize: 13 }}>{err}</p> : null}
      <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy || name.trim().length < 3} onClick={submit}>
          Create
        </Button>
      </div>
    </Modal>
  );
}

function ShowKeyModal({
  apiKey,
  onClose,
}: {
  apiKey: CreatedDashboardApiKey;
  onClose: () => void;
}): ReactNode {
  return (
    <Modal title="API key created" onClose={onClose}>
      <p style={{ fontSize: 13, color: '#b45309' }}>
        ⚠️ Copy this key now — it is shown only once and cannot be retrieved again.
      </p>
      <pre
        style={{
          background: '#111827',
          color: '#e5e7eb',
          padding: 12,
          borderRadius: 6,
          fontSize: 13,
          overflowX: 'auto',
        }}
      >
        {apiKey.plaintext}
      </pre>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
        <Button onClick={() => navigator.clipboard?.writeText(apiKey.plaintext)}>Copy</Button>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}): ReactNode {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'white', borderRadius: 10, padding: 24, width: 440, maxWidth: '90vw' }}
      >
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

const LABEL = { display: 'block', fontSize: 12, color: '#6b7280', margin: '10px 0 4px' } as const;
const INPUT = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 14,
  boxSizing: 'border-box' as const,
};
