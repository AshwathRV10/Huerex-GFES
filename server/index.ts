/**
 * HUEREX GFES API.
 *
 * Every route below is closed by default. A request reaches business data only
 * if it carries a valid session AND the caller's role grants the permission the
 * route declares — and even then, the response is filtered so commercial
 * figures never leave the process for someone not entitled to them.
 *
 * Three rules this file exists to keep:
 *   1. Authorise on the server. The UI hiding a field proves nothing.
 *   2. Redact the payload, do not merely gate the page.
 *   3. Write an audit row for anything that changes.
 */
import express from 'express'
import cors from 'cors'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  load, get, flush, touch, newId, isCollection, collection, replace,
  BUSINESS_COLLECTIONS, type CollectionName, type Doc,
} from './store.js'
import { buildSeed } from './seed.js'
import {
  PERMISSIONS, can, permissionForRead, permissionForWrite, isPermission,
  type Principal, type Role,
} from './rbac.js'
import {
  SESSION_COOKIE, adminRole, clearFailedLogins, clearedCookie, clientIp, createUser,
  endAllSessionsFor, endSession, ensureRoles, findUserByName, hashPassword, loginBlockedFor,
  needsBootstrap, noteFailedLogin, passwordProblem, principalFromRequest, pruneSessions,
  publicUser, readCookie, roles, sessionCookie, sessions, startSession, users,
  verifyPassword, type User,
} from './auth.js'
import { record, readLog } from './audit.js'
import { redactRow, redactSettings, redactState } from './redact.js'
import { broadcastChange, broadcastReload, broadcastSessionInvalidated, presence, subscribe } from './events.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PORT = Number(process.env.PORT ?? 5274)
/** Set HUEREX_SECURE_COOKIES=1 when serving over HTTPS. */
const SECURE_COOKIES = process.env.HUEREX_SECURE_COOKIES === '1'

load()
ensureRoles()
if (get().collections.orders.length === 0 && Object.keys(get().singletons.masters ?? {}).length === 0) {
  const seeded = buildSeed()
  // Keep any accounts and roles that already exist; only business data is seeded.
  for (const name of BUSINESS_COLLECTIONS) get().collections[name] = seeded.collections[name] ?? []
  get().singletons = { ...get().singletons, ...seeded.singletons }
  ensureRoles()
  flush()
  console.log('[api] first run — imported the HUEREX GFES V5.1 workbook')
}
pruneSessions()
setInterval(pruneSessions, 10 * 60 * 1000).unref?.()

const app = express()
app.set('trust proxy', true)
app.disable('x-powered-by')
app.use(cors({ origin: true, credentials: true }))
app.use(express.json({ limit: '32mb' }))

const ok = (res: express.Response, body: unknown) => res.json({ ok: true, data: body })
const bad = (res: express.Response, code: number, message: string) =>
  res.status(code).json({ ok: false, error: message })

/* ── Request context ─────────────────────────────────────────────────── */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { principal: Principal | null }
  }
}

app.use((req, _res, next) => {
  req.principal = principalFromRequest(req)
  next()
})

/**
 * Rejects a cross-site write even if a cookie rides along. SameSite=Lax already
 * covers most of it; this closes the rest without needing a CSRF token, because
 * the SPA and the API share an origin.
 */
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next()
  const origin = req.headers.origin
  if (!origin) return next()                       // curl, native clients
  const host = req.headers.host
  try {
    if (new URL(origin).host !== host) {
      return bad(res, 403, 'Cross-site requests are not accepted')
    }
  } catch {
    return bad(res, 403, 'Malformed Origin header')
  }
  next()
})

/** Guards a route with a permission. Denials are audited, not silent. */
const requirePermission = (permission: string): express.RequestHandler => (req, res, next) => {
  if (!req.principal) return bad(res, 401, 'Sign in to continue')
  if (!can(req.principal, permission)) {
    record({
      principal: req.principal,
      action: 'access.denied',
      target: permission,
      summary: `Denied ${req.method} ${req.path} — role "${req.principal.roleName}" lacks ${permission}`,
      ip: clientIp(req),
      sensitive: permission.startsWith('costing.') || permission.startsWith('admin.'),
    })
    return bad(res, 403, 'Your role does not allow that')
  }
  next()
}

const requireSignedIn: express.RequestHandler = (req, res, next) =>
  req.principal ? next() : bad(res, 401, 'Sign in to continue')

/* ── Session ─────────────────────────────────────────────────────────── */

/** Open endpoint: tells the login screen whether an admin must be created. */
app.get('/api/auth/status', (req, res) => ok(res, {
  needsBootstrap: needsBootstrap(),
  signedIn: !!req.principal,
  user: req.principal ? { userName: req.principal.userName, roleName: req.principal.roleName } : null,
}))

/** First run only: creates the first administrator. Refused once one exists. */
app.post('/api/auth/bootstrap', (req, res) => {
  if (!needsBootstrap()) return bad(res, 409, 'An account already exists — sign in instead')
  const userName = String(req.body?.userName ?? '').trim()
  const displayName = String(req.body?.displayName ?? '').trim()
  const password = String(req.body?.password ?? '')
  if (!/^[a-z0-9._-]{3,32}$/i.test(userName)) {
    return bad(res, 400, 'Username must be 3–32 characters: letters, digits, dot, dash or underscore')
  }
  const problem = passwordProblem(password, userName)
  if (problem) return bad(res, 400, problem)

  const role = adminRole()
  const user = createUser({ userName, displayName, password, roleId: role.id })
  const token = startSession(user, clientIp(req), String(req.headers['user-agent'] ?? ''))
  record({
    principal: null, action: 'user.create', target: 'users', recordId: user.id,
    summary: `First administrator "${user.userName}" created`, ip: clientIp(req), sensitive: true,
  })
  flush()
  res.setHeader('Set-Cookie', sessionCookie(token, SECURE_COOKIES))
  ok(res, { user: publicUser(user) })
})

app.post('/api/auth/login', (req, res) => {
  const userName = String(req.body?.userName ?? '').trim().toLowerCase()
  const password = String(req.body?.password ?? '')
  const ip = clientIp(req)
  const throttleKey = `${ip}|${userName}`

  const blockedFor = loginBlockedFor(throttleKey)
  if (blockedFor > 0) {
    return bad(res, 429, `Too many attempts. Try again in ${Math.ceil(blockedFor / 60)} minute(s).`)
  }

  const user = findUserByName(userName)
  // Same reply whether the user is unknown, the password is wrong, or the
  // account is off — so the endpoint cannot be used to enumerate accounts.
  const failed = () => {
    noteFailedLogin(throttleKey)
    record({
      principal: null, action: 'login.failed', target: 'auth',
      summary: `Failed sign-in for "${userName}"`, ip, sensitive: true,
    })
    flush()
    return bad(res, 401, 'That username and password do not match')
  }
  if (!user || !user.active) return failed()
  if (!verifyPassword(password, user.passwordHash)) return failed()

  clearFailedLogins(throttleKey)
  const token = startSession(user, ip, String(req.headers['user-agent'] ?? ''))
  record({
    principal: null, action: 'login', target: 'auth', recordId: user.id,
    summary: `${user.displayName || user.userName} signed in`, ip,
  })
  flush()
  res.setHeader('Set-Cookie', sessionCookie(token, SECURE_COOKIES))
  ok(res, { user: publicUser(user), mustChangePassword: user.mustChangePassword })
})

app.post('/api/auth/logout', (req, res) => {
  if (req.principal) {
    record({
      principal: req.principal, action: 'logout', target: 'auth',
      summary: `${req.principal.userName} signed out`, ip: clientIp(req),
    })
  }
  endSession(readCookie(req, SESSION_COOKIE))
  flush()
  res.setHeader('Set-Cookie', clearedCookie())
  ok(res, { signedOut: true })
})

/** Who am I, and what may I do. The client's entire gating derives from this. */
app.get('/api/auth/me', requireSignedIn, (req, res) => {
  const principal = req.principal!
  ok(res, {
    userId: principal.userId,
    userName: principal.userName,
    roleId: principal.roleId,
    roleName: principal.roleName,
    permissions: [...principal.permissions],
    catalogue: PERMISSIONS,
  })
})

app.post('/api/auth/password', requireSignedIn, (req, res) => {
  const principal = req.principal!
  const current = String(req.body?.currentPassword ?? '')
  const next = String(req.body?.newPassword ?? '')
  const user = users().find((u) => u.id === principal.userId)
  if (!user) return bad(res, 404, 'Account not found')
  if (!verifyPassword(current, user.passwordHash)) return bad(res, 401, 'Your current password is wrong')
  const problem = passwordProblem(next, user.userName)
  if (problem) return bad(res, 400, problem)

  user.passwordHash = hashPassword(next)
  user.mustChangePassword = false
  touch()
  record({
    principal, action: 'user.password', target: 'users', recordId: user.id,
    summary: `${user.userName} changed their own password`, ip: clientIp(req), sensitive: true,
  })
  // Every other session for this account is dropped; this one keeps working.
  const thisToken = readCookie(req, SESSION_COOKIE)
  const keep = sessions().find((s) => s.userId === user.id && thisToken)
  endAllSessionsFor(user.id)
  if (keep && thisToken) {
    const fresh = startSession(user, clientIp(req), String(req.headers['user-agent'] ?? ''))
    res.setHeader('Set-Cookie', sessionCookie(fresh, SECURE_COOKIES))
  }
  flush()
  ok(res, { changed: true })
})

/* ── Live sync ───────────────────────────────────────────────────────── */

app.get('/api/events', requireSignedIn, (req, res) => {
  const cleanup = subscribe(res, req.principal!)
  req.on('close', cleanup)
})

app.get('/api/presence', requireSignedIn, (_req, res) => ok(res, presence()))

/* ── Whole state ─────────────────────────────────────────────────────── */

app.get('/api/state', requireSignedIn, (req, res) => {
  const db = get()
  ok(res, {
    collections: redactState(db.collections as never, req.principal),
    masters: can(req.principal, 'masters.view') ? db.singletons.masters : {},
    settings: redactSettings(db.singletons.settings ?? {}, req.principal),
    processTypes: db.singletons.processTypes,
    updatedAt: db.updatedAt,
  })
})

/* ── Settings, process types ─────────────────────────────────────────── */

app.put('/api/process-types', requirePermission('admin.settings'), (req, res) => {
  const before = get().singletons.processTypes
  get().singletons.processTypes = req.body ?? {}
  touch()
  record({
    principal: req.principal, action: 'settings.update', target: 'processTypes',
    summary: 'Changed which processes are outsourced', before, after: get().singletons.processTypes,
    ip: clientIp(req),
  })
  flush()
  broadcastReload('processTypes', req.principal)
  ok(res, get().singletons.processTypes)
})

app.patch('/api/settings', requirePermission('admin.settings'), (req, res) => {
  const before = { ...(get().singletons.settings ?? {}) }
  get().singletons.settings = { ...before, ...req.body }
  touch()
  record({
    principal: req.principal, action: 'settings.update', target: 'settings',
    summary: 'Updated settings', before, after: get().singletons.settings, ip: clientIp(req),
  })
  flush()
  broadcastReload('settings', req.principal)
  ok(res, get().singletons.settings)
})

/* ── Housekeeping ────────────────────────────────────────────────────── */

app.get('/api/backup', requirePermission('admin.backup'), (req, res) => {
  flush()
  record({
    principal: req.principal, action: 'backup.download', target: 'database',
    summary: 'Downloaded a full backup', ip: clientIp(req), sensitive: true,
  })
  const copy = structuredClone(get()) as { collections: Record<string, unknown[]> }
  // A backup is for restoring data, not for lifting credentials out of.
  copy.collections.users = (copy.collections.users as Record<string, unknown>[]).map((u) => ({
    ...u, passwordHash: '[excluded from backup]',
  }))
  copy.collections.sessions = []
  res.setHeader('Content-Disposition', `attachment; filename="huerex-${new Date().toISOString().slice(0, 10)}.json"`)
  res.json(copy)
})

app.post('/api/restore', requirePermission('admin.backup'), (req, res) => {
  if (!req.body?.collections) return bad(res, 400, 'That does not look like a HUEREX backup')
  const keptUsers = [...users()]
  const keptRoles = [...roles()]
  replace(req.body)
  // Accounts are never replaced by a restore — the file has no usable hashes,
  // and locking everybody out of their own system would be a poor trade.
  get().collections.users = keptUsers as never
  get().collections.roles = keptRoles as never
  get().collections.sessions = []
  record({
    principal: req.principal, action: 'backup.restore', target: 'database',
    summary: 'Restored the database from a backup file (accounts kept)', ip: clientIp(req), sensitive: true,
  })
  flush()
  broadcastReload('all', req.principal)
  ok(res, { restored: true })
})

app.post('/api/reset', requirePermission('admin.backup'), (req, res) => {
  const seeded = buildSeed()
  for (const name of BUSINESS_COLLECTIONS) get().collections[name] = seeded.collections[name] ?? []
  get().singletons = { ...get().singletons, ...seeded.singletons }
  touch()
  record({
    principal: req.principal, action: 'data.reset', target: 'database',
    summary: 'Reset business data back to the imported workbook', ip: clientIp(req), sensitive: true,
  })
  flush()
  broadcastReload('all', req.principal)
  ok(res, { reset: true })
})

app.get('/api/health', (_req, res) => ok(res, { status: 'up', updatedAt: get().updatedAt }))

/* ── Audit log ───────────────────────────────────────────────────────── */

app.get('/api/audit', requirePermission('audit.view'), (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 500) || 500, 5000)
  ok(res, readLog({ limit, sensitiveOnly: req.query.sensitive === '1' }))
})

/* ── People and roles ────────────────────────────────────────────────── */

app.get('/api/users', requirePermission('admin.users'), (_req, res) =>
  ok(res, users().map(publicUser)))

app.post('/api/users', requirePermission('admin.users'), (req, res) => {
  const userName = String(req.body?.userName ?? '').trim()
  const displayName = String(req.body?.displayName ?? '').trim()
  const password = String(req.body?.password ?? '')
  const roleId = String(req.body?.roleId ?? '')

  if (!/^[a-z0-9._-]{3,32}$/i.test(userName)) {
    return bad(res, 400, 'Username must be 3–32 characters: letters, digits, dot, dash or underscore')
  }
  if (findUserByName(userName)) return bad(res, 409, 'That username is taken')
  if (!roles().some((r) => r.id === roleId)) return bad(res, 400, 'Choose a role')
  const problem = passwordProblem(password, userName)
  if (problem) return bad(res, 400, problem)

  const user = createUser({ userName, displayName, password, roleId, mustChangePassword: true })
  record({
    principal: req.principal, action: 'user.create', target: 'users', recordId: user.id,
    summary: `Created "${user.userName}" as ${roles().find((r) => r.id === roleId)?.name}`,
    after: publicUser(user), ip: clientIp(req), sensitive: true,
  })
  flush()
  ok(res, publicUser(user))
})

app.patch('/api/users/:id', requirePermission('admin.users'), (req, res) => {
  const user = users().find((u) => u.id === req.params.id)
  if (!user) return bad(res, 404, 'No such user')
  const before = publicUser(user)
  const principal = req.principal!

  // An admin cannot lock themselves out or quietly demote themselves.
  const isSelf = user.id === principal.userId
  if (isSelf && req.body.active === false) return bad(res, 400, 'You cannot deactivate your own account')
  if (isSelf && req.body.roleId && req.body.roleId !== user.roleId) {
    return bad(res, 400, 'You cannot change your own role — ask another administrator')
  }
  if (req.body.roleId && !roles().some((r) => r.id === req.body.roleId)) {
    return bad(res, 400, 'No such role')
  }

  if (typeof req.body.displayName === 'string') user.displayName = req.body.displayName.trim()
  if (typeof req.body.active === 'boolean') user.active = req.body.active
  if (typeof req.body.roleId === 'string') user.roleId = req.body.roleId
  touch()

  // Changing a role or switching an account off takes effect immediately.
  if (before.roleId !== user.roleId || before.active !== user.active) {
    endAllSessionsFor(user.id)
    broadcastSessionInvalidated([user.id])
  }
  record({
    principal, action: user.active ? 'user.update' : 'user.deactivate', target: 'users', recordId: user.id,
    summary: `Updated "${user.userName}"`, before, after: publicUser(user),
    ip: clientIp(req), sensitive: true,
  })
  flush()
  ok(res, publicUser(user))
})

app.post('/api/users/:id/password', requirePermission('admin.users'), (req, res) => {
  const user = users().find((u) => u.id === req.params.id)
  if (!user) return bad(res, 404, 'No such user')
  const password = String(req.body?.password ?? '')
  const problem = passwordProblem(password, user.userName)
  if (problem) return bad(res, 400, problem)

  user.passwordHash = hashPassword(password)
  user.mustChangePassword = true
  touch()
  endAllSessionsFor(user.id)
  broadcastSessionInvalidated([user.id])
  record({
    principal: req.principal, action: 'user.password', target: 'users', recordId: user.id,
    summary: `Reset the password for "${user.userName}"; they must choose a new one`,
    ip: clientIp(req), sensitive: true,
  })
  flush()
  ok(res, { reset: true })
})

app.get('/api/roles', requireSignedIn, (req, res) => {
  // Only somebody administering users or roles has any reason to see the list.
  // Permissions themselves are shown only to a role administrator.
  if (!can(req.principal, 'admin.users') && !can(req.principal, 'admin.roles')) {
    record({
      principal: req.principal, action: 'access.denied', target: 'roles',
      summary: 'Denied reading the role list', ip: clientIp(req), sensitive: true,
    })
    return bad(res, 403, 'Your role does not allow that')
  }
  const showPermissions = can(req.principal, 'admin.roles')
  ok(res, roles().map((role) => ({
    id: role.id,
    name: role.name,
    description: role.description,
    builtIn: role.builtIn,
    locked: role.locked ?? false,
    permissions: showPermissions ? role.permissions : undefined,
    userCount: users().filter((u) => u.roleId === role.id).length,
  })))
})

app.post('/api/roles', requirePermission('admin.roles'), (req, res) => {
  const name = String(req.body?.name ?? '').trim()
  if (!name) return bad(res, 400, 'A role needs a name')
  if (roles().some((r) => r.name.toLowerCase() === name.toLowerCase())) {
    return bad(res, 409, 'A role with that name already exists')
  }
  const permissions = (Array.isArray(req.body?.permissions) ? req.body.permissions : [])
    .map(String).filter(isPermission)
  const role: Role = {
    id: newId('role'), name,
    description: String(req.body?.description ?? '').trim(),
    permissions, builtIn: false,
  }
  roles().push(role)
  touch()
  record({
    principal: req.principal, action: 'role.create', target: 'roles', recordId: role.id,
    summary: `Created role "${role.name}" with ${permissions.length} permission(s)`,
    after: role, ip: clientIp(req), sensitive: true,
  })
  flush()
  ok(res, role)
})

app.patch('/api/roles/:id', requirePermission('admin.roles'), (req, res) => {
  const role = roles().find((r) => r.id === req.params.id)
  if (!role) return bad(res, 404, 'No such role')
  if (role.locked && Array.isArray(req.body?.permissions)) {
    return bad(res, 400, 'The Administrator role always holds every permission and cannot be reduced')
  }
  const before = structuredClone(role)

  if (typeof req.body?.name === 'string' && req.body.name.trim()) role.name = req.body.name.trim()
  if (typeof req.body?.description === 'string') role.description = req.body.description.trim()
  if (Array.isArray(req.body?.permissions) && !role.locked) {
    role.permissions = req.body.permissions.map(String).filter(isPermission)
  }
  touch()

  // Everyone holding this role is signed out, so a narrowed permission set can
  // never be outlived by a session that predates it.
  const affected = users().filter((u) => u.roleId === role.id).map((u) => u.id)
  for (const id of affected) endAllSessionsFor(id)
  if (affected.length) broadcastSessionInvalidated(affected)

  record({
    principal: req.principal, action: 'role.update', target: 'roles', recordId: role.id,
    summary: `Updated role "${role.name}"`, before, after: role, ip: clientIp(req), sensitive: true,
  })
  flush()
  ok(res, role)
})

app.delete('/api/roles/:id', requirePermission('admin.roles'), (req, res) => {
  const list = roles()
  const index = list.findIndex((r) => r.id === req.params.id)
  if (index === -1) return bad(res, 404, 'No such role')
  const role = list[index]
  if (role.locked) return bad(res, 400, 'The Administrator role cannot be deleted')
  const holders = users().filter((u) => u.roleId === role.id)
  if (holders.length) {
    return bad(res, 409, `${holders.length} user(s) still hold that role — move them first`)
  }
  list.splice(index, 1)
  touch()
  record({
    principal: req.principal, action: 'role.delete', target: 'roles', recordId: role.id,
    summary: `Deleted role "${role.name}"`, before: role, ip: clientIp(req), sensitive: true,
  })
  flush()
  ok(res, role)
})

/* ── Masters ─────────────────────────────────────────────────────────── */

app.get('/api/masters', requirePermission('masters.view'), (_req, res) =>
  ok(res, get().singletons.masters))

app.post('/api/masters/:list', requirePermission('masters.create'), (req, res) => {
  const { list } = req.params
  const value = String(req.body?.value ?? '').trim()
  if (!value) return bad(res, 400, 'A value is required')
  if (value.length > 120) return bad(res, 400, 'That value is too long')
  const masters = (get().singletons.masters ||= {})
  const current: string[] = (masters[list] ||= [])
  const existing = current.find((v) => v.toLowerCase() === value.toLowerCase())
  if (!existing) {
    current.push(value)
    touch()
    record({
      principal: req.principal, action: 'masters.update', target: `masters.${list}`,
      summary: `Added "${value}" to ${list}`, after: value, ip: clientIp(req),
    })
    flush()
    broadcastReload('masters', req.principal)
  }
  ok(res, { list, value: existing ?? value, values: current, added: !existing })
})

app.delete('/api/masters/:list/:value', requirePermission('masters.manage'), (req, res) => {
  const { list } = req.params
  const value = decodeURIComponent(req.params.value)
  const masters = (get().singletons.masters ||= {})
  const current: string[] = (masters[list] ||= [])
  masters[list] = current.filter((v) => v.toLowerCase() !== value.toLowerCase())
  touch()
  record({
    principal: req.principal, action: 'masters.update', target: `masters.${list}`,
    summary: `Removed "${value}" from ${list}`, before: value, ip: clientIp(req),
  })
  flush()
  broadcastReload('masters', req.principal)
  ok(res, { list, values: masters[list] })
})

app.put('/api/masters/:list', requirePermission('masters.manage'), (req, res) => {
  const { list } = req.params
  if (!Array.isArray(req.body)) return bad(res, 400, 'Expected an array of values')
  const before = get().singletons.masters?.[list]
  ;(get().singletons.masters ||= {})[list] = req.body.map(String)
  touch()
  record({
    principal: req.principal, action: 'masters.update', target: `masters.${list}`,
    summary: `Replaced the ${list} list`, before, after: get().singletons.masters[list], ip: clientIp(req),
  })
  flush()
  broadcastReload('masters', req.principal)
  ok(res, get().singletons.masters[list])
})

/* ── Row CRUD ────────────────────────────────────────────────────────── */

const RESERVED = new Set([
  'state', 'masters', 'settings', 'process-types', 'backup', 'restore', 'reset',
  'health', 'auth', 'users', 'roles', 'audit', 'events', 'presence',
])

/**
 * Narrows a path segment to a writable business collection.
 *
 * Reserved endpoint names and the auth tables are refused here, so no request
 * can reach `users` or `sessions` through the generic row API.
 */
function isBusinessCollection(name: string): name is CollectionName {
  return !RESERVED.has(name) &&
    isCollection(name) &&
    (BUSINESS_COLLECTIONS as readonly string[]).includes(name)
}

/** Refuses the request when the segment is not a business collection. */
function businessCollection(name: string, res: express.Response): name is CollectionName {
  if (!isBusinessCollection(name)) {
    bad(res, 404, `Unknown collection "${name}"`)
    return false
  }
  return true
}

app.post('/api/:name', requireSignedIn, (req, res) => {
  const { name } = req.params
  if (!businessCollection(name, res)) return
  const permission = permissionForWrite(name, 'create')
  if (!permission || !can(req.principal, permission)) {
    record({
      principal: req.principal, action: 'access.denied', target: name,
      summary: `Denied creating a row in ${name}`, ip: clientIp(req),
    })
    return bad(res, 403, 'Your role does not allow that')
  }

  const rows = Array.isArray(req.body) ? req.body : [req.body]
  if (rows.length > 2000) return bad(res, 413, 'Too many rows in one request')
  const now = new Date().toISOString()
  const created = rows.map((row: Doc) => {
    const doc = { ...row, id: row.id || newId(name.slice(0, 3)), rev: 1, updatedAt: now }
    collection(name).push(doc)
    return doc
  })
  touch()
  for (const doc of created) {
    record({
      principal: req.principal, action: 'create', target: name, recordId: doc.id,
      summary: `Added a row to ${name}`, after: doc, ip: clientIp(req),
    })
    broadcastChange({
      collection: name, action: 'create', recordId: doc.id, row: doc,
      byUserId: req.principal!.userId, byUserName: req.principal!.userName,
      at: new Date().toISOString(),
    })
  }
  flush()
  ok(res, Array.isArray(req.body) ? created : created[0])
})

app.patch('/api/:name/:id', requireSignedIn, (req, res) => {
  const { name, id } = req.params
  if (!businessCollection(name, res)) return
  const permission = permissionForWrite(name, 'edit')
  if (!permission || !can(req.principal, permission)) {
    record({
      principal: req.principal, action: 'access.denied', target: name, recordId: id,
      summary: `Denied editing a row in ${name}`, ip: clientIp(req),
    })
    return bad(res, 403, 'Your role does not allow that')
  }

  const rows = collection(name)
  const index = rows.findIndex((r) => r.id === id)
  if (index === -1) return bad(res, 404, `No row ${id} in ${name}`)
  const before = structuredClone(rows[index])

  // Optimistic concurrency: a client that read an older copy is told to look
  // again rather than silently overwriting somebody else's edit. Sending no
  // expectation opts out, which is what a single-field inline edit does.
  const expected = req.body?.__expectedRev
  if (typeof expected === 'number' && typeof before.rev === 'number' && before.rev !== expected) {
    return res.status(409).json({
      ok: false,
      error: 'Somebody else changed this row while you were editing it',
      data: { current: redactRow(name, rows[index], req.principal) },
    })
  }
  const patch = { ...req.body }
  delete patch.__expectedRev

  rows[index] = {
    ...rows[index], ...patch, id,
    rev: (typeof before.rev === 'number' ? before.rev : 0) + 1,
    updatedAt: new Date().toISOString(),
  }
  touch()
  record({
    principal: req.principal, action: 'update', target: name, recordId: id,
    summary: `Edited a row in ${name}`, before, after: rows[index], ip: clientIp(req),
  })
  broadcastChange({
    collection: name, action: 'update', recordId: id, row: rows[index],
    byUserId: req.principal!.userId, byUserName: req.principal!.userName,
    at: new Date().toISOString(),
  })
  flush()
  ok(res, rows[index])
})

app.delete('/api/:name/:id', requireSignedIn, (req, res) => {
  const { name, id } = req.params
  if (!businessCollection(name, res)) return
  const permission = permissionForWrite(name, 'delete')
  if (!permission || !can(req.principal, permission)) {
    record({
      principal: req.principal, action: 'access.denied', target: name, recordId: id,
      summary: `Denied deleting a row from ${name}`, ip: clientIp(req),
    })
    return bad(res, 403, 'Your role does not allow that')
  }

  const rows = collection(name)
  const index = rows.findIndex((r) => r.id === id)
  if (index === -1) return bad(res, 404, `No row ${id} in ${name}`)
  const [removed] = rows.splice(index, 1)
  touch()
  record({
    principal: req.principal, action: 'delete', target: name, recordId: id,
    summary: `Deleted a row from ${name}`, before: removed, ip: clientIp(req),
  })
  broadcastChange({
    collection: name, action: 'delete', recordId: id, row: null,
    byUserId: req.principal!.userId, byUserName: req.principal!.userName,
    at: new Date().toISOString(),
  })
  flush()
  ok(res, removed)
})

app.put('/api/:name', requireSignedIn, (req, res) => {
  const { name } = req.params
  if (!businessCollection(name, res)) return
  const permission = permissionForWrite(name, 'edit')
  if (!permission || !can(req.principal, permission)) return bad(res, 403, 'Your role does not allow that')
  if (!Array.isArray(req.body)) return bad(res, 400, 'Expected an array of rows')

  const before = structuredClone(collection(name))
  get().collections[name] = req.body.map((r: Doc) => ({ ...r, id: r.id || newId(name.slice(0, 3)) }))
  touch()
  record({
    principal: req.principal, action: 'update', target: name,
    summary: `Replaced every row in ${name}`,
    before: { rows: before.length }, after: { rows: req.body.length }, ip: clientIp(req),
  })
  broadcastChange({
    collection: name, action: 'reload',
    byUserId: req.principal!.userId, byUserName: req.principal!.userName,
    at: new Date().toISOString(),
  })
  flush()
  ok(res, get().collections[name])
})

/* ── Read one collection, permission-checked and redacted ────────────── */

app.get('/api/:name', requireSignedIn, (req, res) => {
  const { name } = req.params
  if (!businessCollection(name, res)) return
  const permission = permissionForRead(name)
  if (permission && !can(req.principal, permission)) {
    record({
      principal: req.principal, action: 'access.denied', target: name,
      summary: `Denied reading ${name}`, ip: clientIp(req),
      sensitive: name === 'costings' || name === 'rateBook',
    })
    return bad(res, 403, 'Your role does not allow that')
  }
  const rows = collection(name)
    .map((row) => redactRow(name, row, req.principal))
    .filter((row): row is Doc => row !== null)
  ok(res, rows)
})

/* ── Serve the built app ─────────────────────────────────────────────── */

const dist = path.join(ROOT, 'dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false }))
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')))
}

app.listen(PORT, () => {
  console.log(`  HUEREX GFES api  →  http://localhost:${PORT}`)
  if (needsBootstrap()) console.log('  first run — open the app to create the administrator account')
  if (!fs.existsSync(dist)) console.log(`  web (vite dev)   →  http://localhost:5273`)
})

export type { User }
