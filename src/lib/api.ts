/** Thin fetch wrapper over the HUEREX API. Every call returns parsed data. */
import type { CollectionKey, Masters, Settings } from './types'
import type { ProcessTypes } from './engine/production'

const BASE = '/api'

class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
  } catch {
    throw new ApiError('Cannot reach the HUEREX server — is it running?', 0)
  }
  const body = await response.json().catch(() => null)
  if (!response.ok || body?.ok === false) {
    throw new ApiError(body?.error ?? `Request failed (${response.status})`, response.status)
  }
  return body.data as T
}

export interface ServerState {
  collections: Record<string, any[]>
  masters: Masters
  settings: Settings
  processTypes: ProcessTypes
  updatedAt: string
}

export const api = {
  getState: () => request<ServerState>('/state'),

  create: <T>(collection: CollectionKey, row: Partial<T>) =>
    request<T>(`/${collection}`, { method: 'POST', body: JSON.stringify(row) }),

  createMany: <T>(collection: CollectionKey, rows: Partial<T>[]) =>
    request<T[]>(`/${collection}`, { method: 'POST', body: JSON.stringify(rows) }),

  update: <T>(collection: CollectionKey, id: string, patch: Partial<T>) =>
    request<T>(`/${collection}/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

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
}

export { ApiError }
