/**
 * LogTable — the transaction sheet, rebuilt as a real grid.
 *
 * One row per movement, exactly like the workbook, but the cream cells are now
 * proper editors and the grey ones are computed live. The row along the top is
 * always ready for the next entry: pick the order and the colour and size
 * fields narrow to what that order was actually booked in, so a day's cutting
 * is a few keystrokes per line rather than a hunt through a dropdown.
 *
 * After each entry the row keeps what is likely to repeat — the date, the
 * order, the colour, the fabric, the vendor — because twenty cutting rows for
 * one order differ only in size and quantity, and re-picking the same three
 * values twenty times is typing that carries no information.
 *
 * Quantities and free text are the exceptions and never carry. A stale colour
 * is obvious the moment you look at it; a stale quantity looks exactly like a
 * real one, and saving 62 pieces twice because the field was already filled is
 * a worse problem than the typing it would have saved. The same goes for a
 * delivery challan number or a remark: repeated onto the next row it is not a
 * shortcut, it is a false record. Every carried value is tinted until you touch
 * it, so nothing is inherited invisibly.
 */
import { useMemo, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { Check, Plus, Trash2, X } from 'lucide-react'
import { SmartCombo } from './SmartCombo'
import { Badge, Button, Empty, Tooltip } from './ui'
import { useComboStats } from '../hooks/useComboStats'
import { useStore } from '../lib/store'
import type { CollectionKey } from '../lib/types'

export type FieldDef<T> = {
  key: keyof T & string
  header: string
  note?: string
  width?: string
  required?: boolean
  hideBelow?: 'sm' | 'md' | 'lg'
  /**
   * Whether this field keeps its value for the next entry. Categories carry by
   * default; quantities and free text do not — see the note at the top of this
   * file. Set it explicitly where a page knows better.
   */
  carry?: boolean
  /**
   * Takes the cursor after an entry is added. For the field that changes on
   * every line of a block — the size — this is the difference between carrying
   * values forward and actually saving keystrokes.
   */
  focusAfterAdd?: boolean
} & (
  | { kind: 'date' }
  | { kind: 'text'; placeholder?: string }
  | { kind: 'number'; decimals?: number; suffix?: string; min?: number }
  | { kind: 'toggle' }
  | { kind: 'select'; options: { value: string; label: string }[] }
  | {
      kind: 'combo'
      list?: string
      options?: string[]
      allowCreate?: boolean
      /** Values to float to the top, given what has been picked so far. */
      suggest?: (draft: Partial<T>) => string[]
    }
)

export interface DerivedColumn<T> {
  key: string
  header: string
  note?: string
  align?: 'left' | 'right' | 'center'
  width?: string
  render: (row: T) => ReactNode
  hideBelow?: 'sm' | 'md' | 'lg'
}

export interface LogTableProps<T extends { id: string }> {
  collection: CollectionKey
  rows: T[]
  fields: FieldDef<T>[]
  derived?: DerivedColumn<T>[]
  blank: () => Partial<T>
  /** Returns a reason the draft cannot be saved, or null when it is fine. */
  validate?: (draft: Partial<T>) => string | null
  rowTone?: (row: T) => 'risk' | 'warn' | 'ok' | null
  emptyTitle?: string
  emptyDetail?: string
  sortBy?: (a: T, b: T) => number
  maxHeight?: string
  /** Extra controls above the grid. */
  toolbar?: ReactNode
}

const HIDE_BELOW = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' }

/**
 * Whether a field keeps its value for the next entry.
 *
 * Categories — the order, the colour, the fabric, the vendor — repeat down a
 * block and carry. Quantities and free text do not: a stale quantity looks
 * exactly like a real one, and a delivery challan number repeated onto the next
 * row is a false record rather than a shortcut. A field can override either
 * way, which is how the shipment's invoice number keeps its value.
 *
 * Exported so this rule can be checked directly — it is the one part of
 * carrying forward that turns a convenience into wrong data if it is wrong.
 */
export const carriesForward = <T,>(field: FieldDef<T>): boolean =>
  field.carry ?? (field.kind !== 'number' && field.kind !== 'text')

export function LogTable<T extends { id: string }>({
  collection, rows, fields, derived = [], blank, validate, rowTone,
  emptyTitle = 'No entries yet', emptyDetail, sortBy, maxHeight = 'max-h-[calc(100vh-20rem)]', toolbar,
}: LogTableProps<T>) {
  const add = useStore((s) => s.add)
  const patch = useStore((s) => s.patch)
  const drop = useStore((s) => s.drop)
  const notify = useStore((s) => s.notify)

  const [draft, setDraft] = useState<Partial<T>>(() => blank())
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  /** Fields holding a value inherited from the last entry rather than typed. */
  const [carried, setCarried] = useState<Set<string>>(() => new Set())
  const entryRowRef = useRef<HTMLTableRowElement>(null)

  const editField = (key: string, value: unknown) => {
    setDraft((d) => ({ ...d, [key]: value }))
    // Touching a field makes it yours, so the tint goes.
    setCarried((prev) => {
      if (!prev.has(key)) return prev
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }

  const clearRow = () => {
    setDraft(blank())
    setCarried(new Set())
  }

  /**
   * Puts the cursor where the next keystroke belongs: the field a page has
   * claimed, otherwise the first one left empty. Landing on a field that is
   * already filled — the date, or an order carried from the row above — would
   * cost a tab on every line and undo most of what carrying forward saves.
   */
  const focusNextEntry = (next: Partial<T>) => {
    const isEmpty = (f: FieldDef<T>) => {
      const v = (next as Record<string, unknown>)[f.key]
      return v === undefined || v === null || v === '' || (f.kind === 'number' && v === 0)
    }
    const target = fields.find((f) => f.focusAfterAdd) ?? fields.find(isEmpty) ?? fields[0]
    if (!target) return
    const cell = entryRowRef.current?.querySelector(`[data-field="${target.key}"]`)
    cell?.querySelector<HTMLElement>('input, select, button')?.focus()
  }

  const ordered = useMemo(() => (sortBy ? [...rows].sort(sortBy) : rows), [rows, sortBy])
  const problem = validate?.(draft) ?? null
  const dirty = fields.some((f) => {
    const value = draft[f.key]
    return value !== undefined && value !== '' && value !== null && value !== 0
  })

  const commit = async () => {
    if (problem) { notify('risk', 'Cannot save this entry', problem); return }
    setSaving(true)
    try {
      const saved = draft
      await add(collection, saved as never)

      // Start from a blank row, then put back what is worth keeping.
      const fresh = blank()
      const kept = new Set<string>()
      for (const field of fields) {
        if (!carriesForward(field)) continue
        const value = (saved as Record<string, unknown>)[field.key]
        if (value === undefined || value === null || value === '') continue
        ;(fresh as Record<string, unknown>)[field.key] = value
        // Only tint what genuinely came from the last row. A date that equals
        // the blank row's own default was not inherited from anywhere.
        const fallback = (blank() as Record<string, unknown>)[field.key]
        if (JSON.stringify(value) !== JSON.stringify(fallback)) kept.add(field.key)
      }
      setDraft(fresh)
      setCarried(kept)
      // Keep the operator in the row so the next entry is immediate.
      focusNextEntry(fresh)
    } finally {
      setSaving(false)
    }
  }

  const columnCount = fields.length + derived.length + 1

  return (
    <div className="card overflow-hidden flex flex-col min-h-0">
      {toolbar && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-line bg-raised/60 shrink-0">
          {toolbar}
          <span className="ml-auto text-2xs text-ink-3 num tabular-nums">
            {rows.length.toLocaleString('en-IN')} entries
          </span>
        </div>
      )}

      <div className={clsx('overflow-auto min-h-0', maxHeight)}>
        <table className="w-full border-collapse">
          <thead className="sticky-head">
            <tr>
              {fields.map((field) => (
                <th
                  key={field.key}
                  style={{ width: field.width }}
                  className={clsx(
                    'text-2xs font-semibold uppercase tracking-[0.06em] text-ink-3 px-2 py-2 text-left whitespace-nowrap',
                    field.hideBelow && HIDE_BELOW[field.hideBelow],
                  )}
                >
                  {field.header}
                  {field.required && <span className="text-risk/70 ml-0.5">*</span>}
                  {field.note && (
                    <span className="hidden xl:block font-normal normal-case tracking-normal text-ink-3/70 mt-0.5">
                      {field.note}
                    </span>
                  )}
                </th>
              ))}
              {derived.map((column) => (
                <th
                  key={column.key}
                  style={{ width: column.width }}
                  className={clsx(
                    'text-2xs font-semibold uppercase tracking-[0.06em] text-ink-3 px-2 py-2 whitespace-nowrap bg-ink/[0.025]',
                    column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left',
                    column.hideBelow && HIDE_BELOW[column.hideBelow],
                  )}
                >
                  {column.header}
                  {column.note && (
                    <span className="hidden xl:block font-normal normal-case tracking-normal text-ink-3/70 mt-0.5">
                      {column.note}
                    </span>
                  )}
                </th>
              ))}
              <th className="w-16" />
            </tr>
          </thead>

          <tbody>
            {/* The next entry always sits at the top, ready to type into. */}
            <tr ref={entryRowRef} className="border-b-2 border-brand-500/25 bg-brand-500/[0.035]">
              {fields.map((field) => {
                const inherited = carried.has(field.key)
                return (
                  <td
                    key={field.key}
                    data-field={field.key}
                    title={inherited ? 'Kept from the entry before — change it if it is wrong' : undefined}
                    className={clsx(
                      'px-1.5 py-1.5 align-top transition-colors',
                      // Tinted until touched, so an inherited value is never
                      // mistaken for one somebody meant to type.
                      inherited && 'bg-saffron/[0.09]',
                      field.hideBelow && HIDE_BELOW[field.hideBelow],
                    )}
                  >
                    <CellEditor
                      field={field}
                      value={draft[field.key]}
                      draft={draft}
                      onChange={(value) => editField(field.key, value)}
                      onEnter={commit}
                    />
                  </td>
                )
              })}
              {derived.map((column) => (
                <td key={column.key} className={clsx('px-2 bg-ink/[0.02]', column.hideBelow && HIDE_BELOW[column.hideBelow])} />
              ))}
              <td className="px-1.5 py-1.5">
                <div className="flex items-center gap-1">
                  <Tooltip label={problem ?? 'Add entry  ·  ↵'}>
                    <Button
                      size="sm"
                      variant="primary"
                      loading={saving}
                      disabled={!!problem}
                      onClick={commit}
                      aria-label="Add entry"
                      icon={<Plus className="size-3.5" />}
                    />
                  </Tooltip>
                  {dirty && (
                    <Tooltip label={carried.size ? 'Start a fresh row  ·  clears what was kept' : 'Clear'}>
                      <Button
                        size="sm"
                        variant="quiet"
                        onClick={clearRow}
                        aria-label="Clear"
                        icon={<X className="size-3.5" />}
                      />
                    </Tooltip>
                  )}
                </div>
              </td>
            </tr>

            {ordered.map((row) => {
              const tone = rowTone?.(row) ?? null
              return (
                <tr
                  key={row.id}
                  className={clsx(
                    'border-b border-line/70 last:border-0 group transition-colors hover:bg-brand-500/[0.03]',
                    tone === 'risk' && 'bg-risk/[0.045]',
                    tone === 'warn' && 'bg-warn/[0.05]',
                    tone === 'ok' && 'bg-ok/[0.035]',
                  )}
                >
                  {fields.map((field) => (
                    <td key={field.key} className={clsx('px-1.5 py-0.5', field.hideBelow && HIDE_BELOW[field.hideBelow])}>
                      <CellEditor
                        field={field}
                        value={row[field.key]}
                        draft={row}
                        compact
                        onChange={(value) => patch(collection, row.id, { [field.key]: value } as never)}
                      />
                    </td>
                  ))}
                  {derived.map((column) => (
                    <td
                      key={column.key}
                      className={clsx(
                        'px-2 py-1 bg-ink/[0.018] text-ink-2 text-sm',
                        column.align === 'right' ? 'text-right num tabular-nums' : column.align === 'center' ? 'text-center' : '',
                        column.hideBelow && HIDE_BELOW[column.hideBelow],
                      )}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                  <td className="px-1.5 py-0.5">
                    {confirmDelete === row.id ? (
                      <div className="flex items-center gap-0.5">
                        <Button
                          size="sm" variant="danger" aria-label="Confirm delete"
                          icon={<Check className="size-3.5" />}
                          onClick={() => { drop(collection, row.id); setConfirmDelete(null) }}
                        />
                        <Button
                          size="sm" variant="quiet" aria-label="Cancel"
                          icon={<X className="size-3.5" />}
                          onClick={() => setConfirmDelete(null)}
                        />
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="quiet"
                        aria-label="Delete row"
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-risk"
                        icon={<Trash2 className="size-3.5" />}
                        onClick={() => setConfirmDelete(row.id)}
                      />
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {ordered.length === 0 && (
          <Empty
            title={emptyTitle}
            detail={emptyDetail ?? 'Use the row at the top to log the first one. Everything else calculates itself.'}
            icon={<Plus className="size-5" />}
          />
        )}
      </div>

      <div className="px-3 py-1.5 border-t border-line bg-raised/50 text-2xs text-ink-3 shrink-0 flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-[3px] bg-brand-500/25 border border-brand-500/40" /> you type
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-[3px] bg-ink/[0.07] border border-line" /> calculated
        </span>
        <span className="ml-auto hidden sm:inline">
          Press <kbd className="px-1 rounded border border-line bg-surface">↵</kbd> in the top row to save and keep going
        </span>
        <span className="sm:hidden">{columnCount} columns</span>
      </div>
    </div>
  )
}

/* ── Cell editors ────────────────────────────────────────────────────── */

function CellEditor<T>({
  field, value, draft, onChange, onEnter, compact,
}: {
  field: FieldDef<T>
  value: unknown
  draft: Partial<T>
  onChange: (value: unknown) => void
  onEnter?: () => void
  compact?: boolean
}) {
  const stats = useComboStats(field.kind === 'combo' ? field.list : undefined)

  switch (field.kind) {
    case 'date':
      return (
        <input
          type="date"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onEnter?.() }}
          className={clsx('field field-sm num', compact && 'border-transparent bg-transparent hover:border-line')}
        />
      )

    case 'text':
      return (
        <input
          type="text"
          value={(value as string) ?? ''}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onEnter?.() }}
          className={clsx('field field-sm', compact && 'border-transparent bg-transparent hover:border-line')}
        />
      )

    case 'number':
      return (
        <NumberCell
          value={value as number | null}
          decimals={field.decimals ?? 0}
          suffix={field.suffix}
          compact={compact}
          onCommit={onChange}
          onEnter={onEnter}
        />
      )

    case 'toggle': {
      const on = Boolean(value)
      return (
        <button
          type="button"
          onClick={() => onChange(!on)}
          className="inline-flex"
          aria-pressed={on}
        >
          <Badge tone={on ? 'ok' : 'neutral'}>{on ? 'Yes' : 'No'}</Badge>
        </button>
      )
    }

    case 'select':
      return (
        <select
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onEnter?.() }}
          className={clsx('field field-sm', compact && 'border-transparent bg-transparent hover:border-line')}
        >
          <option value="">—</option>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      )

    case 'combo':
      return (
        <SmartCombo
          small
          value={(value as string) ?? ''}
          onChange={onChange}
          list={field.list}
          options={field.options}
          allowCreate={field.allowCreate ?? true}
          stats={stats}
          suggested={field.suggest?.(draft)}
          placeholder={field.header}
          className={compact ? '[&_input]:border-transparent [&_input]:bg-transparent hover:[&_input]:border-line' : undefined}
        />
      )
  }
}

function NumberCell({
  value, decimals, suffix, compact, onCommit, onEnter,
}: {
  value: number | null
  decimals: number
  suffix?: string
  compact?: boolean
  onCommit: (value: number | null) => void
  onEnter?: () => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const display = draft ?? (value == null || Number.isNaN(value) ? '' : String(value))

  const flush = () => {
    if (draft === null) return
    const text = draft.trim()
    setDraft(null)
    if (text === '') return onCommit(null)
    const parsed = Number(text.replace(/,/g, ''))
    onCommit(Number.isFinite(parsed) ? round(parsed, decimals) : null)
  }

  return (
    <span className="relative flex items-center">
      <input
        inputMode="decimal"
        value={display}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={flush}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { flush(); onEnter?.() }
          if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur() }
        }}
        className={clsx(
          'field field-sm num text-right tabular-nums',
          suffix && 'pr-6',
          compact && 'border-transparent bg-transparent hover:border-line',
        )}
      />
      {suffix && <span className="absolute right-2 text-2xs text-ink-3 pointer-events-none">{suffix}</span>}
    </span>
  )
}

const round = (value: number, places: number) => {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}
