/**
 * A tiny, dependency-free document store.
 *
 * The whole database is one JSON file. That is a deliberate choice for a
 * factory-floor tool: no native modules to compile, no service to run, and a
 * backup is a file copy. Writes are debounced and land atomically (temp file
 * + rename) so a power cut can never leave a half-written database.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
/**
 * Where the database lives. HUEREX_DB overrides it, which is how the security
 * tests get a throwaway file and how a deployment can put the data on a
 * different disk from the code.
 */
const DB_FILE = process.env.HUEREX_DB
  ? path.resolve(process.env.HUEREX_DB)
  : path.resolve(__dirname, '..', 'data', 'huerex.json')
export const DATA_DIR = path.dirname(DB_FILE)
const TMP_FILE = path.join(DATA_DIR, `.${path.basename(DB_FILE)}.tmp`)

export type Doc = Record<string, any> & { id: string }
export type Database = {
  version: number
  collections: Record<string, Doc[]>
  singletons: Record<string, any>
  updatedAt: string
}

/** Every collection the API will serve. Unknown names are rejected. */
export const COLLECTIONS = [
  'orders', 'routeSteps', 'matrix',
  'fabric', 'trims',
  'cutting', 'fusing', 'jobwork', 'sewing', 'checking', 'packing', 'inspection', 'shipment',
  'approvals', 'waivers',
  'costings', 'rateBook', 'buyers',
  // Authentication and accountability. These never reach the browser as rows;
  // they are served by their own endpoints, filtered by permission.
  'users', 'roles', 'sessions', 'auditLog',
] as const

/** Collections that hold business data the app derives its figures from. */
export const BUSINESS_COLLECTIONS = COLLECTIONS.filter(
  (c) => !['users', 'roles', 'sessions', 'auditLog'].includes(c),
)
export type CollectionName = (typeof COLLECTIONS)[number]

const empty = (): Database => ({
  version: 1,
  collections: Object.fromEntries(COLLECTIONS.map((c) => [c, []])) as Record<string, Doc[]>,
  singletons: { masters: {}, settings: {}, processTypes: {} },
  updatedAt: new Date().toISOString(),
})

let db: Database = empty()
let dirty = false
let timer: NodeJS.Timeout | null = null

export function load(): Database {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  if (fs.existsSync(DB_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) as Database
      db = { ...empty(), ...parsed }
      // A database written by an older build may not know a newer collection.
      for (const c of COLLECTIONS) if (!db.collections[c]) db.collections[c] = []
      if (!db.singletons) db.singletons = { masters: {}, settings: {}, processTypes: {} }
    } catch (err) {
      const backup = `${DB_FILE}.corrupt-${Date.now()}`
      fs.copyFileSync(DB_FILE, backup)
      console.error(`[store] ${DB_FILE} is unreadable, kept a copy at ${backup}`, err)
      db = empty()
    }
  }
  return db
}

export const get = () => db

/** Replaces the database, backfilling anything the incoming copy is missing. */
export function replace(next: Partial<Database>) {
  const base = empty()
  db = {
    ...base,
    ...next,
    collections: { ...base.collections, ...(next.collections ?? {}) },
    singletons: { ...base.singletons, ...(next.singletons ?? {}) },
  }
  for (const c of COLLECTIONS) if (!Array.isArray(db.collections[c])) db.collections[c] = []
  touch()
}

/** Marks the database changed and schedules a flush. */
export function touch() {
  db.updatedAt = new Date().toISOString()
  dirty = true
  if (timer) return
  timer = setTimeout(() => { timer = null; flush() }, 250)
}

export function flush() {
  if (!dirty) return
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(TMP_FILE, JSON.stringify(db, null, 1))
  fs.renameSync(TMP_FILE, DB_FILE)
  dirty = false
}

export function isCollection(name: string): name is CollectionName {
  return (COLLECTIONS as readonly string[]).includes(name)
}

export function collection(name: CollectionName): Doc[] {
  return (db.collections[name] ||= [])
}

let counter = 0
export function newId(prefix = 'r'): string {
  counter = (counter + 1) % 0xffff
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36).padStart(3, '0')}${Math.random()
    .toString(36)
    .slice(2, 6)}`
}

// Never lose an edit because the process was asked to stop.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => { flush(); process.exit(0) })
}
process.on('exit', flush)
