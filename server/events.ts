/**
 * Live sync and presence, over server-sent events.
 *
 * SSE rather than websockets: it is one long-lived GET, it reconnects by
 * itself when the office wifi drops, and it passes through every proxy a
 * factory network is likely to have in front of it.
 *
 * A change is broadcast as a small envelope — collection, action, row id — and
 * each client decides what to do with it. Rows that a viewer is not allowed to
 * see are filtered per subscriber, so a floor operator's browser is never even
 * told that a costing changed.
 */
import type { Response } from 'express'
import { canSeeCosting, permissionForRead, can, type Principal } from './rbac.js'
import { SENSITIVE_COLLECTIONS } from './rbac.js'
import { redactRow } from './redact.js'

interface Subscriber {
  id: string
  res: Response
  principal: Principal
  since: number
}

const subscribers = new Map<string, Subscriber>()
let counter = 0

export interface ChangeEvent {
  collection: string
  action: 'create' | 'update' | 'delete' | 'reload'
  recordId?: string
  row?: Record<string, unknown> | null
  /** Who caused it, so a client can skip echoing its own change. */
  byUserId: string | null
  byUserName: string
  at: string
}

const write = (res: Response, event: string, data: unknown) => {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  } catch {
    /* the socket went away; the close handler will clean up */
  }
}

export function subscribe(res: Response, principal: Principal): () => void {
  const id = `sub_${++counter}`
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.write(': connected\n\n')

  const subscriber: Subscriber = { id, res, principal, since: Date.now() }
  subscribers.set(id, subscriber)
  broadcastPresence()

  // A comment every 25s keeps intermediaries from closing an idle connection.
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n') } catch { /* handled on close */ }
  }, 25_000)

  return () => {
    clearInterval(heartbeat)
    subscribers.delete(id)
    broadcastPresence()
  }
}

/** Tells every client that something changed, filtered to what each may see. */
export function broadcastChange(event: ChangeEvent): void {
  for (const subscriber of subscribers.values()) {
    // Silence entirely on a collection this subscriber cannot read.
    const readPermission = permissionForRead(event.collection)
    if (readPermission && !can(subscriber.principal, readPermission)) continue
    if ((SENSITIVE_COLLECTIONS as readonly string[]).includes(event.collection) &&
        !canSeeCosting(subscriber.principal)) continue

    const row = event.row
      ? redactRow(event.collection, event.row, subscriber.principal)
      : event.row

    write(subscriber.res, 'change', { ...event, row })
  }
}

/** A change to something every client keeps in memory but is not a row. */
export function broadcastReload(what: 'masters' | 'settings' | 'processTypes' | 'all', by: Principal | null): void {
  for (const subscriber of subscribers.values()) {
    write(subscriber.res, 'reload', {
      what,
      byUserId: by?.userId ?? null,
      byUserName: by?.userName ?? 'system',
      at: new Date().toISOString(),
    })
  }
}

/** Forces named users to re-authenticate — used when a role or account changes. */
export function broadcastSessionInvalidated(userIds: string[]): void {
  for (const subscriber of subscribers.values()) {
    if (!userIds.includes(subscriber.principal.userId)) continue
    write(subscriber.res, 'reauth', { reason: 'Your access has changed. Please sign in again.' })
  }
}

export interface PresenceEntry { userId: string; userName: string; roleName: string; since: string }

export function presence(): PresenceEntry[] {
  const seen = new Map<string, PresenceEntry>()
  for (const subscriber of subscribers.values()) {
    const existing = seen.get(subscriber.principal.userId)
    if (!existing || subscriber.since < new Date(existing.since).getTime()) {
      seen.set(subscriber.principal.userId, {
        userId: subscriber.principal.userId,
        userName: subscriber.principal.userName,
        roleName: subscriber.principal.roleName,
        since: new Date(subscriber.since).toISOString(),
      })
    }
  }
  return [...seen.values()].sort((a, b) => a.userName.localeCompare(b.userName))
}

function broadcastPresence(): void {
  const list = presence()
  for (const subscriber of subscribers.values()) write(subscriber.res, 'presence', list)
}

export const subscriberCount = () => subscribers.size
