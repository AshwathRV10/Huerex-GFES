/**
 * Automatic backups.
 *
 * The thing being checked is not that a file appears. It is that the file is
 * worth having when the disk it was copying has died: that it holds the data,
 * that it does not hold credentials, that yesterday's copy is still there
 * beside today's, and that a machine which was switched off at nine at night
 * does not simply skip the night.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PORT = 5397
const BASE = `http://127.0.0.1:${PORT}`
const DB = path.join(ROOT, 'data', 'huerex.backup-test.json')
const FOLDER = path.join(ROOT, 'data', 'backup-test-folder')

let failures = 0
const check = (label: string, pass: boolean, detail = '') => {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`)
  if (!pass) failures++
}

let cookie = ''
async function call(method: string, url: string, body?: unknown) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const set = res.headers.get('set-cookie')
  if (set) cookie = set.split(';')[0]
  return { status: res.status, body: await res.json().catch(() => null) as any }
}

let server: ChildProcess
const stopServer = () => {
  if (!server?.pid) return
  try { process.kill(-server.pid, 'SIGKILL') } catch { /* already gone */ }
}

async function boot() {
  try {
    if ((await fetch(`${BASE}/api/health`)).ok) {
      throw new Error(`something is already listening on port ${PORT} — stop it and run again`)
    }
  } catch (problem) {
    if (problem instanceof Error && problem.message.includes('already listening')) throw problem
  }
  server = spawn('npx', ['tsx', 'server/index.ts'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HUEREX_DB: DB },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('server did not start')
}

const dated = () => (fs.existsSync(FOLDER) ? fs.readdirSync(FOLDER).filter((f) => f.endsWith('.json')).sort() : [])

async function run() {
  fs.rmSync(DB, { force: true })
  fs.rmSync(FOLDER, { recursive: true, force: true })
  await boot()

  await call('POST', '/api/auth/bootstrap', {
    userName: 'ashwath', displayName: 'Owner', password: 'kovai-knits-2026',
  })

  /* 1 · It arrives configured, not waiting to be discovered. */
  const initial = await call('GET', '/api/backup/schedule')
  check('backups are on out of the box', initial.body?.data?.settings?.enabled === true,
    `enabled = ${initial.body?.data?.settings?.enabled}`)
  check('a sensible retention is set', initial.body?.data?.settings?.keep === 30,
    `keep = ${initial.body?.data?.settings?.keep}`)

  /* 2 · Point it at a folder of our own and run one. */
  await call('PATCH', '/api/backup/schedule', { folder: FOLDER, keep: 3 })
  const first = await call('POST', '/api/backup/run')
  check('a backup can be run on demand', first.status === 200, `got ${first.status}`)
  check('it wrote a dated file', dated().length === 1, dated().join(', '))
  check('the status says where it went',
    typeof first.body?.data?.lastPath === 'string' && first.body.data.lastPath.includes('huerex-'),
    first.body?.data?.lastPath)
  check('and how big it was', (first.body?.data?.lastBytes ?? 0) > 1000,
    `${first.body?.data?.lastBytes} bytes`)

  /* 3 · The file is worth having: the data is in it. */
  const written = JSON.parse(fs.readFileSync(path.join(FOLDER, dated()[0]), 'utf8'))
  check('the orders are in the backup', (written.collections?.orders?.length ?? 0) > 0,
    `${written.collections?.orders?.length} orders`)
  check('so are the masters', Object.keys(written.singletons?.masters ?? {}).length > 0)

  /* 4 · And it is not worth stealing. */
  const raw = fs.readFileSync(path.join(FOLDER, dated()[0]), 'utf8')
  check('no password hash is in the backup', !raw.includes('scrypt$'),
    raw.includes('scrypt$') ? 'A HASH IS IN THE FILE' : 'none')
  check('no session token is in the backup',
    Array.isArray(written.collections?.sessions) && written.collections.sessions.length === 0,
    `${written.collections?.sessions?.length} sessions`)

  /* 5 · Only the owner can read it — it is every price in the factory. */
  const mode = fs.statSync(path.join(FOLDER, dated()[0])).mode & 0o777
  check('the file is readable by its owner alone', mode === 0o600,
    `mode ${mode.toString(8)}`)

  /* 6 · A second run the same day does not overwrite the first. */
  await call('POST', '/api/backup/run')
  check('two runs in a day keep two copies', dated().length === 2, dated().join(', '))

  /* 7 · Old copies are pruned to the number asked for, oldest first. */
  await call('POST', '/api/backup/run')
  await call('POST', '/api/backup/run')
  await call('POST', '/api/backup/run')
  check('it keeps only what was asked for', dated().length === 3,
    `${dated().length} files, keep = 3`)

  /* 8 · A folder it cannot write to is reported, not swallowed. This is the
   *     unplugged backup drive, and the one failure that matters most: a
   *     backup silently not happening is worse than no backup at all, because
   *     somebody believes they have one. */
  // A path that cannot become a folder, because a file is sitting where one of
  // its parents would have to be. Permissions would not do here — these tests
  // may run as root, for whom a read-only directory is still writable.
  const blocked = path.join(ROOT, 'data', 'backup-test-not-a-folder')
  fs.rmSync(blocked, { recursive: true, force: true })
  fs.writeFileSync(blocked, 'this is a file, not a directory')
  await call('PATCH', '/api/backup/schedule', { folder: path.join(blocked, 'inside') })
  const failed = await call('POST', '/api/backup/run')
  check('an unwritable folder is an error, not a silent no-op', failed.status === 500,
    `got ${failed.status}`)
  const afterFailure = await call('GET', '/api/backup/schedule')
  check('and the failure is on the record',
    typeof afterFailure.body?.data?.status?.lastError === 'string',
    afterFailure.body?.data?.status?.lastError?.slice(0, 60))

  fs.rmSync(blocked, { force: true })

  /* 9 · Every one of those is in the audit log. */
  await call('PATCH', '/api/backup/schedule', { folder: FOLDER })
  const audit = await call('GET', '/api/audit?limit=200')
  const actions = (audit.body?.data ?? []).map((e: any) => e.action)
  check('running a backup is audited', actions.includes('backup.run'))
  check('changing the schedule is audited', actions.includes('backup.schedule'))

  /* 10 · Nobody without the permission can see or touch any of it. */
  const roles = (await call('GET', '/api/roles')).body.data
  const floor = roles.find((r: any) => r.name === 'Floor')
  await call('POST', '/api/users', {
    userName: 'cutter', displayName: 'Cutter', password: 'shopfloor-2026-entry', roleId: floor.id,
  })
  const owner = cookie
  cookie = ''
  await call('POST', '/api/auth/login', { userName: 'cutter', password: 'shopfloor-2026-entry' })
  check('the floor cannot read the backup schedule',
    (await call('GET', '/api/backup/schedule')).status === 403)
  check('the floor cannot run a backup',
    (await call('POST', '/api/backup/run')).status === 403)
  check('the floor cannot change where backups go',
    (await call('PATCH', '/api/backup/schedule', { folder: '/tmp' })).status === 403)
  cookie = owner

  /* 11 · The manual download and the nightly copy strip the same things. */
  const manual = await fetch(`${BASE}/api/backup`, { headers: { Cookie: cookie } })
  const manualRaw = await manual.text()
  check('the manual download carries no hash either', !manualRaw.includes('scrypt$'))
  check('the two backups agree on what to strip',
    JSON.parse(manualRaw).collections.sessions.length === 0 &&
    JSON.parse(manualRaw).collections.users.every((u: any) => u.passwordHash === '[excluded from backup]'))

  /* 12 · The schedule itself: does it know when a night was missed?
   *
   *      This is the part that cannot be checked by waiting — the whole point
   *      is what happens at nine at night on a machine that was switched off.
   *      So the module is loaded directly, against a database of its own, and
   *      asked the question for a series of made-up clocks. */
  process.env.HUEREX_DB = path.join(ROOT, 'data', 'huerex.schedule-test.json')
  const store = await import('../server/store.js')
  const backup = await import('../server/backup.js')
  store.load()

  const setSchedule = (settings: Record<string, unknown>, lastAt: string | null) => {
    store.get().singletons.backup = { folder: FOLDER, hour: 21, minute: 0, keep: 30, enabled: true, ...settings }
    store.get().singletons.backupStatus = { lastAt, lastPath: null, lastBytes: null, lastError: null, lastReason: null }
  }
  const at = (day: number, hour: number, minute = 0) =>
    new Date(2026, 8, day, hour, minute, 0, 0)

  setSchedule({}, null)
  check('with no backup ever taken, one is due', backup.backupIsDue(at(1, 22)))

  setSchedule({}, at(1, 21, 5).toISOString())
  check('having just run, another is not due', !backup.backupIsDue(at(1, 22)))

  setSchedule({}, at(1, 21, 5).toISOString())
  check('and still not due later the same evening', !backup.backupIsDue(at(1, 23, 59)))

  setSchedule({}, at(1, 21, 5).toISOString())
  check('the next night, it is due again', backup.backupIsDue(at(2, 21, 1)))

  setSchedule({}, at(1, 21, 5).toISOString())
  check('but not before the appointed hour', !backup.backupIsDue(at(2, 20, 59)))

  // The one that matters: the PC was off all night and is switched on at 9 am.
  setSchedule({}, at(1, 21, 5).toISOString())
  check('a night missed with the machine off is caught up in the morning',
    backup.backupIsDue(at(3, 9)))

  setSchedule({ enabled: false }, null)
  check('turned off means never due', !backup.backupIsDue(at(9, 23)))

  // Nonsense in the settings must not silently stop backups altogether.
  setSchedule({ hour: 99, minute: -5, keep: 0 }, null)
  const clamped = backup.backupSettings()
  check('a nonsense hour is clamped rather than obeyed',
    clamped.hour >= 0 && clamped.hour <= 23 && clamped.minute >= 0 && clamped.minute <= 59,
    `${clamped.hour}:${clamped.minute}`)
  check('and it still keeps at least one copy', clamped.keep >= 1, `keep = ${clamped.keep}`)

  console.log(failures === 0 ? '\nAll backup checks passed.' : `\n${failures} check(s) FAILED.`)
  process.exitCode = failures === 0 ? 0 : 1
}

run()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(() => {
    stopServer()
    fs.rmSync(DB, { force: true })
    fs.rmSync(FOLDER, { recursive: true, force: true })
    fs.rmSync(path.join(ROOT, 'data', 'backup-test-not-a-folder'), { recursive: true, force: true })
    fs.rmSync(path.join(ROOT, 'data', 'huerex.schedule-test.json'), { force: true })
  })
