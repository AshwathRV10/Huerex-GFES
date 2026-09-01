/**
 * Authentication.
 *
 * Passwords are hashed with scrypt and a per-user salt — never stored, never
 * logged, never returned by any endpoint. Sessions are opaque random tokens;
 * only their SHA-256 hash is kept, so a stolen copy of the database still does
 * not let anyone log in as somebody else.
 *
 * Everything here uses node:crypto. No external dependency handles a password
 * in this application.
 */
import crypto from 'node:crypto'
import type { Request } from 'express'
import { collection, newId, touch } from './store.js'
import { DEFAULT_ROLES, isPermission, type Principal, type Role } from './rbac.js'

export const SESSION_COOKIE = 'huerex_session'
const SESSION_TTL_MS = 12 * 60 * 60 * 1000        // a working day
const SESSION_IDLE_MS = 4 * 60 * 60 * 1000        // logged out after this long idle

/* ── Password hashing ────────────────────────────────────────────────── */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 }

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16)
  const derived = crypto.scryptSync(password.normalize('NFKC'), salt, SCRYPT.keylen, SCRYPT)
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${derived.toString('base64')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, n, r, p, saltB64, hashB64] = stored.split('$')
    if (scheme !== 'scrypt') return false
    const salt = Buffer.from(saltB64, 'base64')
    const expected = Buffer.from(hashB64, 'base64')
    const derived = crypto.scryptSync(password.normalize('NFKC'), salt, expected.length, {
      N: Number(n), r: Number(r), p: Number(p),
    })
    // Constant time, so a wrong password cannot be found by measuring the reply.
    return crypto.timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}

/** Rejects the passwords that make an account worth attacking. */
export function passwordProblem(password: string, userName: string): string | null {
  if (password.length < 10) return 'Use at least 10 characters'
  if (password.length > 200) return 'That is longer than 200 characters'
  if (/^\d+$/.test(password)) return 'Digits alone are too easy to guess — add letters'
  if (password.toLowerCase().includes(userName.toLowerCase()) && userName.length >= 4) {
    return 'Do not put the username in the password'
  }
  const common = ['password', '12345678', 'qwerty', 'huerex', 'admin123', 'letmein', 'welcome']
  if (common.some((c) => password.toLowerCase().includes(c))) return 'That contains a very common password'
  return null
}

/* ── Users and roles ─────────────────────────────────────────────────── */

export interface User {
  id: string
  userName: string
  displayName: string
  passwordHash: string
  roleId: string
  active: boolean
  createdAt: string
  lastLoginAt: string | null
  /** Set when an admin resets a password and the user must choose a new one. */
  mustChangePassword: boolean
}

export interface Session {
  id: string
  tokenHash: string
  userId: string
  createdAt: string
  lastSeenAt: string
  expiresAt: string
  ip: string
  userAgent: string
}

export const users = () => collection('users') as unknown as User[]
export const roles = () => collection('roles') as unknown as Role[]
export const sessions = () => collection('sessions') as unknown as Session[]

/** Creates the built-in roles the first time the server starts. */
export function ensureRoles(): void {
  const existing = roles()
  if (existing.length > 0) return
  for (const role of DEFAULT_ROLES) {
    existing.push({ ...role, id: newId('role'), permissions: [...role.permissions] })
  }
  touch()
}

export const adminRole = () => roles().find((r) => r.locked) ?? roles()[0]

/** True until somebody has created the first account. */
export const needsBootstrap = () => users().length === 0

export function createUser(input: {
  userName: string
  displayName: string
  password: string
  roleId: string
  mustChangePassword?: boolean
}): User {
  const user: User = {
    id: newId('usr'),
    userName: input.userName.trim().toLowerCase(),
    displayName: input.displayName.trim() || input.userName.trim(),
    passwordHash: hashPassword(input.password),
    roleId: input.roleId,
    active: true,
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
    mustChangePassword: input.mustChangePassword ?? false,
  }
  users().push(user as never)
  touch()
  return user
}

export const findUserByName = (userName: string) =>
  users().find((u) => u.userName === userName.trim().toLowerCase())

/** The public shape of a user — never includes the password hash. */
export function publicUser(user: User) {
  const role = roles().find((r) => r.id === user.roleId)
  return {
    id: user.id,
    userName: user.userName,
    displayName: user.displayName,
    roleId: user.roleId,
    roleName: role?.name ?? 'No role',
    active: user.active,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    mustChangePassword: user.mustChangePassword,
  }
}

/* ── Login throttling ────────────────────────────────────────────────── */

const attempts = new Map<string, { count: number; firstAt: number; blockedUntil: number }>()
const WINDOW_MS = 15 * 60 * 1000
const MAX_ATTEMPTS = 8
const BLOCK_MS = 15 * 60 * 1000

export function loginBlockedFor(key: string): number {
  const record = attempts.get(key)
  if (!record) return 0
  if (record.blockedUntil > Date.now()) return Math.ceil((record.blockedUntil - Date.now()) / 1000)
  return 0
}

export function noteFailedLogin(key: string): void {
  const now = Date.now()
  const record = attempts.get(key)
  if (!record || now - record.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now, blockedUntil: 0 })
    return
  }
  record.count += 1
  if (record.count >= MAX_ATTEMPTS) {
    record.blockedUntil = now + BLOCK_MS
    record.count = 0
    record.firstAt = now
  }
}

export const clearFailedLogins = (key: string) => attempts.delete(key)

/* ── Sessions ────────────────────────────────────────────────────────── */

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex')

export function startSession(user: User, ip: string, userAgent: string): string {
  const token = crypto.randomBytes(32).toString('base64url')
  const now = Date.now()
  sessions().push({
    id: newId('ses'),
    tokenHash: hashToken(token),
    userId: user.id,
    createdAt: new Date(now).toISOString(),
    lastSeenAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    ip,
    userAgent: userAgent.slice(0, 200),
  } as never)
  user.lastLoginAt = new Date(now).toISOString()
  touch()
  return token
}

export function endSession(token: string | undefined): void {
  if (!token) return
  const hash = hashToken(token)
  const list = sessions()
  const index = list.findIndex((s) => s.tokenHash === hash)
  if (index >= 0) { list.splice(index, 1); touch() }
}

export function endAllSessionsFor(userId: string): void {
  const list = sessions()
  const kept = list.filter((s) => s.userId !== userId)
  if (kept.length !== list.length) {
    collection('sessions').length = 0
    ;(collection('sessions') as unknown as Session[]).push(...kept)
    touch()
  }
}

/** Drops sessions that have expired or gone idle. */
export function pruneSessions(): void {
  const now = Date.now()
  const list = sessions()
  const kept = list.filter((s) =>
    new Date(s.expiresAt).getTime() > now &&
    now - new Date(s.lastSeenAt).getTime() < SESSION_IDLE_MS)
  if (kept.length !== list.length) {
    collection('sessions').length = 0
    ;(collection('sessions') as unknown as Session[]).push(...kept)
    touch()
  }
}

/**
 * Resolves the caller from their session cookie.
 *
 * Returns null for a missing, unknown, expired, idle or deactivated session —
 * every one of which must be treated identically by callers.
 */
export function principalFromRequest(req: Request): Principal | null {
  const token = readCookie(req, SESSION_COOKIE)
  if (!token) return null

  const hash = hashToken(token)
  const session = sessions().find((s) => s.tokenHash === hash)
  if (!session) return null

  const now = Date.now()
  if (new Date(session.expiresAt).getTime() <= now) return null
  if (now - new Date(session.lastSeenAt).getTime() >= SESSION_IDLE_MS) return null

  const user = users().find((u) => u.id === session.userId)
  if (!user || !user.active) return null

  const role = roles().find((r) => r.id === user.roleId)
  if (!role) return null

  // Touch at most once a minute so a busy client does not rewrite the database
  // on every request.
  if (now - new Date(session.lastSeenAt).getTime() > 60_000) {
    session.lastSeenAt = new Date(now).toISOString()
    touch()
  }

  // A locked role always holds everything, even if its stored list drifts.
  const granted = role.locked
    ? new Set(role.permissions.length ? role.permissions : [])
    : new Set(role.permissions.filter(isPermission))
  if (role.locked) for (const key of role.permissions) granted.add(key)

  return {
    userId: user.id,
    userName: user.displayName || user.userName,
    roleId: role.id,
    roleName: role.name,
    permissions: granted,
  }
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return undefined
}

export function sessionCookie(token: string, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export const clearedCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`

export const clientIp = (req: Request): string =>
  (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
  req.socket.remoteAddress || 'unknown'
