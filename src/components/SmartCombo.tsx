/**
 * SmartCombo — type to search, and type to add.
 *
 * Wherever the app asks for a colour, a vendor, a fabric, a trim, a style or a
 * person, this is the field. Typing filters what is already known; typing
 * something new offers to remember it, and from then on it is in the list for
 * everyone. Each option carries its own history — how often it has been used
 * and where it was used last — so a near-duplicate is obvious before it is
 * created.
 */
import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { Check, ChevronDown, CornerDownLeft, Plus, Sparkles } from 'lucide-react'
import { useStore } from '../lib/store'

export interface ComboStat {
  /** How many rows in the system use this value. */
  count: number
  /** The most recent order it appeared on. */
  lastOrderNo?: string
  /** Anything worth showing on the right of the row. */
  detail?: string
}

export interface SmartComboProps {
  value: string
  onChange: (value: string) => void
  /** The masters list this field reads from and writes new entries to. */
  list?: string
  /** Explicit options, when the field is not backed by a masters list. */
  options?: string[]
  placeholder?: string
  label?: string
  hint?: string
  /** Turn off to make the field a plain searchable picker. */
  allowCreate?: boolean
  disabled?: boolean
  small?: boolean
  className?: string
  autoFocus?: boolean
  /** Usage history shown against each option. */
  stats?: Record<string, ComboStat>
  /** Pinned at the top, above everything else — usually the obvious answers. */
  suggested?: string[]
  icon?: ReactNode
  onCommit?: (value: string) => void
  emptyLabel?: string
}

export function SmartCombo({
  value, onChange, list, options, placeholder = 'Type to search or add…', label, hint,
  allowCreate = true, disabled, small, className, autoFocus, stats, suggested,
  icon, onCommit, emptyLabel,
}: SmartComboProps) {
  const masters = useStore((s) => s.masters)
  const addMaster = useStore((s) => s.addMaster)

  const pool = useMemo(() => {
    const base = options ?? (list ? masters[list] ?? [] : [])
    return [...new Set(base.filter(Boolean))]
  }, [options, list, masters])

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const results = useMemo(
    () => rank(pool, query, stats, suggested),
    [pool, query, stats, suggested],
  )

  const exact = pool.some((o) => o.toLowerCase() === query.trim().toLowerCase())
  const canCreate = allowCreate && query.trim().length > 0 && !exact
  const rowCount = results.length + (canCreate ? 1 : 0)

  useEffect(() => { setActive(0) }, [query, open])

  const commit = useCallback(async (next: string) => {
    const trimmed = next.trim()
    if (!trimmed) { onChange(''); onCommit?.(''); setOpen(false); setQuery(''); return }
    let final = trimmed
    if (list && !pool.some((o) => o.toLowerCase() === trimmed.toLowerCase())) {
      final = await addMaster(list, trimmed)
    }
    onChange(final)
    onCommit?.(final)
    setOpen(false)
    setQuery('')
  }, [list, pool, addMaster, onChange, onCommit])

  const choose = useCallback((index: number) => {
    if (index < results.length) commit(results[index].value)
    else if (canCreate) commit(query)
  }, [results, canCreate, query, commit])

  /* Close when focus or a click leaves the field. */
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (wrapRef.current?.contains(target) || listRef.current?.contains(target)) return
      setOpen(false)
      setQuery('')
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const position = useDropdownPosition(wrapRef, open, rowCount)

  const shown = open ? query : value

  return (
    <div className={clsx('block min-w-0', className)}>
      {label && <span className="label">{label}</span>}
      <div ref={wrapRef} className="relative">
        {icon && (
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none">{icon}</span>
        )}
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          autoFocus={autoFocus}
          value={shown}
          placeholder={value ? value : placeholder}
          onFocus={() => { setOpen(true); setQuery('') }}
          onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, rowCount - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
            else if (e.key === 'Enter') { e.preventDefault(); if (open) choose(active) }
            else if (e.key === 'Tab' && open && rowCount > 0) { choose(active) }
            else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); setQuery(''); inputRef.current?.blur() }
            else if (e.key === 'Backspace' && !query && value) { onChange(''); onCommit?.('') }
          }}
          className={clsx(
            'field pr-7 truncate', small && 'field-sm', icon && 'pl-8',
            !value && !open && 'text-ink-3',
          )}
        />
        <ChevronDown
          className={clsx(
            'absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-ink-3 pointer-events-none transition-transform',
            open && 'rotate-180',
          )}
        />
      </div>
      {hint && <span className="block mt-1 text-2xs text-ink-3">{hint}</span>}

      {open && position && createPortal(
        <div
          ref={listRef}
          style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight }}
          className="fixed z-[70] rounded-xl border border-line bg-surface shadow-pop overflow-hidden flex flex-col animate-scale-in"
        >
          <div className="overflow-y-auto overscroll-contain py-1">
            {results.length === 0 && !canCreate && (
              <p className="px-3 py-6 text-center text-xs text-ink-3">
                {emptyLabel ?? (pool.length === 0 ? 'Nothing saved yet — type to add the first one' : 'No match')}
              </p>
            )}

            {results.map((result, index) => (
              <button
                key={result.value}
                type="button"
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(index)}
                className={clsx(
                  'w-full flex items-center gap-2.5 px-2.5 py-1.5 text-left transition-colors',
                  index === active ? 'bg-brand-500/10' : 'hover:bg-ink/[0.035]',
                )}
              >
                <span className="flex-1 min-w-0 flex items-center gap-2">
                  {result.suggested && <Sparkles className="size-3 text-saffron shrink-0" />}
                  <span className="truncate text-sm">{highlight(result.value, query)}</span>
                </span>
                {result.stat?.count ? (
                  <span className="shrink-0 text-2xs text-ink-3 num tabular-nums">
                    {result.stat.detail ?? (
                      <>
                        {result.stat.count}×
                        {result.stat.lastOrderNo && <span className="ml-1.5 opacity-70">{result.stat.lastOrderNo}</span>}
                      </>
                    )}
                  </span>
                ) : null}
                {value === result.value && <Check className="size-3.5 text-brand-500 shrink-0" />}
              </button>
            ))}

            {canCreate && (
              <button
                type="button"
                onMouseEnter={() => setActive(results.length)}
                onClick={() => choose(results.length)}
                className={clsx(
                  'w-full flex items-center gap-2.5 px-2.5 py-2 text-left border-t border-line mt-1 pt-2 transition-colors',
                  active === results.length ? 'bg-brand-500/10' : 'hover:bg-ink/[0.035]',
                )}
              >
                <span className="size-5 rounded-md bg-brand-500/12 text-brand-600 flex items-center justify-center shrink-0">
                  <Plus className="size-3" />
                </span>
                <span className="flex-1 min-w-0 text-sm">
                  Add <span className="font-semibold">“{query.trim()}”</span>
                  {list && <span className="text-ink-3"> to {humanise(list)}</span>}
                </span>
                <CornerDownLeft className="size-3 text-ink-3 shrink-0" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-3 px-2.5 py-1.5 border-t border-line bg-raised text-2xs text-ink-3 shrink-0">
            <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
            <span className="flex items-center gap-1"><Kbd>↵</Kbd> select</span>
            {allowCreate && <span className="ml-auto">new entries are remembered</span>}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded border border-line bg-surface text-[0.625rem] font-sans text-ink-3">
      {children}
    </kbd>
  )
}

/* ── Ranking ─────────────────────────────────────────────────────────── */

interface Ranked { value: string; score: number; stat?: ComboStat; suggested?: boolean }

function rank(
  pool: string[],
  query: string,
  stats?: Record<string, ComboStat>,
  suggested?: string[],
): Ranked[] {
  const needle = query.trim().toLowerCase()
  const suggestedSet = new Set(suggested ?? [])

  const scored: Ranked[] = []
  for (const value of pool) {
    const stat = stats?.[value]
    const usage = Math.min(stat?.count ?? 0, 200) / 10
    const bump = suggestedSet.has(value) ? 4_000 : 0

    if (!needle) {
      scored.push({ value, score: bump + usage, stat, suggested: suggestedSet.has(value) })
      continue
    }
    const score = match(value.toLowerCase(), needle)
    if (score > 0) scored.push({ value, score: score + usage + bump, stat, suggested: suggestedSet.has(value) })
  }

  scored.sort((a, b) => b.score - a.score || a.value.localeCompare(b.value))
  return scored.slice(0, 120)
}

/** Exact beats prefix beats word-start beats contains beats subsequence. */
function match(haystack: string, needle: string): number {
  if (haystack === needle) return 10_000
  if (haystack.startsWith(needle)) return 5_000 - haystack.length
  const wordStart = new RegExp(`\\b${escapeRegex(needle)}`).test(haystack)
  if (wordStart) return 3_000 - haystack.length
  if (haystack.includes(needle)) return 1_500 - haystack.length
  // Subsequence: "sjy" still finds "Single Jersey".
  let i = 0
  for (const char of haystack) {
    if (char === needle[i]) i++
    if (i === needle.length) return 500 - haystack.length
  }
  return 0
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function highlight(value: string, query: string): ReactNode {
  const needle = query.trim()
  if (!needle) return value
  const index = value.toLowerCase().indexOf(needle.toLowerCase())
  if (index === -1) return value
  return (
    <>
      {value.slice(0, index)}
      <mark className="bg-brand-500/20 text-inherit rounded-[3px] px-px">
        {value.slice(index, index + needle.length)}
      </mark>
      {value.slice(index + needle.length)}
    </>
  )
}

const humanise = (list: string) =>
  list.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim()

/* ── Positioning ─────────────────────────────────────────────────────── */

function useDropdownPosition(
  ref: React.RefObject<HTMLElement>,
  open: boolean,
  rowCount: number,
) {
  const [position, setPosition] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) { setPosition(null); return }
    const update = () => {
      const rect = ref.current?.getBoundingClientRect()
      if (!rect) return
      const desired = Math.min(rowCount * 32 + 60, 340)
      const below = window.innerHeight - rect.bottom - 12
      const above = rect.top - 12
      // Flip above when there is not enough room underneath.
      const dropUp = below < Math.min(desired, 200) && above > below
      setPosition({
        left: rect.left,
        top: dropUp ? Math.max(8, rect.top - Math.min(desired, above) - 4) : rect.bottom + 4,
        width: Math.max(rect.width, 220),
        maxHeight: Math.max(140, Math.min(desired, dropUp ? above : below)),
      })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open, rowCount, ref])

  return position
}
