/**
 * Live sync.
 *
 * Two people, two sessions, one server. What one writes the other must see
 * without reloading — and a change to something the second person is not
 * allowed to see must not reach them at all, not even as a notification that
 * it happened.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PORT = 5398
const BASE = `http://127.0.0.1:${PORT}`
const DB = path.join(ROOT, 'data', 'huerex.livesync-test.json')

let failures = 0
const check = (label: string, pass: boolean, detail = '') => {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`)
  if (!pass) failures++
}

class Client {
  cookie = ''
  constructor(readonly label: string) {}
  async call(method: string, url: string, body?: unknown) {
    const res = await fetch(BASE + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const setCookie = res.headers.get('set-cookie')
    if (setCookie) this.cookie = setCookie.split(';')[0]
    return { status: res.status, body: await res.json().catch(() => null) as any }
  }
  get = (u: string) => this.call('GET', u)
  post = (u: string, b?: unknown) => this.call('POST', u, b)
  patch = (u: string, b?: unknown) => this.call('PATCH', u, b)
}

/** Reads an SSE stream and collects the events as they arrive. */
class Stream {
  events: { type: string; data: any }[] = []
  private controller = new AbortController()
  private ready!: Promise<void>

  constructor(private cookie: string) {}

  async open() {
    let resolveReady!: () => void
    this.ready = new Promise((r) => { resolveReady = r })
    const res = await fetch(`${BASE}/api/events`, {
      headers: { Cookie: this.cookie, Accept: 'text/event-stream' },
      signal: this.controller.signal,
    })
    if (!res.body) throw new Error('no event stream body')
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    resolveReady()
    ;(async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const frames = buffer.split('\n\n')
          buffer = frames.pop() ?? ''
          for (const frame of frames) {
            const typeLine = frame.split('\n').find((l) => l.startsWith('event: '))
            const dataLine = frame.split('\n').find((l) => l.startsWith('data: '))
            if (!typeLine || !dataLine) continue
            try {
              this.events.push({
                type: typeLine.slice(7).trim(),
                data: JSON.parse(dataLine.slice(6)),
              })
            } catch { /* a comment or heartbeat */ }
          }
        }
      } catch { /* aborted */ }
    })()
    await this.ready
    await new Promise((r) => setTimeout(r, 300))
  }

  of = (type: string) => this.events.filter((e) => e.type === type)
  close = () => this.controller.abort()
}

let server: ChildProcess

async function boot() {
  // A server left behind by an earlier run would answer on this port with a
  // database we know nothing about, and every check after it would be a lie.
  try {
    if ((await fetch(`${BASE}/api/health`)).ok) {
      throw new Error(`something is already listening on port ${PORT} — stop it and run again`)
    }
  } catch (problem) {
    if (problem instanceof Error && problem.message.includes('already listening')) throw problem
  }
  fs.rmSync(DB, { force: true })
  server = spawn('npx', ['tsx', 'server/index.ts'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HUEREX_DB: DB },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Its own process group. npx starts a shell which starts node, so killing
    // npx alone leaves the server running, holding the port and this process's
    // stdout pipe open — the test then prints its results and never exits.
    detached: true,
  })
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('server did not start')
}

/** Kills the whole npx → shell → node chain, not just the process we hold. */
const stopServer = () => {
  if (!server?.pid) return
  try { process.kill(-server.pid, 'SIGKILL') } catch { /* already gone */ }
}

const settle = () => new Promise((r) => setTimeout(r, 500))

async function run() {
  await boot()

  /* Two accounts: one who sees costing, one who does not. */
  const admin = new Client('admin')
  await admin.post('/api/auth/bootstrap', {
    userName: 'ashwath', displayName: 'Owner', password: 'factory-floor-2026',
  })
  const rolesRes = await admin.get('/api/roles')
  check('the administrator was created and can read roles', rolesRes.status === 200,
    `got ${rolesRes.status}: ${rolesRes.body?.error ?? ''}`)
  const roles = rolesRes.body?.data ?? []
  const floorRole = roles.find((r: any) => r.name === 'Floor')
  await admin.post('/api/users', {
    userName: 'cutter', displayName: 'Cutter', password: 'shopfloor-2026-entry', roleId: floorRole.id,
  })
  const floor = new Client('floor')
  await floor.post('/api/auth/login', { userName: 'cutter', password: 'shopfloor-2026-entry' })

  const adminStream = new Stream(admin.cookie)
  const floorStream = new Stream(floor.cookie)
  await adminStream.open()
  await floorStream.open()
  await settle()

  /* 1 · Presence: each sees the other. */
  const adminPresence = adminStream.of('presence').at(-1)?.data ?? []
  check('the live stream reports who is online',
    adminPresence.length === 2, `${adminPresence.length} people`)
  check('presence names both people',
    adminPresence.some((p: any) => p.userName === 'Owner') &&
    adminPresence.some((p: any) => p.userName === 'Cutter'),
    adminPresence.map((p: any) => p.userName).join(', '))

  /* 2 · A production entry by one reaches the other. */
  const orders = (await admin.get('/api/orders')).body.data
  const order = orders[0]
  const before = floorStream.of('change').length
  await admin.post('/api/cutting', {
    date: '2026-08-31', orderNo: order.orderNo, colour: 'PINK', size: '6-7 Y',
    fabricType: '3T FLEECE', countsAsGarment: true, cutQty: 42, remarks: 'live sync test',
  })
  await settle()
  const floorChanges = floorStream.of('change').slice(before)
  check('a cutting entry reaches the other person live',
    floorChanges.some((e) => e.data.collection === 'cutting' && e.data.row?.cutQty === 42),
    `${floorChanges.length} change event(s)`)
  check('the change says who made it',
    floorChanges.some((e) => e.data.byUserName === 'Owner'))

  /* 3 · A costing change must NOT reach somebody without costing access. */
  const floorBefore = floorStream.of('change').length
  const adminBefore = adminStream.of('change').length
  await admin.post('/api/costings', {
    orderNo: order.orderNo, name: 'Quote', currency: 'INR',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'Draft',
    sellingPrice: 250, excessPct: null, excessInvoiced: null, rejectionPct: 0.02,
    fabric: [], trims: [], jobwork: [], cmt: [], overheads: [], notes: '',
  })
  await settle()
  const floorAfter = floorStream.of('change').slice(floorBefore)
  const adminAfter = adminStream.of('change').slice(adminBefore)
  check('the costing change reached the admin',
    adminAfter.some((e) => e.data.collection === 'costings'))
  check('the costing change did NOT reach the floor operator',
    !floorAfter.some((e) => e.data.collection === 'costings'),
    floorAfter.map((e) => e.data.collection).join(',') || 'no events at all')

  /* 4 · Same for an order's selling price: the row arrives redacted. */
  const floorPriceBefore = floorStream.of('change').length
  await admin.patch(`/api/orders/${order.id}`, { sellingPrice: 250 })
  await settle()
  const priceEvents = floorStream.of('change').slice(floorPriceBefore)
    .filter((e) => e.data.collection === 'orders')
  check('the floor operator is told the order changed', priceEvents.length > 0)
  check('but the price is stripped from the row they receive',
    priceEvents.every((e) => !e.data.row || !('sellingPrice' in e.data.row)),
    JSON.stringify(priceEvents[0]?.data.row ?? {}).slice(0, 120))

  /* 5 · Two people editing the same row: the second is told, not ignored. */
  const cutting = (await admin.get('/api/cutting')).body.data
  const row = cutting.find((r: any) => r.cutQty === 42)
  check('a created row carries a revision', typeof row.rev === 'number', `rev = ${row.rev}`)

  const first = await admin.patch(`/api/cutting/${row.id}`, { cutQty: 50, __expectedRev: row.rev })
  check('the first edit succeeds', first.status === 200, `got ${first.status}`)
  check('the revision advanced', first.body?.data?.rev === row.rev + 1, `rev = ${first.body?.data?.rev}`)

  const stale = await admin.patch(`/api/cutting/${row.id}`, {
    cutQty: 99, __expectedRev: row.rev,   // the copy from before the first edit
  })
  check('a stale edit is refused rather than overwriting', stale.status === 409, `got ${stale.status}`)
  check('the conflict hands back the row as it now stands',
    stale.body?.data?.current?.cutQty === 50, `got ${stale.body?.data?.current?.cutQty}`)

  const informed = await admin.patch(`/api/cutting/${row.id}`, {
    cutQty: 99, __expectedRev: stale.body.data.current.rev,
  })
  check('retrying with the current copy succeeds', informed.status === 200, `got ${informed.status}`)

  /* 6 · An edit with no expectation still works, so nothing forces the check. */
  const unchecked = await admin.patch(`/api/cutting/${row.id}`, { remarks: 'no expectation sent' })
  check('an edit without a version check is still allowed', unchecked.status === 200)

  /* 7 · Changing a role signs that person out through the live stream. */
  const users = (await admin.get('/api/users')).body.data
  const cutterUser = users.find((u: any) => u.userName === 'cutter')
  const merchRole = roles.find((r: any) => r.name === 'Merchandiser')
  await admin.patch(`/api/users/${cutterUser.id}`, { roleId: merchRole.id })
  await settle()
  check('a role change pushes a re-authenticate to that person',
    floorStream.of('reauth').length > 0, `${floorStream.of('reauth').length} event(s)`)

  adminStream.close()
  floorStream.close()

  console.log(failures === 0 ? '\nAll live-sync checks passed.' : `\n${failures} check(s) FAILED.`)
  process.exitCode = failures === 0 ? 0 : 1
}

run()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(() => { stopServer(); fs.rmSync(DB, { force: true }) })
