/**
 * The audit log.
 *
 * Append-only. Every write to a business collection, every login and logout,
 * every change to a person's role or a role's permissions lands here with who
 * did it, when, and — for anything commercially sensitive — the value before
 * and after.
 *
 * It is readable only with `audit.view`, and nothing in the API deletes from
 * it. The trim below caps it at a size a JSON file can carry comfortably and
 * says so in the log itself rather than dropping rows silently.
 */
import { collection, newId, touch } from './store.js'
import type { Principal } from './rbac.js'
import { SENSITIVE_COLLECTIONS } from './rbac.js'

export type AuditAction =
  | 'login' | 'login.failed' | 'logout'
  | 'create' | 'update' | 'delete'
  | 'settings.update' | 'masters.update'
  | 'user.create' | 'user.update' | 'user.password' | 'user.deactivate'
  | 'role.create' | 'role.update' | 'role.delete'
  | 'backup.download' | 'backup.restore' | 'data.reset'
  | 'backup.schedule' | 'backup.run' | 'backup.auto' | 'backup.failed'
  | 'costing.export'
  | 'access.denied'

export interface AuditEntry {
  id: string
  at: string
  userId: string | null
  userName: string
  roleName: string
  action: AuditAction
  /** The collection or subsystem touched. */
  target: string
  /** The row id, where the action concerns one row. */
  recordId: string | null
  /** A short human sentence, so the log reads without decoding ids. */
  summary: string
  before: unknown
  after: unknown
  ip: string
  sensitive: boolean
}

const MAX_ENTRIES = 20_000

const entries = () => collection('auditLog') as unknown as AuditEntry[]

/** Fields never worth storing in an audit row, and one never safe to. */
const STRIP = new Set(['passwordHash', 'tokenHash'])

function sanitise(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map(sanitise)
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (STRIP.has(key)) { out[key] = '[redacted]'; continue }
      out[key] = sanitise(inner)
    }
    return out
  }
  return value
}

/** Only the fields that actually changed, so a row diff stays readable. */
function changedOnly(before: unknown, after: unknown): { before: unknown; after: unknown } {
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') {
    return { before: sanitise(before), after: sanitise(after) }
  }
  const b = before as Record<string, unknown>
  const a = after as Record<string, unknown>
  const beforeDiff: Record<string, unknown> = {}
  const afterDiff: Record<string, unknown> = {}
  for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (JSON.stringify(b[key]) !== JSON.stringify(a[key])) {
      beforeDiff[key] = b[key]
      afterDiff[key] = a[key]
    }
  }
  return { before: sanitise(beforeDiff), after: sanitise(afterDiff) }
}

export function record(input: {
  principal: Principal | null
  action: AuditAction
  target: string
  recordId?: string | null
  summary: string
  before?: unknown
  after?: unknown
  ip?: string
  /** Force the sensitive flag on, for actions outside the sensitive collections. */
  sensitive?: boolean
}): void {
  const diff = input.before !== undefined || input.after !== undefined
    ? changedOnly(input.before, input.after)
    : { before: null, after: null }

  const list = entries()
  list.push({
    id: newId('aud'),
    at: new Date().toISOString(),
    userId: input.principal?.userId ?? null,
    userName: input.principal?.userName ?? 'anonymous',
    roleName: input.principal?.roleName ?? '—',
    action: input.action,
    target: input.target,
    recordId: input.recordId ?? null,
    summary: input.summary,
    before: diff.before,
    after: diff.after,
    ip: input.ip ?? 'unknown',
    sensitive: input.sensitive
      ?? (SENSITIVE_COLLECTIONS as readonly string[]).includes(input.target),
  })

  // Trim the oldest, and leave a marker so a gap is never silent.
  if (list.length > MAX_ENTRIES) {
    const dropped = list.length - MAX_ENTRIES
    list.splice(0, dropped)
    list.unshift({
      id: newId('aud'),
      at: new Date().toISOString(),
      userId: null,
      userName: 'system',
      roleName: '—',
      action: 'update',
      target: 'auditLog',
      recordId: null,
      summary: `${dropped} older entries were trimmed to keep the log within ${MAX_ENTRIES} rows`,
      before: null,
      after: null,
      ip: 'local',
      sensitive: false,
    })
  }
  touch()
}

export function readLog(options: { limit?: number; sensitiveOnly?: boolean } = {}): AuditEntry[] {
  const list = [...entries()].reverse()
  const filtered = options.sensitiveOnly ? list.filter((e) => e.sensitive) : list
  return filtered.slice(0, options.limit ?? 500)
}
