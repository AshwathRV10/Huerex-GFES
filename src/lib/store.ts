/**
 * The client store.
 *
 * Everything lives here in memory and every derived figure is recomputed from
 * it, so a number can never drift from the entry behind it. Writes go to the
 * server and the local copy in the same step — the grid updates immediately
 * and rolls back if the server refuses.
 */
import { create } from 'zustand'
import {
  api, isConflict, setUnauthenticatedHandler,
  type PresenceEntry, type ServerState, type SessionInfo,
} from './api'
import type {
  AppState, Buyer, CollectionKey, Costing, Masters, Order, RateEntry, Settings,
} from './types'
import { derive, type Derived, type ProcessTypes } from './engine/production'
import { deriveSets, type SetSummary } from './engine/sets'
import { deriveAlerts, type Alert } from './engine/alerts'
import { harvestRates } from './engine/costing'

const EMPTY_STATE: AppState = {
  orders: [], buyers: [], routeSteps: [], matrix: [], fabric: [], trims: [], jobwork: [],
  cutting: [], fusing: [], sewing: [], checking: [], packing: [], inspection: [],
  shipment: [], approvals: [], waivers: [], costings: [], rateBook: [],
}

const DEFAULT_SETTINGS: Settings = {
  currency: 'INR',
  defaultFabricLeadDays: 30,
  fabricDueSoonWindowDays: 7,
  recutLeadDays: 14,
  recutDueNoticeWindowDays: 3,
  agedWipDays: 14,
  jobWorkWatchDays: 14,
  fabricWastageThresholdPct: 0.12,
  dhuThresholdPct: 0.05,
  defaultRejectionPct: 0.02,
  defaultFabricWastagePct: 0.08,
  defaultTrimWastagePct: 0.03,
}

export interface Toast {
  id: string
  tone: 'ok' | 'risk' | 'info'
  message: string
  detail?: string
}

interface Store {
  ready: boolean
  error: string | null
  saving: number

  /* ── Session ─────────────────────────────────────────────────────── */
  /** null while unknown, then either a session or `false` for signed out. */
  session: SessionInfo | null
  signedIn: boolean
  needsBootstrap: boolean
  authChecked: boolean
  mustChangePassword: boolean
  /** Everyone with the app open right now. */
  present: PresenceEntry[]
  /** True while the live connection is up. */
  live: boolean
  data: AppState
  masters: Masters
  settings: Settings
  processTypes: ProcessTypes
  toasts: Toast[]

  load: () => Promise<void>
  checkAuth: () => Promise<void>
  signIn: (userName: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  bootstrapAdmin: (input: { userName: string; displayName: string; password: string }) => Promise<void>
  changeOwnPassword: (current: string, next: string) => Promise<void>
  /** True when the signed-in role grants this permission. */
  can: (permission: string) => boolean
  connectLive: () => void
  notify: (tone: Toast['tone'], message: string, detail?: string) => void
  dismiss: (id: string) => void

  add: <K extends CollectionKey>(collection: K, row: Partial<AppState[K][number]>) => Promise<AppState[K][number]>
  addMany: <K extends CollectionKey>(collection: K, rows: Partial<AppState[K][number]>[]) => Promise<void>
  /**
   * `expectRev` refuses the write if somebody else has changed the row since,
   * instead of overwriting them. Without it, last write wins.
   */
  patch: <K extends CollectionKey>(
    collection: K, id: string, patch: Partial<AppState[K][number]>, expectRev?: number,
  ) => Promise<void>
  drop: (collection: CollectionKey, id: string) => Promise<void>

  addMaster: (list: string, value: string) => Promise<string>
  removeMaster: (list: string, value: string) => Promise<void>
  saveSettings: (patch: Partial<Settings>) => Promise<void>
  saveProcessTypes: (types: ProcessTypes) => Promise<void>

  /** Saves a costing and folds every rate in it back into the rate book. */
  saveCosting: (costing: Costing) => Promise<void>
}

let toastCounter = 0

/** The one live connection. Kept outside the store so React never re-renders on it. */
let liveSource: EventSource | null = null

/** Any 401 from any call drops the session, so a revoked account cannot linger. */
setUnauthenticatedHandler(() => {
  liveSource?.close()
  liveSource = null
  const store = useStore.getState()
  if (store.signedIn) {
    useStore.setState({ signedIn: false, session: null, live: false, present: [] })
  }
})

type SetState = (partial: Partial<Store> | ((s: Store) => Partial<Store>)) => void
type GetState = () => Store

/**
 * Folds somebody else's change into our copy.
 *
 * The row arrives already filtered by the server for what this viewer may see,
 * so anything that reaches here is safe to store as-is.
 */
function applyRemoteChange(
  set: SetState,
  get: GetState,
  change: {
    collection: CollectionKey; action: string; recordId?: string
    row?: Record<string, unknown> | null; byUserName: string
  },
) {
  const { collection, action, recordId, row } = change
  const current = get().data[collection] as { id: string }[] | undefined
  if (!current) return

  if (action === 'reload') { get().load(); return }
  if (action === 'delete' && recordId) {
    set((s) => ({ data: { ...s.data, [collection]: current.filter((r) => r.id !== recordId) } as AppState }))
    return
  }
  if (!row || !recordId) return

  const exists = current.some((r) => r.id === recordId)
  set((s) => ({
    data: {
      ...s.data,
      [collection]: exists
        ? current.map((r) => (r.id === recordId ? { ...r, ...row } : r))
        : [...current, row as { id: string }],
    } as AppState,
  }))
}

export const useStore = create<Store>((set, get) => ({
  ready: false,
  error: null,
  saving: 0,
  session: null,
  signedIn: false,
  needsBootstrap: false,
  authChecked: false,
  mustChangePassword: false,
  present: [],
  live: false,
  data: EMPTY_STATE,
  masters: {},
  settings: DEFAULT_SETTINGS,
  processTypes: {},
  toasts: [],

  can(permission) {
    return get().session?.permissions.includes(permission) ?? false
  },

  async checkAuth() {
    try {
      const status = await api.authStatus()
      if (!status.signedIn) {
        set({ authChecked: true, signedIn: false, session: null, needsBootstrap: status.needsBootstrap, ready: true })
        return
      }
      const session = await api.me()
      set({ authChecked: true, signedIn: true, session, needsBootstrap: false })
      await get().load()
      get().connectLive()
    } catch (error) {
      set({
        authChecked: true, signedIn: false, session: null, ready: true,
        error: error instanceof Error && !(error as { status?: number }).status
          ? error.message : null,
      })
    }
  },

  async signIn(userName, password) {
    const result = await api.login(userName, password)
    const session = await api.me()
    set({ signedIn: true, session, mustChangePassword: result.mustChangePassword, error: null })
    await get().load()
    get().connectLive()
  },

  async signOut() {
    try { await api.logout() } catch { /* the cookie is going either way */ }
    liveSource?.close()
    liveSource = null
    set({
      signedIn: false, session: null, present: [], live: false,
      data: EMPTY_STATE, masters: {}, mustChangePassword: false,
    })
  },

  async bootstrapAdmin(input) {
    await api.bootstrap(input)
    const session = await api.me()
    set({ signedIn: true, session, needsBootstrap: false, error: null })
    await get().load()
    get().connectLive()
  },

  async changeOwnPassword(current, next) {
    await api.changePassword(current, next)
    set({ mustChangePassword: false })
    get().notify('ok', 'Password changed', 'Your other sessions have been signed out')
  },

  connectLive() {
    if (liveSource) return
    liveSource = new EventSource('/api/events', { withCredentials: true })

    liveSource.onopen = () => set({ live: true })
    liveSource.onerror = () => {
      // EventSource reconnects by itself; this only reflects the state.
      set({ live: false })
    }

    liveSource.addEventListener('presence', (event) => {
      try { set({ present: JSON.parse((event as MessageEvent).data) }) } catch { /* ignore */ }
    })

    liveSource.addEventListener('change', (event) => {
      try {
        const change = JSON.parse((event as MessageEvent).data) as {
          collection: CollectionKey; action: string; recordId?: string
          row?: Record<string, unknown> | null; byUserId: string | null; byUserName: string
        }
        // Skip the echo of our own write; the optimistic update already landed.
        if (change.byUserId && change.byUserId === get().session?.userId) return
        applyRemoteChange(set, get, change)
      } catch { /* a malformed frame is not worth crashing over */ }
    })

    liveSource.addEventListener('reload', () => { get().load() })

    liveSource.addEventListener('reauth', (event) => {
      let reason = 'Your access has changed. Please sign in again.'
      try { reason = JSON.parse((event as MessageEvent).data).reason ?? reason } catch { /* keep default */ }
      liveSource?.close()
      liveSource = null
      set({ signedIn: false, session: null, live: false, present: [] })
      get().notify('info', 'Signed out', reason)
    })
  },

  async load() {
    try {
      const server: ServerState = await api.getState()
      set({
        ready: true,
        error: null,
        data: { ...EMPTY_STATE, ...(server.collections as unknown as AppState) },
        masters: server.masters ?? {},
        settings: { ...DEFAULT_SETTINGS, ...(server.settings ?? {}) },
        processTypes: server.processTypes ?? {},
      })
    } catch (error) {
      const status = (error as { status?: number }).status
      if (status === 401) { set({ ready: true, signedIn: false, session: null }); return }
      set({ ready: true, error: error instanceof Error ? error.message : 'Could not load the data' })
    }
  },

  notify(tone, message, detail) {
    const id = `t${++toastCounter}`
    set((s) => ({ toasts: [...s.toasts, { id, tone, message, detail }] }))
    setTimeout(() => get().dismiss(id), tone === 'risk' ? 7000 : 3800)
  },

  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },

  async add(collection, row) {
    set((s) => ({ saving: s.saving + 1 }))
    try {
      const created = await api.create(collection, row as never)
      set((s) => ({
        data: { ...s.data, [collection]: [...s.data[collection], created] } as AppState,
      }))
      return created as never
    } catch (error) {
      get().notify('risk', 'Could not save that row', message(error))
      throw error
    } finally {
      set((s) => ({ saving: s.saving - 1 }))
    }
  },

  async addMany(collection, rows) {
    if (rows.length === 0) return
    set((s) => ({ saving: s.saving + 1 }))
    try {
      const created = await api.createMany(collection, rows as never)
      set((s) => ({
        data: { ...s.data, [collection]: [...s.data[collection], ...created] } as AppState,
      }))
    } catch (error) {
      get().notify('risk', 'Could not save those rows', message(error))
      throw error
    } finally {
      set((s) => ({ saving: s.saving - 1 }))
    }
  },

  async patch(collection, id, patchValue, expectRev) {
    const previous = get().data[collection] as { id: string }[]
    // Show the change straight away; put it back if the server says no.
    set((s) => ({
      saving: s.saving + 1,
      data: {
        ...s.data,
        [collection]: (s.data[collection] as { id: string }[]).map((r) =>
          r.id === id ? { ...r, ...patchValue } : r),
      } as AppState,
    }))
    try {
      await api.update(collection, id, patchValue as never, expectRev)
    } catch (error) {
      set((s) => ({ data: { ...s.data, [collection]: previous } as AppState }))
      // A conflict is not a failure to report here — the caller is showing the
      // other person's version and asking what to do about it.
      if (!isConflict(error)) get().notify('risk', 'Could not save that change', message(error))
      throw error
    } finally {
      set((s) => ({ saving: s.saving - 1 }))
    }
  },

  async drop(collection, id) {
    const previous = get().data[collection] as { id: string }[]
    set((s) => ({
      saving: s.saving + 1,
      data: {
        ...s.data,
        [collection]: (s.data[collection] as { id: string }[]).filter((r) => r.id !== id),
      } as AppState,
    }))
    try {
      await api.remove(collection, id)
    } catch (error) {
      set((s) => ({ data: { ...s.data, [collection]: previous } as AppState }))
      get().notify('risk', 'Could not delete that row', message(error))
      throw error
    } finally {
      set((s) => ({ saving: s.saving - 1 }))
    }
  },

  async addMaster(list, value) {
    const trimmed = value.trim()
    if (!trimmed) return ''
    const existing = (get().masters[list] ?? []).find((v) => v.toLowerCase() === trimmed.toLowerCase())
    if (existing) return existing
    // Offer it in the dropdown immediately; the server call is the record.
    set((s) => ({ masters: { ...s.masters, [list]: [...(s.masters[list] ?? []), trimmed] } }))
    try {
      const result = await api.addMaster(list, trimmed)
      set((s) => ({ masters: { ...s.masters, [list]: result.values } }))
      if (result.added) get().notify('ok', `Added “${result.value}”`, `Saved to ${humanList(list)} — it will be there next time`)
      return result.value
    } catch (error) {
      set((s) => ({ masters: { ...s.masters, [list]: (s.masters[list] ?? []).filter((v) => v !== trimmed) } }))
      get().notify('risk', 'Could not remember that value', message(error))
      return trimmed
    }
  },

  async removeMaster(list, value) {
    const previous = get().masters[list] ?? []
    set((s) => ({ masters: { ...s.masters, [list]: previous.filter((v) => v !== value) } }))
    try {
      await api.removeMaster(list, value)
    } catch (error) {
      set((s) => ({ masters: { ...s.masters, [list]: previous } }))
      get().notify('risk', 'Could not remove that value', message(error))
    }
  },

  async saveSettings(patchValue) {
    const previous = get().settings
    set((s) => ({ settings: { ...s.settings, ...patchValue } }))
    try {
      await api.patchSettings(patchValue)
    } catch (error) {
      set({ settings: previous })
      get().notify('risk', 'Could not save settings', message(error))
    }
  },

  async saveProcessTypes(types) {
    const previous = get().processTypes
    set({ processTypes: types })
    try {
      await api.setProcessTypes(types)
    } catch (error) {
      set({ processTypes: previous })
      get().notify('risk', 'Could not save process types', message(error))
    }
  },

  async saveCosting(costing) {
    const { data } = get()
    const order = data.orders.find((o) => o.orderNo === costing.orderNo)
    const next = { ...costing, updatedAt: new Date().toISOString() }
    const exists = data.costings.some((c) => c.id === costing.id)

    // A costing is the row two people are most likely to have open at once, so
    // the save carries the revision it was loaded at and is refused if somebody
    // else has saved in the meantime.
    if (exists) await get().patch('costings', costing.id, next, costing.rev)
    else await get().add('costings', next)

    if (!order) return

    // Fold every rate in this costing back into the rate book, so the next
    // order for this colour, fabric, style or vendor starts pre-filled.
    const harvested = harvestRates(next, order)
    const book = [...get().data.rateBook]
    const toCreate: Partial<RateEntry>[] = []
    const toUpdate: { id: string; patch: Partial<RateEntry> }[] = []

    for (const candidate of harvested) {
      const match = book.find(
        (entry) => entry.kind === candidate.kind && sameScope(entry.scope, candidate.scope),
      )
      if (match) {
        if (match.rate !== candidate.rate || match.lastOrderNo !== candidate.lastOrderNo) {
          toUpdate.push({
            id: match.id,
            patch: { rate: candidate.rate, uses: match.uses + 1, lastUsedAt: candidate.lastUsedAt, lastOrderNo: candidate.lastOrderNo },
          })
        }
      } else {
        toCreate.push({ ...candidate, uses: 1 })
      }
    }

    await Promise.all([
      toCreate.length ? get().addMany('rateBook', toCreate as never) : Promise.resolve(),
      ...toUpdate.map((u) => get().patch('rateBook', u.id, u.patch as never)),
    ])

    const learned = toCreate.length
    get().notify(
      'ok',
      'Costing saved',
      learned > 0
        ? `${learned} new rate${learned > 1 ? 's' : ''} remembered for next time`
        : 'Rates updated in the rate book',
    )
  },
}))

const sameScope = (a: RateEntry['scope'], b: RateEntry['scope']) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof RateEntry['scope']>
  for (const key of keys) {
    if ((a[key] ?? '').toLowerCase() !== (b[key] ?? '').toLowerCase()) return false
  }
  return true
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

const humanList = (list: string) =>
  list.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim().toLowerCase()

/* ── Derived views ───────────────────────────────────────────────────── */

let cacheKey = ''
let cached: { derived: Derived; sets: SetSummary; alerts: { open: Alert[]; suppressed: Alert[] } } | null = null

/**
 * Recomputes everything whenever the underlying data changes.
 *
 * The identity of each collection array is the cache key — the store replaces
 * arrays rather than mutating them, so this is both cheap and exact.
 */
export function useDerived() {
  const data = useStore((s) => s.data)
  const settings = useStore((s) => s.settings)
  const processTypes = useStore((s) => s.processTypes)

  const key = [
    data.orders, data.matrix, data.routeSteps, data.cutting, data.fusing, data.jobwork,
    data.sewing, data.checking, data.packing, data.shipment, data.fabric, data.trims,
    data.approvals, data.waivers, data.inspection, settings, processTypes,
  ].map((part) => idOf(part)).join('|')

  if (key !== cacheKey || !cached) {
    const derived = derive(data, settings, processTypes)
    const sets = deriveSets(data, derived.cells)
    const alerts = deriveAlerts(data, derived, sets, settings)
    cached = { derived, sets, alerts }
    cacheKey = key
  }
  return cached
}

const identities = new WeakMap<object, number>()
let identityCounter = 0
function idOf(value: unknown): number {
  if (typeof value !== 'object' || value === null) return 0
  let id = identities.get(value)
  if (id === undefined) { id = ++identityCounter; identities.set(value, id) }
  return id
}

/* ── Small selectors used all over the app ───────────────────────────── */

export const useOrders = () => useStore((s) => s.data.orders)
export const useMasters = () => useStore((s) => s.masters)
export const useSettings = () => useStore((s) => s.settings)

export function useOrder(orderNo: string | undefined): Order | undefined {
  return useStore((s) => s.data.orders.find((o) => o.orderNo === orderNo))
}

export function useBuyer(name: string | undefined): Buyer | undefined {
  return useStore((s) => s.data.buyers.find((b) => b.name === name))
}
