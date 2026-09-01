/** Thin fetch wrapper over the HUEREX API. Every call returns parsed data. */
import type { CollectionKey, Masters, Settings } from './types'
import type { ProcessTypes } from './engine/production'

const BASE = '/api'

class ApiError extends Error {
  /** A 409 carries the row as it now stands, so the caller can show the conflict. */
  payload?: unknown
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ApiError'
  }
}

/** True when the server refused a write because somebody else got there first. */
export const isConflict = (error: unknown): error is ApiError =>
  error instanceof ApiError && error.status === 409

/** Called when the server says the session is gone, so the app can react once. */
let onUnauthenticated: (() => void) | null = null
export const setUnauthenticatedHandler = (fn: () => void) => { onUnauthenticated = fn }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      // Send the session cookie, including in dev where vite proxies the API.
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
  } catch {
    throw new ApiError('Cannot reach the HUEREX server — is it running?', 0)
  }
  const body = await response.json().catch(() => null)
  if (response.status === 401) {
    onUnauthenticated?.()
    throw new ApiError(body?.error ?? 'Sign in to continue', 401)
  }
  if (!response.ok || body?.ok === false) {
    const error = new ApiError(body?.error ?? `Request failed (${response.status})`, response.status)
    error.payload = body?.data
    throw error
  }
  return body.data as T
}

export interface BackupSettings {
  enabled: boolean
  folder: string
  hour: number
  minute: number
  keep: number
}

export interface BackupStatus {
  lastAt: string | null
  lastPath: string | null
  lastBytes: number | null
  lastError: string | null
  lastReason: string | null
}

export interface BackupSchedule {
  settings: BackupSettings
  status: BackupStatus
  defaults: BackupSettings
}

export interface ServerState {
  collections: Record<string, any[]>
  masters: Masters
  settings: Settings
  processTypes: ProcessTypes
  updatedAt: string
}

export interface SessionInfo {
  userId: string
  userName: string
  roleId: string
  roleName: string
  permissions: string[]
  catalogue: PermissionDef[]
}

export interface PermissionDef {
  key: string
  module: string
  label: string
  detail: string
  sensitive?: boolean
}

export interface AccountSummary {
  id: string
  userName: string
  displayName: string
  roleId: string
  roleName: string
  active: boolean
  createdAt: string
  lastLoginAt: string | null
  mustChangePassword: boolean
}

export interface RoleSummary {
  id: string
  name: string
  description: string
  builtIn: boolean
  locked: boolean
  permissions?: string[]
  userCount: number
}

export interface AuditEntry {
  id: string
  at: string
  userId: string | null
  userName: string
  roleName: string
  action: string
  target: string
  recordId: string | null
  summary: string
  before: unknown
  after: unknown
  ip: string
  sensitive: boolean
}

export interface PresenceEntry { userId: string; userName: string; roleName: string; since: string }

export const api = {
  /* ── Session ──────────────────────────────────────────────────────── */
  authStatus: () => request<{ needsBootstrap: boolean; signedIn: boolean; user: { userName: string; roleName: string } | null }>('/auth/status'),
  bootstrap: (input: { userName: string; displayName: string; password: string }) =>
    request<{ user: AccountSummary }>('/auth/bootstrap', { method: 'POST', body: JSON.stringify(input) }),
  login: (userName: string, password: string) =>
    request<{ user: AccountSummary; mustChangePassword: boolean }>('/auth/login', {
      method: 'POST', body: JSON.stringify({ userName, password }),
    }),
  logout: () => request<{ signedOut: boolean }>('/auth/logout', { method: 'POST' }),
  me: () => request<SessionInfo>('/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ changed: boolean }>('/auth/password', {
      method: 'POST', body: JSON.stringify({ currentPassword, newPassword }),
    }),

  /* ── People and roles ─────────────────────────────────────────────── */
  listUsers: () => request<AccountSummary[]>('/users'),
  createAccount: (input: { userName: string; displayName: string; password: string; roleId: string }) =>
    request<AccountSummary>('/users', { method: 'POST', body: JSON.stringify(input) }),
  updateAccount: (id: string, patch: Partial<Pick<AccountSummary, 'displayName' | 'active' | 'roleId'>>) =>
    request<AccountSummary>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  resetPassword: (id: string, password: string) =>
    request<{ reset: boolean }>(`/users/${id}/password`, { method: 'POST', body: JSON.stringify({ password }) }),

  listRoles: () => request<RoleSummary[]>('/roles'),
  createRole: (input: { name: string; description: string; permissions: string[] }) =>
    request<RoleSummary>('/roles', { method: 'POST', body: JSON.stringify(input) }),
  updateRole: (id: string, patch: { name?: string; description?: string; permissions?: string[] }) =>
    request<RoleSummary>(`/roles/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteRole: (id: string) => request<RoleSummary>(`/roles/${id}`, { method: 'DELETE' }),

  /* ── Accountability and presence ──────────────────────────────────── */
  audit: (options: { limit?: number; sensitiveOnly?: boolean } = {}) =>
    request<AuditEntry[]>(`/audit?limit=${options.limit ?? 500}${options.sensitiveOnly ? '&sensitive=1' : ''}`),
  presence: () => request<PresenceEntry[]>('/presence'),

  getState: () => request<ServerState>('/state'),

  create: <T>(collection: CollectionKey, row: Partial<T>) =>
    request<T>(`/${collection}`, { method: 'POST', body: JSON.stringify(row) }),

  createMany: <T>(collection: CollectionKey, rows: Partial<T>[]) =>
    request<T[]>(`/${collection}`, { method: 'POST', body: JSON.stringify(rows) }),

  /**
   * `expectRev` opts the write into the version check: the server refuses with
   * 409, rather than silently overwriting, if the row has moved on since the
   * copy the caller is editing. Leave it out and last write wins, which is what
   * a floor operator ticking a box actually wants.
   */
  update: <T>(collection: CollectionKey, id: string, patch: Partial<T>, expectRev?: number) =>
    request<T>(`/${collection}/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(expectRev === undefined ? patch : { ...patch, __expectedRev: expectRev }),
    }),

  remove: (collection: CollectionKey, id: string) =>
    request<unknown>(`/${collection}/${id}`, { method: 'DELETE' }),

  replaceAll: <T>(collection: CollectionKey, rows: T[]) =>
    request<T[]>(`/${collection}`, { method: 'PUT', body: JSON.stringify(rows) }),

  addMaster: (list: string, value: string) =>
    request<{ list: string; value: string; values: string[]; added: boolean }>(
      `/masters/${encodeURIComponent(list)}`,
      { method: 'POST', body: JSON.stringify({ value }) },
    ),

  removeMaster: (list: string, value: string) =>
    request<{ list: string; values: string[] }>(
      `/masters/${encodeURIComponent(list)}/${encodeURIComponent(value)}`,
      { method: 'DELETE' },
    ),

  replaceMaster: (list: string, values: string[]) =>
    request<string[]>(`/masters/${encodeURIComponent(list)}`, { method: 'PUT', body: JSON.stringify(values) }),

  patchSettings: (patch: Partial<Settings>) =>
    request<Settings>('/settings', { method: 'PATCH', body: JSON.stringify(patch) }),

  setProcessTypes: (types: ProcessTypes) =>
    request<ProcessTypes>('/process-types', { method: 'PUT', body: JSON.stringify(types) }),

  backupUrl: `${BASE}/backup`,

  restore: (database: unknown) =>
    request<{ restored: boolean }>('/restore', { method: 'POST', body: JSON.stringify(database) }),

  backupSchedule: () => request<BackupSchedule>('/backup/schedule'),

  saveBackupSchedule: (patch: Partial<BackupSettings>) =>
    request<BackupSchedule>('/backup/schedule', { method: 'PATCH', body: JSON.stringify(patch) }),

  runBackup: () => request<BackupStatus>('/backup/run', { method: 'POST' }),
}

export { ApiError }
