'use client';

import { use, useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  audit,
  ApiError,
  type AuditEntryView,
  type AuditExportFormat,
  type AuditRetentionConfig,
  type ChainVerification,
} from '../../../../lib/api/client';
import { Button, Card, Empty, Table, Td, fmtDate } from '../../../../lib/ui/ui';

const SOURCE_COLOR: Record<string, string> = {
  COMMAND: '#2563eb',
  DASHBOARD: '#7c3aed',
  API: '#0891b2',
  JOB: '#d97706',
  SYSTEM: '#6b7280',
  EVENT: '#16a34a',
};

const SOURCES = ['COMMAND', 'DASHBOARD', 'API', 'JOB', 'SYSTEM', 'EVENT'];
const FORMATS: AuditExportFormat[] = ['ndjson', 'json', 'csv'];

function SourceBadge({ source }: { source: string }): ReactNode {
  return (
    <span
      style={{
        background: SOURCE_COLOR[source] ?? '#6b7280',
        color: 'white',
        borderRadius: 4,
        padding: '2px 8px',
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {source}
    </span>
  );
}

function JsonBlock({
  title,
  value,
}: {
  title: string;
  value: Record<string, unknown> | null;
}): ReactNode {
  if (!value || Object.keys(value).length === 0) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#9ca3af', marginBottom: 4 }}>
        {title}
      </div>
      <pre
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 6,
          padding: 10,
          fontSize: 12,
          margin: 0,
          overflowX: 'auto',
        }}
      >
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

/** Chain integrity widget: last verification + on-demand "Verify now". */
function IntegrityWidget(): ReactNode {
  const [result, setResult] = useState<ChainVerification | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verify = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setResult(await audit.verify());
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? 'Missing audit.verify permission'
          : 'Verification failed',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Chain integrity">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {result ? (
          <span
            style={{
              background: result.valid ? '#16a34a' : '#dc2626',
              color: 'white',
              borderRadius: 4,
              padding: '4px 10px',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {result.valid
              ? `VALID · ${result.checked} entries`
              : `BROKEN at seq ${result.firstBrokenSeq ?? '?'}`}
          </span>
        ) : (
          <span style={{ color: '#9ca3af', fontSize: 13 }}>
            Not verified in this session
          </span>
        )}
        {result ? (
          <span style={{ color: '#9ca3af', fontSize: 12 }}>
            {fmtDate(result.verifiedAt)}
          </span>
        ) : null}
        <span style={{ flex: 1 }} />
        {error ? (
          <span style={{ color: '#f87171', fontSize: 12 }}>{error}</span>
        ) : null}
        <Button onClick={verify} disabled={busy} variant="primary">
          {busy ? 'Verifying…' : 'Verify now'}
        </Button>
      </div>
    </Card>
  );
}

/** Per-guild retention policy editor (audit.retention.manage). */
function RetentionCard(): ReactNode {
  const [cfg, setCfg] = useState<AuditRetentionConfig | null>(null);
  const [days, setDays] = useState('');
  const [archive, setArchive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    audit
      .retention()
      .then((c) => {
        setCfg(c);
        setDays(String(c.retentionDays));
        setArchive(c.archiveBeforeDelete);
      })
      .catch(() => setNote('Missing audit.retention.manage permission'));
  }, []);

  const save = async (): Promise<void> => {
    setSaving(true);
    setNote(null);
    try {
      const updated = await audit.updateRetention({
        retentionDays: Number(days),
        archiveBeforeDelete: archive,
      });
      setCfg(updated);
      setNote('Saved');
    } catch {
      setNote('Save failed (30–3650 days)');
    } finally {
      setSaving(false);
    }
  };

  if (!cfg) {
    return (
      <Card title="Retention">
        <span style={{ color: '#9ca3af', fontSize: 13 }}>
          {note ?? 'Loading…'}
        </span>
      </Card>
    );
  }

  return (
    <Card title="Retention">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 13, color: '#9ca3af' }}>
          Keep entries for{' '}
          <input
            value={days}
            onChange={(e) => setDays(e.target.value)}
            style={{
              width: 70,
              padding: '4px 8px',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 6,
            }}
          />{' '}
          days
        </label>
        <label style={{ fontSize: 13, color: '#9ca3af' }}>
          <input
            type="checkbox"
            checked={archive}
            onChange={(e) => setArchive(e.target.checked)}
            style={{ marginRight: 6 }}
          />
          Archive before delete ({cfg.archiveFormat})
        </label>
        <Button onClick={save} disabled={saving} variant="primary">
          {saving ? 'Saving…' : 'Save'}
        </Button>
        {note ? (
          <span style={{ fontSize: 12, color: note === 'Saved' ? '#16a34a' : '#dc2626' }}>
            {note}
          </span>
        ) : null}
      </div>
    </Card>
  );
}

export default function AuditPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}): ReactNode {
  use(params); // guild scope enforced server-side
  const [entries, setEntries] = useState<AuditEntryView[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [actorId, setActorId] = useState('');
  const [source, setSource] = useState('');
  const [selected, setSelected] = useState<AuditEntryView | null>(null);
  const [trace, setTrace] = useState<AuditEntryView[] | null>(null);
  const [exportFormat, setExportFormat] = useState<AuditExportFormat>('ndjson');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 25;

  const load = useCallback(() => {
    audit
      .entries({
        action: action || undefined,
        actorId: actorId || undefined,
        source: source || undefined,
        page,
        pageSize,
      })
      .then((r) => {
        setEntries(r.items);
        setTotal(r.total);
        setError(null);
      })
      .catch((err: unknown) =>
        setError(
          err instanceof ApiError && err.status === 403
            ? 'Missing audit.read permission'
            : 'Failed to load audit entries',
        ),
      );
  }, [action, actorId, source, page]);

  useEffect(() => {
    load();
  }, [load]);

  const openTrace = async (correlationId: string): Promise<void> => {
    try {
      setTrace(await audit.trace(correlationId));
    } catch {
      setTrace([]);
    }
  };

  const doExport = async (): Promise<void> => {
    setExporting(true);
    try {
      const blob = await audit.export(exportFormat, {
        action: action || undefined,
        actorId: actorId || undefined,
        source: source || undefined,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-export.${exportFormat}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Export failed (audit.export permission required)');
    } finally {
      setExporting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const inputStyle = {
    padding: '6px 10px',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 6,
    fontSize: 13,
  } as const;

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Audit</h2>

      <div style={{ display: 'grid', gap: 16, marginBottom: 16 }}>
        <IntegrityWidget />
        <RetentionCard />
      </div>

      <Card title="Audit explorer">
        <div
          style={{
            display: 'flex',
            gap: 8,
            marginBottom: 12,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <input
            placeholder="Action (prefix with trailing dot, e.g. scheduler.)"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
            style={{ ...inputStyle, width: 280 }}
          />
          <input
            placeholder="Actor id"
            value={actorId}
            onChange={(e) => {
              setActorId(e.target.value);
              setPage(1);
            }}
            style={{ ...inputStyle, width: 160 }}
          />
          <select
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setPage(1);
            }}
            style={inputStyle}
          >
            <option value="">All sources</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <span style={{ flex: 1 }} />
          <select
            value={exportFormat}
            onChange={(e) => setExportFormat(e.target.value as AuditExportFormat)}
            style={inputStyle}
          >
            {FORMATS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <Button onClick={doExport} disabled={exporting}>
            {exporting ? 'Exporting…' : 'Export'}
          </Button>
        </div>

        {error ? (
          <div style={{ color: '#f87171', fontSize: 13, marginBottom: 8 }}>{error}</div>
        ) : null}

        <Table columns={['When', 'Action', 'Source', 'Actor', 'Target', 'Seq']}>
          {entries.map((e) => (
            <tr
              key={e.id}
              onClick={() => setSelected(e)}
              style={{ cursor: 'pointer' }}
            >
              <Td>{fmtDate(e.occurredAt)}</Td>
              <Td mono>{e.action}</Td>
              <Td>
                <SourceBadge source={e.source} />
              </Td>
              <Td mono>{e.actorId ?? '—'}</Td>
              <Td mono>
                {e.targetType ? `${e.targetType}${e.targetId ? `:${e.targetId}` : ''}` : '—'}
              </Td>
              <Td mono>{e.seq}</Td>
            </tr>
          ))}
          {entries.length === 0 ? (
            <Empty colSpan={6} text="No audit entries match the filters" />
          ) : null}
        </Table>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 12,
            justifyContent: 'flex-end',
          }}
        >
          <span style={{ fontSize: 12, color: '#9ca3af' }}>
            {total} entries · page {page}/{totalPages}
          </span>
          <Button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            ← Prev
          </Button>
          <Button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Next →
          </Button>
        </div>
      </Card>

      {selected ? (
        <div
          onClick={() => setSelected(null)}
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
            style={{
              background: '#151823',
              borderRadius: 10,
              padding: 24,
              width: 640,
              maxWidth: '92vw',
              maxHeight: '85vh',
              overflowY: 'auto',
            }}
          >
            <h3 style={{ marginTop: 0, fontFamily: 'monospace' }}>{selected.action}</h3>
            <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 12 }}>
              <div>
                <b>When:</b> {fmtDate(selected.occurredAt)} · <b>Seq:</b> {selected.seq} ·{' '}
                <SourceBadge source={selected.source} />
              </div>
              <div>
                <b>Actor:</b> {selected.actorId ?? 'system'} ({selected.actorType})
              </div>
              <div>
                <b>Target:</b>{' '}
                {selected.targetType
                  ? `${selected.targetType}${selected.targetId ? `:${selected.targetId}` : ''}`
                  : '—'}
              </div>
              <div style={{ wordBreak: 'break-all' }}>
                <b>Hash:</b> <code style={{ fontSize: 11 }}>{selected.hash}</code>
              </div>
              <div>
                <b>Correlation:</b>{' '}
                <button
                  onClick={() => void openTrace(selected.correlationId)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#5865F2',
                    cursor: 'pointer',
                    padding: 0,
                    fontSize: 13,
                    textDecoration: 'underline',
                  }}
                >
                  {selected.correlationId}
                </button>
              </div>
            </div>
            <JsonBlock title="Before" value={selected.before} />
            <JsonBlock title="After" value={selected.after} />
            <JsonBlock title="Metadata" value={selected.metadata} />
            <div style={{ textAlign: 'right' }}>
              <Button onClick={() => setSelected(null)}>Close</Button>
            </div>
          </div>
        </div>
      ) : null}

      {trace ? (
        <div
          onClick={() => setTrace(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 60,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#151823',
              borderRadius: 10,
              padding: 24,
              width: 560,
              maxWidth: '92vw',
              maxHeight: '80vh',
              overflowY: 'auto',
            }}
          >
            <h3 style={{ marginTop: 0 }}>Correlation trace</h3>
            {trace.length === 0 ? (
              <p style={{ color: '#9ca3af', fontSize: 13 }}>No entries for this correlation.</p>
            ) : (
              <ol style={{ margin: 0, paddingLeft: 20 }}>
                {trace.map((t) => (
                  <li key={t.id} style={{ marginBottom: 8, fontSize: 13 }}>
                    <code>{t.action}</code>
                    <span style={{ color: '#9ca3af' }}> · {fmtDate(t.occurredAt)}</span>
                    <span style={{ marginLeft: 6 }}>
                      <SourceBadge source={t.source} />
                    </span>
                  </li>
                ))}
              </ol>
            )}
            <div style={{ textAlign: 'right', marginTop: 12 }}>
              <Button onClick={() => setTrace(null)}>Close</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
