/**
 * Minimal typed client for the Dashboard Backend BFF. In the full build this
 * file is GENERATED from the backend OpenAPI document (`npm run gen:client`);
 * the hand-written shape below mirrors the contracts in
 * `src/dashboard/backend/interfaces` so pages are type-safe today and the
 * generated client is a drop-in replacement.
 */

export interface DashboardUser {
  discordId: string;
  username: string;
  globalName: string | null;
  avatarHash: string | null;
  isBotOwner: boolean;
  /** Discord application client id — used to build the bot invite link. */
  clientId: string;
}

export interface ManageableGuild {
  guildId: string;
  name: string;
  iconHash: string | null;
  botPresent: boolean;
  hasManage: boolean;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (res.status === 401) throw new ApiError(401, 'Unauthorized');
  if (!res.ok) throw new ApiError(res.status, await safeText(res));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return res.statusText;
  }
}

// ─── Scheduler (bot API under /api/v1/scheduler) ───────────────────────────

export type ScheduleStatus =
  'pending' | 'active' | 'paused' | 'completed' | 'cancelled' | 'failed';

export interface SchedulerJob {
  id: string;
  kind: string;
  guildId: string | null;
  type: 'once' | 'recurring';
  status: ScheduleStatus;
  cron?: string | null;
  everyMs?: number | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
}

export interface SchedulerRun {
  id: string;
  attempt: number;
  status: ScheduleStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  error: string | null;
}

export interface SchedulerHealth {
  queueDepth: number;
  dlqSize: number;
  lastReconcileAt: string | null;
  workerUp: boolean;
}

interface SchedulerPaginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

function schedulerQuery(
  params: Record<string, string | number | undefined>,
): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const scheduler = {
  jobs: (
    filters: {
      kind?: string;
      status?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) =>
    request<SchedulerPaginated<SchedulerJob>>(
      `/api/v1/scheduler/jobs${schedulerQuery(filters)}`,
    ),
  job: (id: string) => request<SchedulerJob>(`/api/v1/scheduler/jobs/${id}`),
  runs: (id: string, page = 1, pageSize = 10) =>
    request<SchedulerPaginated<SchedulerRun>>(
      `/api/v1/scheduler/jobs/${id}/runs${schedulerQuery({ page, pageSize })}`,
    ),
  health: () => request<SchedulerHealth>('/api/v1/scheduler/health'),
  pause: (id: string) =>
    request<{ ok: boolean }>(`/api/v1/scheduler/jobs/${id}/pause`, {
      method: 'POST',
    }),
  resume: (id: string) =>
    request<{ ok: boolean }>(`/api/v1/scheduler/jobs/${id}/resume`, {
      method: 'POST',
    }),
  trigger: (id: string) =>
    request<{ ok: boolean }>(`/api/v1/scheduler/jobs/${id}/trigger`, {
      method: 'POST',
    }),
  cancel: (id: string) =>
    request<{ ok: boolean }>(`/api/v1/scheduler/jobs/${id}`, {
      method: 'DELETE',
    }),
};

// ─── Audit (bot API under /api/v1/audit) ────────────────────────────────────

export type AuditExportFormat = 'json' | 'ndjson' | 'csv';

export interface AuditEntryView {
  id: string;
  scope: 'GUILD' | 'GLOBAL';
  guildId: string | null;
  seq: string;
  action: string;
  source: 'COMMAND' | 'DASHBOARD' | 'API' | 'JOB' | 'SYSTEM' | 'EVENT';
  actorId: string | null;
  actorType: 'USER' | 'SYSTEM' | 'BOT';
  targetType: string | null;
  targetId: string | null;
  channelId: string | null;
  correlationId: string;
  causationId: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  previousHash: string | null;
  hash: string;
  occurredAt: string;
  createdAt: string;
}

export interface AuditFilters {
  actorId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  correlationId?: string;
  source?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface ChainVerification {
  scope: 'GUILD' | 'GLOBAL';
  guildId: string | null;
  checked: number;
  valid: boolean;
  firstBrokenSeq: string | null;
  verifiedAt: string;
}

export interface AuditRetentionConfig {
  retentionDays: number;
  archiveBeforeDelete: boolean;
  archiveFormat: AuditExportFormat;
}

export interface AuditHealth {
  queueDepth: number;
  dlqSize: number;
  ingestEnabled: boolean;
}

interface AuditPaginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export const audit = {
  entries: (filters: AuditFilters = {}) =>
    request<AuditPaginated<AuditEntryView>>(
      `/api/v1/audit/entries${schedulerQuery(filters as Record<string, string | number | undefined>)}`,
    ),
  trace: (correlationId: string) =>
    request<AuditEntryView[]>(
      `/api/v1/audit/correlations/${encodeURIComponent(correlationId)}`,
    ),
  verify: () => request<ChainVerification>('/api/v1/audit/verify'),
  retention: () => request<AuditRetentionConfig>('/api/v1/audit/retention'),
  updateRetention: (patch: Partial<AuditRetentionConfig>) =>
    request<AuditRetentionConfig>('/api/v1/audit/retention', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  health: () => request<AuditHealth>('/api/v1/audit/health'),
  /** Downloads an export; returns the raw response for blob handling. */
  export: async (
    format: AuditExportFormat,
    filters: Omit<AuditFilters, 'page' | 'pageSize'> = {},
  ): Promise<Blob> => {
    const res = await fetch('/api/v1/audit/export', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ format, ...filters }),
    });
    if (!res.ok) throw new ApiError(res.status, await safeText(res));
    return res.blob();
  },
};

// ─── Dashboard resource types (mirror backend/interfaces) ──────────────────

export interface GuildOverview {
  guildId: string;
  modules: { total: number };
  recentActivity: Array<{
    action: string;
    actorId: string;
    target: string | null;
    at: string;
  }>;
}

export interface DashboardApiKeyView {
  id: string;
  guildId: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreatedDashboardApiKey extends DashboardApiKeyView {
  /** Raw key — shown exactly once, never returned again. */
  plaintext: string;
}

export interface BackupView {
  id: string;
  guildId: string;
  status: string;
  jobId: string | null;
  sizeBytes: number | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

function pageQuery(page?: number, pageSize?: number): string {
  const q = new URLSearchParams();
  if (page) q.set('page', String(page));
  if (pageSize) q.set('pageSize', String(pageSize));
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const api = {
  me: () => request<DashboardUser>('/api/dashboard/auth/me'),
  logout: () => request<void>('/api/dashboard/auth/logout', { method: 'POST' }),
  guilds: () => request<ManageableGuild[]>('/api/dashboard/guilds'),

  overview: (guildId: string) =>
    request<GuildOverview>(`/api/dashboard/guilds/${guildId}/overview`),

  apiKeys: {
    list: (guildId: string, page = 1, pageSize = 50) =>
      request<Paginated<DashboardApiKeyView>>(
        `/api/dashboard/guilds/${guildId}/api-keys${pageQuery(page, pageSize)}`,
      ),
    create: (
      guildId: string,
      body: { name: string; scopes: string[]; expiresAt?: string | null },
    ) =>
      request<CreatedDashboardApiKey>(
        `/api/dashboard/guilds/${guildId}/api-keys`,
        { method: 'POST', body: JSON.stringify(body) },
      ),
    revoke: (guildId: string, id: string) =>
      request<void>(`/api/dashboard/guilds/${guildId}/api-keys/${id}`, {
        method: 'DELETE',
      }),
  },

  backups: {
    list: (guildId: string, page = 1, pageSize = 50) =>
      request<Paginated<BackupView>>(
        `/api/dashboard/guilds/${guildId}/backups${pageQuery(page, pageSize)}`,
      ),
    request: (guildId: string) =>
      request<BackupView>(`/api/dashboard/guilds/${guildId}/backups`, {
        method: 'POST',
      }),
    get: (guildId: string, id: string) =>
      request<BackupView>(`/api/dashboard/guilds/${guildId}/backups/${id}`),
  },

  realtimeTicket: () =>
    request<{ ticket: string }>('/api/dashboard/realtime/ticket'),
  scheduler,
  audit,
};
