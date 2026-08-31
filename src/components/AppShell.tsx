/**
 * The frame every page sits in: the rail on the left, the bar across the top,
 * the command palette behind ⌘K, and the toasts that confirm a save.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import {
  AlertTriangle, Banknote, BadgeIndianRupee, Boxes, Calculator, ChartNoAxesCombined,
  CheckCheck, ClipboardCheck, Cog, Container, Factory, FileText, Gauge, Grid2x2,
  Layers, Moon, Package, PanelLeftClose, PanelLeft, Ruler, Scissors, Search,
  Shirt, Sparkles, Sun, Truck, Users, Waypoints, X,
} from 'lucide-react'
import { useDerived, useStore } from '../lib/store'
import { Badge, Button } from './ui'

/* ── Navigation ──────────────────────────────────────────────────────── */

interface NavItem { to: string; label: string; icon: ReactNode; badge?: 'alerts' }
interface NavGroup { title: string; items: NavItem[] }

const size = 'size-[1.05rem]'

export const NAV: NavGroup[] = [
  {
    title: 'Control',
    items: [
      { to: '/', label: 'Dashboard', icon: <Gauge className={size} /> },
      { to: '/alerts', label: 'Alerts', icon: <AlertTriangle className={size} />, badge: 'alerts' },
    ],
  },
  {
    title: 'Commercial',
    items: [
      { to: '/orders', label: 'Orders', icon: <Shirt className={size} /> },
      { to: '/costing', label: 'Costing', icon: <Calculator className={size} /> },
      { to: '/rates', label: 'Rate book', icon: <BadgeIndianRupee className={size} /> },
      { to: '/buyers', label: 'Buyers', icon: <Users className={size} /> },
    ],
  },
  {
    title: 'Materials',
    items: [
      { to: '/fabric', label: 'Fabric', icon: <Layers className={size} /> },
      { to: '/trims', label: 'Trims', icon: <Boxes className={size} /> },
    ],
  },
  {
    title: 'Floor',
    items: [
      { to: '/cutting', label: 'Cutting', icon: <Scissors className={size} /> },
      { to: '/fusing', label: 'Fusing', icon: <Ruler className={size} /> },
      { to: '/job-work', label: 'Job work', icon: <Truck className={size} /> },
      { to: '/sewing', label: 'Sewing', icon: <Factory className={size} /> },
      { to: '/checking', label: 'Checking', icon: <CheckCheck className={size} /> },
      { to: '/packing', label: 'Packing', icon: <Package className={size} /> },
      { to: '/inspection', label: 'Inspection', icon: <ClipboardCheck className={size} /> },
      { to: '/shipment', label: 'Shipment', icon: <Container className={size} /> },
    ],
  },
  {
    title: 'Analysis',
    items: [
      { to: '/wip', label: 'WIP', icon: <Waypoints className={size} /> },
      { to: '/reconciliation', label: 'Reconciliation', icon: <ChartNoAxesCombined className={size} /> },
      { to: '/timeline', label: 'Timeline', icon: <FileText className={size} /> },
      { to: '/sets', label: 'Set control', icon: <Grid2x2 className={size} /> },
    ],
  },
  {
    title: 'Setup',
    items: [
      { to: '/approvals', label: 'Approvals', icon: <Banknote className={size} /> },
      { to: '/masters', label: 'Masters', icon: <Sparkles className={size} /> },
      { to: '/settings', label: 'Settings', icon: <Cog className={size} /> },
    ],
  },
]

/* ── Theme ───────────────────────────────────────────────────────────── */

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#0a0a0c' : '#f6f5f2')
    try { localStorage.setItem('huerex.theme', theme) } catch { /* private mode */ }
  }, [theme])

  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))] as const
}

/* ── Shell ───────────────────────────────────────────────────────────── */

export function AppShell({ children }: { children: ReactNode }) {
  const [theme, toggleTheme] = useTheme()
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('huerex.rail') === 'collapsed' } catch { return false }
  })
  const [mobileOpen, setMobileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const { alerts } = useDerived()
  const saving = useStore((s) => s.saving)
  const location = useLocation()

  useEffect(() => {
    try { localStorage.setItem('huerex.rail', collapsed ? 'collapsed' : 'open') } catch { /* private mode */ }
  }, [collapsed])

  useEffect(() => { setMobileOpen(false) }, [location.pathname])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen(true)
      }
      if (event.key === '/' && !isTyping(event.target)) {
        event.preventDefault()
        setPaletteOpen(true)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const highCount = alerts.open.filter((a) => a.severity === 'HIGH').length

  return (
    <div className="h-full flex bg-canvas">
      {/* Rail */}
      <aside
        className={clsx(
          'shrink-0 border-r border-line bg-surface/70 backdrop-blur-sm flex flex-col transition-[width] duration-200',
          collapsed ? 'w-[3.75rem]' : 'w-[15rem]',
          'max-lg:fixed max-lg:inset-y-0 max-lg:z-40 max-lg:shadow-pop',
          mobileOpen ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-full',
          'max-lg:transition-transform max-lg:w-[15rem]',
        )}
      >
        <div className={clsx('h-14 flex items-center gap-2.5 border-b border-line shrink-0', collapsed ? 'px-3 justify-center' : 'px-4')}>
          <Link to="/" className="flex items-center gap-2.5 min-w-0">
            <span className="size-7 rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 grid place-items-center shrink-0 shadow-sm">
              <Shirt className="size-4 text-white" />
            </span>
            {!collapsed && (
              <span className="min-w-0">
                <span className="block font-semibold text-ink leading-none tracking-tight">HUEREX</span>
                <span className="block text-[0.625rem] text-ink-3 mt-0.5 tracking-[0.1em] uppercase">Execution &amp; Costing</span>
              </span>
            )}
          </Link>
          <button
            className="lg:hidden ml-auto text-ink-3 hover:text-ink"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          >
            <X className="size-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto no-scrollbar py-3 px-2 space-y-4">
          {NAV.map((group) => (
            <div key={group.title}>
              {!collapsed && (
                <p className="px-2.5 mb-1 text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-ink-3/70">
                  {group.title}
                </p>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    title={collapsed ? item.label : undefined}
                    className={({ isActive }) => clsx(
                      'relative flex items-center gap-2.5 rounded-lg text-sm transition-all',
                      collapsed ? 'justify-center h-9 px-0' : 'h-8 px-2.5',
                      isActive
                        ? 'bg-brand-500/[0.11] text-brand-600 font-medium'
                        : 'text-ink-2 hover:text-ink hover:bg-ink/[0.04]',
                    )}
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <span className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-r-full bg-brand-500" />
                        )}
                        <span className="shrink-0">{item.icon}</span>
                        {!collapsed && <span className="truncate">{item.label}</span>}
                        {item.badge === 'alerts' && highCount > 0 && (
                          <span className={clsx(
                            'shrink-0 num tabular-nums rounded-full bg-risk text-white text-[0.625rem] font-semibold',
                            collapsed
                              ? 'absolute top-1 right-1 size-4 grid place-items-center'
                              : 'ml-auto h-4 min-w-4 px-1 grid place-items-center',
                          )}>
                            {highCount}
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className={clsx('border-t border-line p-2 shrink-0 flex items-center gap-1', collapsed && 'flex-col')}>
          <Button
            variant="quiet"
            size="sm"
            className="hidden lg:inline-flex"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? 'Expand' : 'Collapse'}
            icon={collapsed ? <PanelLeft className="size-4" /> : <PanelLeftClose className="size-4" />}
          />
          <Button
            variant="quiet"
            size="sm"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
            icon={theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          />
          {!collapsed && (
            <span className="ml-auto text-2xs text-ink-3 px-1">
              {saving > 0
                ? <span className="text-brand-600">saving…</span>
                : <span className="text-ok">all saved</span>}
            </span>
          )}
        </div>
      </aside>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-30 bg-ink/25 backdrop-blur-[2px]" onClick={() => setMobileOpen(false)} />
      )}

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-14 shrink-0 border-b border-line bg-surface/80 backdrop-blur-md flex items-center gap-3 px-4 sticky top-0 z-20">
          <Button
            variant="quiet"
            size="sm"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            icon={<PanelLeft className="size-4" />}
          />
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex items-center gap-2 h-8 pl-2.5 pr-2 rounded-lg border border-line bg-raised/70 text-ink-3
                       hover:border-line-strong hover:text-ink-2 transition-colors min-w-0 w-full max-w-sm"
          >
            <Search className="size-3.5 shrink-0" />
            <span className="text-sm truncate">Search orders, pages, anything…</span>
            <kbd className="ml-auto hidden sm:flex items-center gap-0.5 text-2xs px-1.5 h-5 rounded border border-line bg-surface shrink-0">
              ⌘K
            </kbd>
          </button>
          <div className="flex-1" />
          {highCount > 0 && (
            <Link to="/alerts">
              <Badge tone="risk" dot>{highCount} need attention</Badge>
            </Link>
          )}
        </header>

        <main className="flex-1 min-h-0 overflow-y-auto">
          <div className="mx-auto max-w-[110rem] px-4 sm:px-6 py-5 sm:py-6">{children}</div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <Toasts />
    </div>
  )
}

const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

/* ── Command palette ─────────────────────────────────────────────────── */

interface Command { id: string; label: string; hint?: string; group: string; run: () => void; icon?: ReactNode }

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const orders = useStore((s) => s.data.orders)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (open) { setQuery(''); setActive(0); setTimeout(() => inputRef.current?.focus(), 10) } }, [open])

  const commands = useMemo<Command[]>(() => {
    const pages = NAV.flatMap((group) =>
      group.items.map((item) => ({
        id: `nav:${item.to}`,
        label: item.label,
        group: group.title,
        icon: item.icon,
        run: () => navigate(item.to),
      })),
    )
    const orderCommands = orders.map((order) => ({
      id: `order:${order.orderNo}`,
      label: order.orderNo,
      hint: `${order.buyer} · ${order.styleName || order.styleCode}`,
      group: 'Orders',
      icon: <Shirt className="size-4" />,
      run: () => navigate(`/orders/${encodeURIComponent(order.orderNo)}`),
    }))
    const costingCommands = orders.map((order) => ({
      id: `cost:${order.orderNo}`,
      label: `Costing · ${order.orderNo}`,
      hint: order.buyer,
      group: 'Costing',
      icon: <Calculator className="size-4" />,
      run: () => navigate(`/costing/${encodeURIComponent(order.orderNo)}`),
    }))
    return [...pages, ...orderCommands, ...costingCommands]
  }, [orders, navigate])

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return commands.slice(0, 40)
    return commands
      .map((command) => {
        const haystack = `${command.label} ${command.hint ?? ''}`.toLowerCase()
        const index = haystack.indexOf(needle)
        return { command, score: index === -1 ? -1 : 1000 - index - haystack.length / 100 }
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 40)
      .map((r) => r.command)
  }, [commands, query])

  useEffect(() => { setActive(0) }, [query])

  if (!open) return null

  const run = (index: number) => {
    const command = results[index]
    if (!command) return
    command.run()
    onClose()
  }

  let lastGroup = ''

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center pt-[12vh] px-4">
      <div className="fixed inset-0 bg-ink/30 backdrop-blur-[3px] animate-fade-in" onClick={onClose} />
      <div className="relative w-full max-w-xl rounded-2xl border border-line bg-surface shadow-pop overflow-hidden animate-scale-in">
        <div className="flex items-center gap-2.5 px-4 h-12 border-b border-line">
          <Search className="size-4 text-ink-3 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
              else if (e.key === 'Enter') { e.preventDefault(); run(active) }
              else if (e.key === 'Escape') onClose()
            }}
            placeholder="Jump to an order, a page, a costing…"
            className="flex-1 bg-transparent outline-none text-base placeholder:text-ink-3"
          />
          <kbd className="text-2xs px-1.5 h-5 grid place-items-center rounded border border-line text-ink-3">esc</kbd>
        </div>
        <div className="max-h-[52vh] overflow-y-auto py-1.5">
          {results.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-ink-3">Nothing matches “{query}”</p>
          )}
          {results.map((command, index) => {
            const showGroup = command.group !== lastGroup
            lastGroup = command.group
            return (
              <div key={command.id}>
                {showGroup && (
                  <p className="px-4 pt-2.5 pb-1 text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-ink-3/70">
                    {command.group}
                  </p>
                )}
                <button
                  type="button"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => run(index)}
                  className={clsx(
                    'w-full flex items-center gap-3 px-4 py-2 text-left transition-colors',
                    index === active ? 'bg-brand-500/10' : 'hover:bg-ink/[0.035]',
                  )}
                >
                  <span className="text-ink-3 shrink-0">{command.icon}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-ink truncate">{command.label}</span>
                    {command.hint && <span className="block text-2xs text-ink-3 truncate">{command.hint}</span>}
                  </span>
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ── Toasts ──────────────────────────────────────────────────────────── */

function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismiss)
  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[90] flex flex-col gap-2 w-[min(24rem,calc(100vw-2rem))]">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={clsx(
            'flex items-start gap-2.5 rounded-xl border px-3.5 py-3 shadow-pop bg-surface animate-slide-up',
            toast.tone === 'ok' && 'border-ok/30',
            toast.tone === 'risk' && 'border-risk/30',
            toast.tone === 'info' && 'border-info/30',
          )}
        >
          <span className={clsx(
            'mt-1 size-1.5 rounded-full shrink-0',
            toast.tone === 'ok' && 'bg-ok', toast.tone === 'risk' && 'bg-risk', toast.tone === 'info' && 'bg-info',
          )} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink leading-snug">{toast.message}</p>
            {toast.detail && <p className="text-xs text-ink-3 mt-0.5 leading-snug">{toast.detail}</p>}
          </div>
          <button onClick={() => dismiss(toast.id)} className="text-ink-3 hover:text-ink shrink-0" aria-label="Dismiss">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}

/* ── Page header ─────────────────────────────────────────────────────── */

export function PageHeader({
  title, subtitle, actions, breadcrumb,
}: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; breadcrumb?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
      <div className="min-w-0">
        {breadcrumb && <div className="mb-1.5 text-xs text-ink-3 flex items-center gap-1.5">{breadcrumb}</div>}
        <h1 className="text-xl font-semibold text-ink tracking-tight leading-tight">{title}</h1>
        {subtitle && <p className="text-sm text-ink-3 mt-1 leading-relaxed max-w-3xl text-balance">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}
