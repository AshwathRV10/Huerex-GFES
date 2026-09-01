/**
 * Automatic backups.
 *
 * The database is one file, so a backup is a copy of it — which makes this
 * simple, and makes the absence of it expensive. The realistic way a factory
 * loses its costings is not a break-in; it is the office PC's disk dying with
 * the only copy on it, months after somebody stopped remembering to click the
 * download button. So nothing here depends on anybody remembering.
 *
 * A copy is written once a day to a folder of your choosing — a second drive, a
 * NAS share, a synced folder — dated, with the oldest pruned once there are
 * more than you asked to keep. If the machine was switched off at the appointed
 * hour, the missed backup runs shortly after it next starts rather than being
 * skipped until tomorrow.
 *
 * The file holds every price, rate and margin in the system in plain text, so
 * it is written readable by its owner alone, and password hashes and session
 * tokens are stripped — a backup is for restoring data, not for lifting
 * credentials out of.
 *
 * Every file operation here is asynchronous and under a deadline, which matters
 * more than it looks: the folder is likely to be a second drive or a NAS share,
 * and a share whose machine has gone away does not fail — it blocks. Done with
 * the synchronous calls used everywhere else in this server, an unplugged backup
 * drive at nine at night would freeze the whole application for everybody, which
 * is a spectacularly bad way to protect data.
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import { DATA_DIR, flush, get, touch } from './store.js'

/** A backup that has not finished in this long is treated as a dead mount. */
const DEADLINE_MS = 60_000

const withDeadline = <T>(work: Promise<T>, what: string): Promise<T> =>
  Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${what} did not finish within 60 seconds — is the folder on a drive or share that has gone away?`)), DEADLINE_MS).unref?.()),
  ])

export interface BackupSettings {
  enabled: boolean
  /** Where the copies go. Absolute, or relative to the working directory. */
  folder: string
  /** Local time of day to run, on a 24-hour clock. */
  hour: number
  minute: number
  /** How many dated copies to keep before the oldest is deleted. */
  keep: number
}

export interface BackupStatus {
  lastAt: string | null
  lastPath: string | null
  lastBytes: number | null
  lastError: string | null
  /** 'scheduled', 'catch-up' or the name of whoever asked for it. */
  lastReason: string | null
}

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  enabled: true,
  folder: path.join(DATA_DIR, 'backups'),
  hour: 21,
  minute: 0,
  keep: 30,
}

const EMPTY_STATUS: BackupStatus = {
  lastAt: null, lastPath: null, lastBytes: null, lastError: null, lastReason: null,
}

/* ── Settings, held in the database beside everything else ────────────── */

export function backupSettings(): BackupSettings {
  const stored = (get().singletons.backup ?? {}) as Partial<BackupSettings>
  return {
    ...DEFAULT_BACKUP_SETTINGS,
    ...stored,
    // A nonsense value here means no backups at all, so each one is clamped
    // rather than trusted.
    hour: clamp(stored.hour ?? DEFAULT_BACKUP_SETTINGS.hour, 0, 23),
    minute: clamp(stored.minute ?? DEFAULT_BACKUP_SETTINGS.minute, 0, 59),
    keep: clamp(stored.keep ?? DEFAULT_BACKUP_SETTINGS.keep, 1, 365),
  }
}

export function backupStatus(): BackupStatus {
  return { ...EMPTY_STATUS, ...((get().singletons.backupStatus ?? {}) as Partial<BackupStatus>) }
}

const clamp = (n: number, low: number, high: number) =>
  Number.isFinite(n) ? Math.min(high, Math.max(low, Math.round(n))) : low

/* ── What actually gets written ───────────────────────────────────────── */

/**
 * The database with credentials taken out.
 *
 * Both the nightly copy and the manual download go through here, so the two can
 * never drift into one carrying something the other strips.
 */
export function backupPayload(): Record<string, unknown> {
  const copy = structuredClone(get()) as {
    collections: Record<string, Record<string, unknown>[]>
  }
  copy.collections.users = (copy.collections.users ?? []).map((u) => ({
    ...u, passwordHash: '[excluded from backup]',
  }))
  copy.collections.sessions = []
  return copy as unknown as Record<string, unknown>
}

const stamp = (at: Date) => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}`
}

const DATED = /^huerex-\d{4}-\d{2}-\d{2}(-\d+)?\.json$/

/** Dated copies this module wrote, oldest first. */
async function existing(folder: string): Promise<string[]> {
  try {
    return (await fsp.readdir(folder)).filter((name) => DATED.test(name)).sort()
  } catch {
    return []                                   // not made yet, or unreachable
  }
}

/**
 * A name nothing is using.
 *
 * Today's date is the whole name for the first copy of the day. Later ones get
 * a number rather than a timestamp: two runs within the same second would
 * otherwise pick the same name, and the second would quietly replace the first
 * — which is precisely the thing keeping several copies is meant to prevent.
 */
async function freeName(folder: string, at: Date): Promise<string> {
  const base = `huerex-${stamp(at)}`
  for (let n = 0; n < 1000; n++) {
    const name = n === 0 ? `${base}.json` : `${base}-${n}.json`
    try {
      await fsp.access(path.join(folder, name))
    } catch {
      return name                               // nothing there — this one is free
    }
  }
  throw new Error('a thousand backups already exist for today')
}

/** True while a backup is in flight, so a hung one is never piled onto. */
let running = false

export async function runBackup(reason: string): Promise<BackupStatus> {
  if (running) {
    return { ...backupStatus(), lastError: 'a backup is already running', lastReason: reason }
  }
  running = true

  const settings = backupSettings()
  const at = new Date()
  try {
    // Whatever is in memory but not yet on disk belongs in the backup too. This
    // one stays synchronous: it writes the local database, not the far folder.
    flush()
    const body = JSON.stringify(backupPayload())

    const written = await withDeadline((async () => {
      await fsp.mkdir(settings.folder, { recursive: true })
      const target = path.join(settings.folder, await freeName(settings.folder, at))
      const temp = `${target}.writing`
      // Written whole and then moved into place, so a backup interrupted
      // halfway never replaces a good one, and readable by its owner alone.
      await fsp.writeFile(temp, body, { mode: 0o600 })
      await fsp.rename(temp, target)
      return { target, bytes: (await fsp.stat(target)).size }
    })(), 'writing the backup')

    await prune(settings)

    return remember({
      lastAt: at.toISOString(),
      lastPath: written.target,
      lastBytes: written.bytes,
      lastError: null,
      lastReason: reason,
    })
  } catch (problem) {
    // A failed backup must be loud rather than silent: the status is what the
    // Settings page reads, and a stale success would be worse than an error.
    return remember({
      ...backupStatus(),
      lastError: problem instanceof Error ? problem.message : String(problem),
      lastReason: reason,
    })
  } finally {
    running = false
  }
}

/** Deletes the oldest copies beyond the retention limit. */
async function prune(settings: BackupSettings) {
  try {
    const files = await withDeadline(existing(settings.folder), 'listing old backups')
    for (const name of files.slice(0, Math.max(0, files.length - settings.keep))) {
      await fsp.unlink(path.join(settings.folder, name)).catch(() => { /* already gone */ })
    }
  } catch {
    // Failing to tidy up is not worth failing the backup that just succeeded.
  }
}

function remember(status: BackupStatus): BackupStatus {
  get().singletons.backupStatus = status
  // `touch` alone would leave this sitting in memory for 250ms. A backup is
  // infrequent enough to warrant writing at once, and the record of whether the
  // data is safe should survive the machine losing power straight afterwards.
  touch()
  flush()
  return status
}

/* ── The schedule ─────────────────────────────────────────────────────── */

/** The most recent moment the backup should have run, at or before `now`. */
function dueAt(now: Date, settings: BackupSettings): Date {
  const today = new Date(now)
  today.setHours(settings.hour, settings.minute, 0, 0)
  if (today <= now) return today
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  return yesterday
}

/** True when the appointed time has passed and no copy was made since. */
export function backupIsDue(now = new Date()): boolean {
  const settings = backupSettings()
  if (!settings.enabled) return false
  const last = backupStatus().lastAt
  if (!last) return true
  return new Date(last) < dueAt(now, settings)
}

let timer: NodeJS.Timeout | null = null

/**
 * Checks every minute rather than sleeping until the appointed hour, so a
 * machine that was suspended, or had its clock corrected, still catches up.
 */
export function startBackupSchedule(onRun?: (status: BackupStatus) => void) {
  if (timer) return
  const tick = async () => {
    if (!backupIsDue()) return
    // Having a copy already means the appointed hour went by unattended — the
    // machine was off, or asleep — so this one is making up for a missed night.
    const missed = backupStatus().lastAt !== null
    try {
      onRun?.(await runBackup(missed ? 'catch-up' : 'scheduled'))
    } catch (problem) {
      // runBackup handles its own failures; this is the last resort, so that a
      // surprise here can never take the server down with an unhandled
      // rejection at nine at night.
      console.error('  backup tick failed unexpectedly:', problem)
    }
  }
  // A moment after start, so a PC switched on in the morning takes last night's
  // copy without delaying the boot.
  setTimeout(() => { void tick() }, 30_000).unref?.()
  timer = setInterval(() => { void tick() }, 60_000)
  timer.unref?.()
}

export function stopBackupSchedule() {
  if (timer) { clearInterval(timer); timer = null }
}
