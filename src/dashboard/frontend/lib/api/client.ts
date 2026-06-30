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

export const api = {
  me: () => request<DashboardUser>('/api/dashboard/auth/me'),
  logout: () => request<void>('/api/dashboard/auth/logout', { method: 'POST' }),
  guilds: () => request<ManageableGuild[]>('/api/dashboard/guilds'),
  overview: (guildId: string) =>
    request<unknown>(`/api/dashboard/guilds/${guildId}/overview`),
  apiKeys: (guildId: string) =>
    request<Paginated<unknown>>(`/api/dashboard/guilds/${guildId}/api-keys`),
  realtimeTicket: () =>
    request<{ ticket: string }>('/api/dashboard/realtime/ticket'),
};
