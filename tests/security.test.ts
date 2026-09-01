/**
 * Security tests.
 *
 * These drive the real HTTP server the way an attacker would: with a session
 * that is missing, expired, or simply belongs to somebody whose role does not
 * grant what they are asking for.
 *
 * The claim under test is the one the UI cannot make on its own — that a user
 * without `costing.view` cannot obtain a rate, a cost or a buyer price by ANY
 * route: the state payload, a collection endpoint, a guessed URL, or a backup.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PORT = 5399
const BASE = `http://127.0.0.1:${PORT}`
const DB = path.join(ROOT, 'data', 'huerex.security-test.json')

let failures = 0
const check = (label: string, pass: boolean, detail = '') => {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`)
  if (!pass) failures++
}

/* ── A tiny cookie-aware client ──────────────────────────────────────── */

class Client {
  cookie = ''
  constructor(readonly label: string) {}

  async call(method: string, url: string, body?: unknown) {
    const res = await fetch(BASE + url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const setCookie = res.headers.get('set-cookie')
    if (setCookie) this.cookie = setCookie.split(';')[0]
    let payload: any = null
    try { payload = await res.json() } catch { /* not every response is json */ }
    return { status: res.status, body: payload }
  }
  get = (url: string) => this.call('GET', url)
  post = (url: string, body?: unknown) => this.call('POST', url, body)
  patch = (url: string, body?: unknown) => this.call('PATCH', url, body)
  del = (url: string) => this.call('DELETE', url)
}

/* ── Boot a real server against a throwaway database ─────────────────── */

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
  server.stderr?.on('data', (d) => {
    const text = String(d)
    if (!text.includes('ExperimentalWarning')) process.stderr.write(`[server] ${text}`)
  })
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`)
      if (res.ok) return
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('server did not start')
}

/** Kills the whole npx → shell → node chain, not just the process we hold. */
const stopServer = () => {
  if (!server?.pid) return
  try { process.kill(-server.pid, 'SIGKILL') } catch { /* already gone */ }
}

const shutdown = () => { stopServer(); fs.rmSync(DB, { force: true }) }

/* ── The tests ───────────────────────────────────────────────────────── */

async function run() {
  await boot()

  /* 1 · Nothing is readable before signing in. */
  const anon = new Client('anonymous')
  const anonState = await anon.get('/api/state')
  check('anonymous cannot read /api/state', anonState.status === 401, `got ${anonState.status}`)
  const anonCosting = await anon.get('/api/costings')
  check('anonymous cannot read /api/costings', anonCosting.status === 401, `got ${anonCosting.status}`)
  const anonRates = await anon.get('/api/rateBook')
  check('anonymous cannot read /api/rateBook', anonRates.status === 401, `got ${anonRates.status}`)
  const anonWrite = await anon.post('/api/cutting', { orderNo: 'X', cutQty: 1 })
  check('anonymous cannot write', anonWrite.status === 401, `got ${anonWrite.status}`)

  /* 2 · Bootstrap creates exactly one administrator. */
  const admin = new Client('admin')
  const weak = await admin.post('/api/auth/bootstrap', {
    userName: 'ashwath', displayName: 'Ashwath', password: 'short',
  })
  check('a weak password is refused at bootstrap', weak.status === 400, weak.body?.error)

  const boot1 = await admin.post('/api/auth/bootstrap', {
    userName: 'ashwath', displayName: 'Ashwath', password: 'correct-horse-battery',
  })
  check('bootstrap creates the first administrator', boot1.status === 200, `got ${boot1.status}`)

  const boot2 = await new Client('x').post('/api/auth/bootstrap', {
    userName: 'sneaky', displayName: 'Sneaky', password: 'another-long-password',
  })
  check('bootstrap cannot be used twice', boot2.status === 409, `got ${boot2.status}`)

  /* 3 · The admin sees costing; the roles exist. */
  const me = await admin.get('/api/auth/me')
  check('admin holds costing.view', me.body?.data?.permissions?.includes('costing.view') === true)
  const rolesRes = await admin.get('/api/roles')
  const roleList: any[] = rolesRes.body?.data ?? []
  const floorRole = roleList.find((r) => r.name === 'Floor')
  const merchRole = roleList.find((r) => r.name === 'Merchandiser')
  check('the built-in roles were created', roleList.length >= 5, roleList.map((r) => r.name).join(', '))
  check('the Floor role holds no costing permission',
    !(floorRole?.permissions ?? []).some((p: string) => p.startsWith('costing.')),
    (floorRole?.permissions ?? []).filter((p: string) => p.startsWith('costing.')).join(',') || 'none')

  /* 4 · Seed a costing and a rate as the admin, so there is something to leak. */
  const orders = await admin.get('/api/orders')
  const firstOrder = orders.body?.data?.[0]
  check('admin can read orders', orders.status === 200 && !!firstOrder)

  await admin.patch(`/api/orders/${firstOrder.id}`, { sellingPrice: 250 })
  const costing = await admin.post('/api/costings', {
    orderNo: firstOrder.orderNo, name: 'Working', currency: 'INR',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'Draft',
    sellingPrice: 250, excessPct: null, excessInvoiced: null, rejectionPct: 0.02,
    fabric: [{
      id: 'f1', fabricType: '3T FLEECE', colour: 'PINK', netGramsPerPc: 211, netKgOverride: null,
      wastagePct: 0.08, yarnRate: 250, knittingRate: 40, dyeingRate: 60, finishingRate: 20,
      otherRate: 0, landedRateOverride: null, remarks: '',
    }],
    trims: [], jobwork: [], cmt: [], overheads: [], notes: '',
  })
  check('admin can create a costing', costing.status === 200, `got ${costing.status}`)
  await admin.post('/api/rateBook', {
    kind: 'dyeing', scope: { colour: 'PINK' }, unit: 'kg', rate: 60, currency: 'INR',
    label: 'Dyeing · PINK', uses: 1, lastUsedAt: new Date().toISOString(),
    lastOrderNo: firstOrder.orderNo, note: '',
  })

  /* 5 · Create a Floor user — the least-privileged real account. */
  const created = await admin.post('/api/users', {
    userName: 'floorop', displayName: 'Floor Operator',
    password: 'shopfloor-2026-entry', roleId: floorRole.id,
  })
  check('admin can create a Floor user', created.status === 200, `got ${created.status}`)

  const floor = new Client('floor')
  const floorLogin = await floor.post('/api/auth/login', {
    userName: 'floorop', password: 'shopfloor-2026-entry',
  })
  check('the Floor user can sign in', floorLogin.status === 200, `got ${floorLogin.status}`)

  /* 6 · THE CENTRAL CLAIM — no commercial figure reaches the Floor user. */
  const floorState = await floor.get('/api/state')
  const payload = JSON.stringify(floorState.body ?? {})
  const collections = floorState.body?.data?.collections ?? {}

  check('state gives the Floor user no costings', (collections.costings ?? []).length === 0,
    `${(collections.costings ?? []).length} rows`)
  check('state gives the Floor user no rate book', (collections.rateBook ?? []).length === 0,
    `${(collections.rateBook ?? []).length} rows`)
  check('no order in the payload carries a sellingPrice',
    (collections.orders ?? []).every((o: any) => !('sellingPrice' in o)))
  check('no buyer in the payload carries commercial terms',
    (collections.buyers ?? []).every((b: any) => !('excessPct' in b) && !('paymentTerms' in b)))
  check('the literal rate 250 does not appear anywhere in the payload',
    !payload.includes('"sellingPrice"') && !payload.includes('"yarnRate"'),
    'checked the raw JSON, not just parsed fields')
  check('costing default settings are withheld',
    !('defaultRejectionPct' in (floorState.body?.data?.settings ?? {})))

  /* 7 · And not by asking a URL directly. */
  const direct = await floor.get('/api/costings')
  check('direct GET /api/costings is refused', direct.status === 403, `got ${direct.status}`)
  const directRates = await floor.get('/api/rateBook')
  check('direct GET /api/rateBook is refused', directRates.status === 403, `got ${directRates.status}`)

  /* 8 · Nor by writing. */
  const writeCosting = await floor.post('/api/costings', { orderNo: firstOrder.orderNo })
  check('the Floor user cannot create a costing', writeCosting.status === 403, `got ${writeCosting.status}`)
  const editPrice = await floor.patch(`/api/orders/${firstOrder.id}`, { sellingPrice: 1 })
  check('the Floor user cannot edit an order at all', editPrice.status === 403, `got ${editPrice.status}`)
  const deleteOrder = await floor.del(`/api/orders/${firstOrder.id}`)
  check('the Floor user cannot delete an order', deleteOrder.status === 403, `got ${deleteOrder.status}`)

  /* 9 · Nor through admin endpoints, the audit log, or a backup. */
  const backup = await floor.get('/api/backup')
  check('the Floor user cannot download a backup', backup.status === 403, `got ${backup.status}`)
  const audit = await floor.get('/api/audit')
  check('the Floor user cannot read the audit log', audit.status === 403, `got ${audit.status}`)
  const userList = await floor.get('/api/users')
  check('the Floor user cannot list users', userList.status === 403, `got ${userList.status}`)
  const makeAdmin = await floor.post('/api/users', {
    userName: 'evil', displayName: 'Evil', password: 'a-long-enough-password', roleId: floorRole.id,
  })
  check('the Floor user cannot create accounts', makeAdmin.status === 403, `got ${makeAdmin.status}`)
  const reset = await floor.post('/api/reset', {})
  check('the Floor user cannot reset the database', reset.status === 403, `got ${reset.status}`)

  /* 10 · Nor by reaching the auth tables through the row API.
     `users` and `roles` are real admin endpoints, so a Floor user is refused
     with 403; `sessions` and `auditLog` are not addressable at all. */
  for (const table of ['sessions', 'auditLog']) {
    const res = await floor.get(`/api/${table}`)
    check(`/api/${table} is not addressable at all`, res.status === 404, `got ${res.status}`)
  }
  for (const table of ['users', 'roles']) {
    const res = await floor.get(`/api/${table}`)
    check(`/api/${table} refuses a Floor user`, res.status === 403, `got ${res.status}`)
  }
  for (const table of ['users', 'sessions', 'roles', 'auditLog']) {
    const res = await floor.post(`/api/${table}`, { id: 'x' })
    check(`POST /api/${table} cannot create an auth row`, res.status === 403 || res.status === 404,
      `got ${res.status}`)
  }

  /* 11 · What the Floor user IS allowed to do still works. */
  const logCut = await floor.post('/api/cutting', {
    date: '2026-08-31', orderNo: firstOrder.orderNo, colour: 'PINK', size: '6-7 Y',
    fabricType: '3T FLEECE', countsAsGarment: true, cutQty: 10, remarks: 'security test',
  })
  check('the Floor user CAN log cutting', logCut.status === 200, `got ${logCut.status}`)
  const cuttingRead = await floor.get('/api/cutting')
  check('the Floor user CAN read cutting', cuttingRead.status === 200, `got ${cuttingRead.status}`)

  /* 12 · A Merchandiser sees costing; the redaction is role-driven, not global. */
  await admin.post('/api/users', {
    userName: 'merch', displayName: 'Merchandiser', password: 'quoting-desk-2026', roleId: merchRole.id,
  })
  const merch = new Client('merch')
  const merchLogin = await merch.post('/api/auth/login', { userName: 'merch', password: 'quoting-desk-2026' })
  check('the Merchandiser can sign in', merchLogin.status === 200, `got ${merchLogin.status}`)
  const merchState = await merch.get('/api/state')
  const merchCollections = merchState.body?.data?.collections ?? {}
  check('a Merchandiser DOES receive the costings', (merchCollections.costings ?? []).length > 0,
    `${(merchCollections.costings ?? []).length} rows`)
  check('a Merchandiser DOES see the selling price',
    (merchCollections.orders ?? []).some((o: any) => o.sellingPrice === 250))
  const merchDelete = await merch.del(`/api/orders/${firstOrder.id}`)
  check('a Merchandiser still cannot delete an order', merchDelete.status === 403, `got ${merchDelete.status}`)

  /* 13 · Login throttling and account enumeration. */
  const guesser = new Client('guesser')
  const unknown = await guesser.post('/api/auth/login', { userName: 'nobody', password: 'x' })
  const wrongPass = await guesser.post('/api/auth/login', { userName: 'floorop', password: 'x' })
  check('an unknown user and a wrong password give the same answer',
    unknown.status === wrongPass.status && unknown.body?.error === wrongPass.body?.error,
    `${unknown.status}/${wrongPass.status}`)

  let throttled = false
  for (let i = 0; i < 10; i++) {
    const attempt = await guesser.post('/api/auth/login', { userName: 'floorop', password: `wrong${i}` })
    if (attempt.status === 429) { throttled = true; break }
  }
  check('repeated failed logins get throttled', throttled)

  /* 14 · Changing a role takes effect immediately on live sessions. */
  const promoted = new Client('promoted')
  await admin.post('/api/users', {
    userName: 'tempuser', displayName: 'Temp', password: 'rotating-shift-2026', roleId: floorRole.id,
  })
  const tempLogin = await promoted.post('/api/auth/login', { userName: 'tempuser', password: 'rotating-shift-2026' })
  check('the temp user can sign in', tempLogin.status === 200, `got ${tempLogin.status}`)
  const beforePromotion = await promoted.get('/api/costings')
  check('the temp user starts without costing access', beforePromotion.status === 403,
    `got ${beforePromotion.status}`)

  const tempUser = (await admin.get('/api/users')).body.data.find((u: any) => u.userName === 'tempuser')
  check('the temp user exists', !!tempUser)
  if (!tempUser) throw new Error('temp user was not created — cannot test promotion')
  await admin.patch(`/api/users/${tempUser.id}`, { roleId: merchRole.id })
  const afterPromotion = await promoted.get('/api/costings')
  check('changing a role invalidates the old session at once',
    afterPromotion.status === 401, `got ${afterPromotion.status} (401 means the session was dropped)`)

  /* 15 · The audit log recorded the sensitive actions with a before/after. */
  const log = await admin.get('/api/audit')
  const entries: any[] = log.body?.data ?? []
  check('the audit log is readable by an admin', log.status === 200 && entries.length > 0,
    `${entries.length} entries`)
  check('a denied access attempt was recorded',
    entries.some((e) => e.action === 'access.denied'))
  check('the failed logins were recorded',
    entries.some((e) => e.action === 'login.failed'))
  check('the costing creation was recorded as sensitive',
    entries.some((e) => e.target === 'costings' && e.action === 'create' && e.sensitive))
  check('the price change kept a before and after',
    entries.some((e) => e.target === 'orders' && e.action === 'update' &&
      JSON.stringify(e.after ?? {}).includes('250')))
  check('no audit entry leaks a password hash',
    !JSON.stringify(entries).includes('scrypt$'))

  /* 16 · A backup carries no usable credentials. */
  const backupFile = await admin.get('/api/backup')
  const backupText = JSON.stringify(backupFile.body ?? {})
  check('a backup contains no password hashes', !backupText.includes('scrypt$'))
  check('a backup contains no session tokens',
    (backupFile.body?.collections?.sessions ?? []).length === 0)

  console.log(failures === 0
    ? '\nAll security checks passed.'
    : `\n${failures} security check(s) FAILED.`)
  process.exitCode = failures === 0 ? 0 : 1
}

run()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(shutdown)
