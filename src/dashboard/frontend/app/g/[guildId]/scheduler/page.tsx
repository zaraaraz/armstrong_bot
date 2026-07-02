'use client';

import { use, useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  scheduler,
  type SchedulerHealth,
  type SchedulerJob,
  type SchedulerRun,
  type ScheduleStatus,
} from '../../../../lib/api/client';

const STATUS_COLORS: Record<ScheduleStatus, string> = {
  pending: '#9ca3af',
  active: '#16a34a',
  paused: '#d97706',
  completed: '#2563eb',
  cancelled: '#6b7280',
  failed: '#dc2626',
};

const STATUS_FILTERS: Array<ScheduleStatus | ''> = [
  '',
  'pending',
  'active',
  'paused',
  'completed',
  'cancelled',
  'failed',
];

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}

function StatusBadge({ status }: { status: ScheduleStatus }): ReactNode {
  return (
    <span
      style={{
        background: STATUS_COLORS[status],
        color: 'white',
        borderRadius: 4,
        padding: '2px 8px',
        fontSize: 12,
        textTransform: 'capitalize',
      }}
    >
      {status}
    </span>
  );
}

/** Health widget: queue depth, DLQ size, last reconcile, worker status. */
function HealthWidget(): ReactNode {
  const [health, setHealth] = useState<SchedulerHealth | null>(null);

  useEffect(() => {
    const load = (): void => {
      scheduler.health().then(setHealth).catch(() => undefined);
    };
    load();
    const t = setInterval(load, 10_000); // dashboard polls /scheduler/health
    return () => clearInterval(t);
  }, []);

  if (!health) return <p>Loading health…</p>;
  const cell = { padding: '8px 16px', textAlign: 'center' as const };
  return (
    <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
      <div style={cell}>
        <div style={{ fontSize: 24, fontWeight: 600 }}>{health.queueDepth}</div>
        <div style={{ fontSize: 12, color: '#9ca3af' }}>Queued</div>
      </div>
      <div style={cell}>
        <div style={{ fontSize: 24, fontWeight: 600, color: health.dlqSize > 0 ? '#dc2626' : undefined }}>
          {health.dlqSize}
        </div>
        <div style={{ fontSize: 12, color: '#9ca3af' }}>DLQ</div>
      </div>
      <div style={cell}>
        <div style={{ fontSize: 24, fontWeight: 600 }}>
          {health.workerUp ? '🟢' : '🔴'}
        </div>
        <div style={{ fontSize: 12, color: '#9ca3af' }}>Worker</div>
      </div>
      <div style={cell}>
        <div style={{ fontSize: 13 }}>{fmt(health.lastReconcileAt)}</div>
        <div style={{ fontSize: 12, color: '#9ca3af' }}>Last reconcile</div>
      </div>
    </div>
  );
}

/** Detail drawer: recent runs + claim-gated action buttons. */
function JobDrawer({
  job,
  onClose,
  onChanged,
}: {
  job: SchedulerJob;
  onClose: () => void;
  onChanged: () => void;
}): ReactNode {
  const [runs, setRuns] = useState<SchedulerRun[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    scheduler
      .runs(job.id)
      .then((r) => setRuns(r.items))
      .catch(() => setRuns([]));
  }, [job.id]);

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await fn();
        onChanged();
      } catch {
        // surfaced by the global envelope; keep the drawer open
      } finally {
        setBusy(false);
      }
    },
    [onChanged],
  );

  return (
    <aside
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        width: 420,
        height: '100vh',
        background: '#151823',
        borderLeft: '1px solid rgba(255,255,255,0.1)',
        padding: 24,
        overflowY: 'auto',
        boxShadow: '-8px 0 24px rgba(0,0,0,0.5)',
      }}
    >
      <button onClick={onClose} style={{ float: 'right' }}>
        ✕
      </button>
      <h3>{job.kind}</h3>
      <p>
        <StatusBadge status={job.status} /> · {job.type}
      </p>
      <dl style={{ fontSize: 13 }}>
        <dt>ID</dt>
        <dd style={{ fontFamily: 'monospace' }}>{job.id}</dd>
        {job.cron ? (
          <>
            <dt>Cron</dt>
            <dd>{job.cron}</dd>
          </>
        ) : null}
        <dt>Next run</dt>
        <dd>{fmt(job.nextRunAt)}</dd>
        <dt>Last run</dt>
        <dd>{fmt(job.lastRunAt)}</dd>
      </dl>

      <div style={{ display: 'flex', gap: 8, margin: '16px 0' }}>
        {job.type === 'recurring' && job.status === 'active' ? (
          <button disabled={busy} onClick={() => act(() => scheduler.pause(job.id))}>
            Pause
          </button>
        ) : null}
        {job.status === 'paused' ? (
          <button disabled={busy} onClick={() => act(() => scheduler.resume(job.id))}>
            Resume
          </button>
        ) : null}
        <button disabled={busy} onClick={() => act(() => scheduler.trigger(job.id))}>
          Trigger now
        </button>
        <button
          disabled={busy}
          style={{ color: '#f87171' }}
          onClick={() => act(() => scheduler.cancel(job.id))}
        >
          Cancel
        </button>
      </div>

      <h4>Recent runs</h4>
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <th>#</th>
            <th>Status</th>
            <th>Duration</th>
            <th>Started</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <td>{r.attempt}</td>
              <td>
                <StatusBadge status={r.status} />
              </td>
              <td>{r.durationMs != null ? `${r.durationMs} ms` : '—'}</td>
              <td>{fmt(r.startedAt)}</td>
            </tr>
          ))}
          {runs.length === 0 ? (
            <tr>
              <td colSpan={4} style={{ color: '#9ca3af', padding: 8 }}>
                No runs yet
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </aside>
  );
}

/** Scheduler panel: health widget + filterable, paginated jobs table + drawer. */
export default function SchedulerPage({
  params,
}: {
  params: Promise<{ guildId: string }>;
}): ReactNode {
  use(params); // guild scope is enforced server-side from the session
  const [jobs, setJobs] = useState<SchedulerJob[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<ScheduleStatus | ''>('');
  const [kind, setKind] = useState('');
  const [selected, setSelected] = useState<SchedulerJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 20;

  const load = useCallback(() => {
    scheduler
      .jobs({ status: status || undefined, kind: kind || undefined, page, pageSize })
      .then((r) => {
        setJobs(r.items);
        setTotal(r.total);
      })
      .catch(() => setError('Failed to load schedules'));
  }, [status, kind, page]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <h2>Scheduler</h2>
      <HealthWidget />

      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <select
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value as ScheduleStatus | '');
          }}
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s === '' ? 'All statuses' : s}
            </option>
          ))}
        </select>
        <input
          placeholder="Filter by kind…"
          value={kind}
          onChange={(e) => {
            setPage(1);
            setKind(e.target.value);
          }}
        />
      </div>

      {error ? <p style={{ color: '#f87171' }}>{error}</p> : null}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>
            <th>Kind</th>
            <th>Type</th>
            <th>Status</th>
            <th>Next run</th>
            <th>Last run</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr
              key={job.id}
              onClick={() => setSelected(job)}
              style={{ cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.08)' }}
            >
              <td>{job.kind}</td>
              <td>{job.type}</td>
              <td>
                <StatusBadge status={job.status} />
              </td>
              <td>{fmt(job.nextRunAt)}</td>
              <td>{fmt(job.lastRunAt)}</td>
            </tr>
          ))}
          {jobs.length === 0 ? (
            <tr>
              <td colSpan={5} style={{ color: '#9ca3af', padding: 16 }}>
                No schedules
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16 }}>
        <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          ‹ Prev
        </button>
        <span>
          Page {page} / {totalPages}
        </span>
        <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
          Next ›
        </button>
      </div>

      <section style={{ marginTop: 32, fontSize: 13, color: '#9ca3af' }}>
        <h4>Configuration</h4>
        <p>
          Timezone and maintenance windows are stored under the guild settings
          (<code>scheduler</code> namespace) and require the{' '}
          <code>scheduler.config</code> claim to edit. Maintenance windows defer
          non-critical jobs until the window closes.
        </p>
      </section>

      {selected ? (
        <JobDrawer
          job={selected}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            load();
          }}
        />
      ) : null}
    </div>
  );
}
