/**
 * HUEREX GFES API.
 *
 * The client keeps the whole dataset in memory and derives everything from it,
 * so the server's job is narrow: hand over the state, accept row-level writes,
 * and remember every value anyone types so it can be offered back next time.
 */
import express from 'express'
import cors from 'cors'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  load, get, flush, touch, newId, isCollection, collection, replace, type Doc,
} from './store.js'
import { buildSeed } from './seed.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PORT = Number(process.env.PORT ?? 5274)

load()
// An empty data directory means a first run: start from the workbook.
if (get().collections.orders.length === 0 && Object.keys(get().singletons.masters ?? {}).length === 0) {
  replace(buildSeed())
  flush()
  console.log('[api] first run — imported the HUEREX GFES V5.1 workbook')
}

const app = express()
app.use(cors())
app.use(express.json({ limit: '32mb' }))

const ok = (res: express.Response, body: unknown) => res.json({ ok: true, data: body })
const bad = (res: express.Response, code: number, message: string) =>
  res.status(code).json({ ok: false, error: message })

/* ── Whole state ─────────────────────────────────────────────────────── */
app.get('/api/state', (_req, res) => {
  const db = get()
  ok(res, {
    collections: db.collections,
    masters: db.singletons.masters,
    settings: db.singletons.settings,
    processTypes: db.singletons.processTypes,
    updatedAt: db.updatedAt,
  })
})

/* ── Settings ────────────────────────────────────────────────────────── */
app.put('/api/process-types', (req, res) => {
  get().singletons.processTypes = req.body ?? {}
  touch()
  ok(res, get().singletons.processTypes)
})

app.patch('/api/settings', (req, res) => {
  get().singletons.settings = { ...(get().singletons.settings ?? {}), ...req.body }
  touch()
  ok(res, get().singletons.settings)
})

/* ── Housekeeping ────────────────────────────────────────────────────── */
app.get('/api/backup', (_req, res) => {
  flush()
  res.setHeader('Content-Disposition', `attachment; filename="huerex-${new Date().toISOString().slice(0, 10)}.json"`)
  res.json(get())
})

app.post('/api/restore', (req, res) => {
  if (!req.body?.collections) return bad(res, 400, 'That does not look like a HUEREX backup')
  replace(req.body)
  flush()
  ok(res, { restored: true })
})

app.post('/api/reset', (_req, res) => {
  replace(buildSeed())
  flush()
  ok(res, { reset: true })
})

app.get('/api/health', (_req, res) => ok(res, { status: 'up', updatedAt: get().updatedAt }))

/* ── Row CRUD ────────────────────────────────────────────────────────── */
/** Paths that are endpoints in their own right, never collections. */
const RESERVED = new Set(['state', 'masters', 'settings', 'process-types', 'backup', 'restore', 'reset', 'health'])
const collectionOr404 = (name: string, res: express.Response) => {
  if (RESERVED.has(name) || !isCollection(name)) {
    bad(res, 404, `Unknown collection "${name}"`)
    return false
  }
  return true
}

app.post('/api/:name', (req, res) => {
  const { name } = req.params
  if (!collectionOr404(name, res)) return
  if (!isCollection(name)) return
  const rows = Array.isArray(req.body) ? req.body : [req.body]
  const created = rows.map((row: Doc) => {
    const doc = { ...row, id: row.id || newId(name.slice(0, 3)) }
    collection(name).push(doc)
    return doc
  })
  touch()
  ok(res, Array.isArray(req.body) ? created : created[0])
})

app.patch('/api/:name/:id', (req, res) => {
  const { name, id } = req.params
  if (!collectionOr404(name, res)) return
  if (!isCollection(name)) return
  const rows = collection(name)
  const i = rows.findIndex((r) => r.id === id)
  if (i === -1) return bad(res, 404, `No row ${id} in ${name}`)
  rows[i] = { ...rows[i], ...req.body, id }
  touch()
  ok(res, rows[i])
})

app.delete('/api/:name/:id', (req, res) => {
  const { name, id } = req.params
  if (!collectionOr404(name, res)) return
  if (!isCollection(name)) return
  const rows = collection(name)
  const i = rows.findIndex((r) => r.id === id)
  if (i === -1) return bad(res, 404, `No row ${id} in ${name}`)
  const [removed] = rows.splice(i, 1)
  touch()
  ok(res, removed)
})

/** Replaces every row of a collection — used when a grid is saved wholesale. */
app.put('/api/:name', (req, res) => {
  const { name } = req.params
  if (!collectionOr404(name, res)) return
  if (!isCollection(name)) return
  if (!Array.isArray(req.body)) return bad(res, 400, 'Expected an array of rows')
  get().collections[name] = req.body.map((r: Doc) => ({ ...r, id: r.id || newId(name.slice(0, 3)) }))
  touch()
  ok(res, get().collections[name])
})

/* ── Masters: the memory behind every type-to-add field ──────────────── */
app.get('/api/masters', (_req, res) => ok(res, get().singletons.masters))

app.post('/api/masters/:list', (req, res) => {
  const { list } = req.params
  const value = String(req.body?.value ?? '').trim()
  if (!value) return bad(res, 400, 'A value is required')
  const masters = (get().singletons.masters ||= {})
  const current: string[] = (masters[list] ||= [])
  // Case-insensitive: "off-white" must not become a second OFF-WHITE.
  const existing = current.find((v) => v.toLowerCase() === value.toLowerCase())
  if (!existing) { current.push(value); touch() }
  ok(res, { list, value: existing ?? value, values: current, added: !existing })
})

app.delete('/api/masters/:list/:value', (req, res) => {
  const { list, value } = req.params
  const masters = (get().singletons.masters ||= {})
  const current: string[] = (masters[list] ||= [])
  masters[list] = current.filter((v) => v.toLowerCase() !== decodeURIComponent(value).toLowerCase())
  touch()
  ok(res, { list, values: masters[list] })
})

app.put('/api/masters/:list', (req, res) => {
  const { list } = req.params
  if (!Array.isArray(req.body)) return bad(res, 400, 'Expected an array of values')
  ;(get().singletons.masters ||= {})[list] = req.body.map(String)
  touch()
  ok(res, get().singletons.masters[list])
})

/* ── Serve the built app in production ───────────────────────────────── */
const dist = path.join(ROOT, 'dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')))
}

app.listen(PORT, () => {
  console.log(`  HUEREX GFES api  →  http://localhost:${PORT}`)
  if (!fs.existsSync(dist)) console.log(`  web (vite dev)   →  http://localhost:5273`)
})
