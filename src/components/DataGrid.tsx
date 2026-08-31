/**
 * DataGrid — the dense, sortable table the whole app logs work into.
 *
 * Columns declare how they are read and, where a row is editable, how they are
 * written. Numbers are right-aligned and tabular so a column of quantities
 * lines up on the decimal point; text columns wrap only when asked.
 */
import { useMemo, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { ArrowDown, ArrowUp, ChevronsUpDown, Search, Trash2 } from 'lucide-react'
import { Button, Empty } from './ui'

export interface Column<T> {
  key: string
  header: ReactNode
  /** A short note shown under the header on wide screens. */
  note?: string
  render: (row: T, index: number) => ReactNode
  /** Provide to make the column sortable and searchable. */
  value?: (row: T) => string | number | null | undefined
  align?: 'left' | 'right' | 'center'
  width?: string
  /** Grey columns are derived — nobody types into them. */
  derived?: boolean
  sticky?: boolean
  hideBelow?: 'sm' | 'md' | 'lg'
}

export interface DataGridProps<T> {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T, index: number) => string
  onDelete?: (row: T) => void
  empty?: ReactNode
  /** Adds a search box above the grid. */
  searchable?: boolean
  searchPlaceholder?: string
  defaultSort?: { key: string; direction: 'asc' | 'desc' }
  toolbar?: ReactNode
  onRowClick?: (row: T) => void
  rowTone?: (row: T) => 'risk' | 'warn' | 'ok' | null
  maxHeight?: string
  dense?: boolean
  footer?: ReactNode
}

const HIDE_BELOW = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' }

export function DataGrid<T>({
  rows, columns, rowKey, onDelete, empty, searchable, searchPlaceholder = 'Search…',
  defaultSort, toolbar, onRowClick, rowTone, maxHeight = 'max-h-[calc(100vh-19rem)]', dense, footer,
}: DataGridProps<T>) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState(defaultSort ?? null)

  const searchable_ = columns.filter((c) => c.value)

  const visible = useMemo(() => {
    let out = rows
    const needle = query.trim().toLowerCase()
    if (needle) {
      out = out.filter((row) =>
        searchable_.some((column) => String(column.value?.(row) ?? '').toLowerCase().includes(needle)),
      )
    }
    if (sort) {
      const column = columns.find((c) => c.key === sort.key)
      if (column?.value) {
        const direction = sort.direction === 'asc' ? 1 : -1
        out = [...out].sort((a, b) => {
          const av = column.value!(a)
          const bv = column.value!(b)
          if (av == null && bv == null) return 0
          if (av == null) return 1
          if (bv == null) return -1
          if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * direction
          return String(av).localeCompare(String(bv), undefined, { numeric: true }) * direction
        })
      }
    }
    return out
  }, [rows, query, sort, columns, searchable_])

  const toggleSort = (key: string) => {
    setSort((current) =>
      !current || current.key !== key
        ? { key, direction: 'asc' }
        : current.direction === 'asc'
          ? { key, direction: 'desc' }
          : null,
    )
  }

  return (
    <div className="card overflow-hidden flex flex-col min-h-0">
      {(searchable || toolbar) && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-line bg-raised/60 shrink-0">
          {searchable && (
            <div className="relative flex-1 min-w-0 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-ink-3" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="field field-sm pl-8"
              />
            </div>
          )}
          <div className="flex-1" />
          {toolbar}
          <span className="text-2xs text-ink-3 num shrink-0 tabular-nums">
            {visible.length === rows.length
              ? `${rows.length.toLocaleString('en-IN')} rows`
              : `${visible.length.toLocaleString('en-IN')} of ${rows.length.toLocaleString('en-IN')}`}
          </span>
        </div>
      )}

      <div className={clsx('overflow-auto min-h-0', maxHeight)}>
        <table className="w-full border-collapse">
          <thead className="sticky-head">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  style={{ width: column.width }}
                  className={clsx(
                    'text-2xs font-semibold uppercase tracking-[0.06em] text-ink-3 px-2.5 py-2 whitespace-nowrap',
                    column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left',
                    column.sticky && 'sticky left-0 z-20 bg-raised',
                    column.hideBelow && HIDE_BELOW[column.hideBelow],
                  )}
                >
                  {column.value ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(column.key)}
                      className={clsx(
                        'inline-flex items-center gap-1 hover:text-ink transition-colors',
                        column.align === 'right' && 'flex-row-reverse',
                      )}
                    >
                      {column.header}
                      {sort?.key === column.key
                        ? sort.direction === 'asc'
                          ? <ArrowUp className="size-3" />
                          : <ArrowDown className="size-3" />
                        : <ChevronsUpDown className="size-3 opacity-30" />}
                    </button>
                  ) : column.header}
                  {column.note && (
                    <span className="hidden xl:block font-normal normal-case tracking-normal text-ink-3/70 mt-0.5">
                      {column.note}
                    </span>
                  )}
                </th>
              ))}
              {onDelete && <th className="w-9" />}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => {
              const tone = rowTone?.(row) ?? null
              return (
                <tr
                  key={rowKey(row, index)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={clsx(
                    'border-b border-line/70 last:border-0 grid-row-hover group',
                    onRowClick && 'cursor-pointer',
                    tone === 'risk' && 'bg-risk/[0.045]',
                    tone === 'warn' && 'bg-warn/[0.05]',
                    tone === 'ok' && 'bg-ok/[0.04]',
                  )}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={clsx(
                        'px-2.5 align-middle',
                        dense ? 'py-1' : 'py-1.5',
                        column.align === 'right' ? 'text-right num' : column.align === 'center' ? 'text-center' : 'text-left',
                        column.derived && 'text-ink-2 bg-ink/[0.018]',
                        column.sticky && 'sticky left-0 z-10 bg-surface group-hover:bg-[rgb(var(--c-surface))]',
                        column.hideBelow && HIDE_BELOW[column.hideBelow],
                      )}
                    >
                      {column.render(row, index)}
                    </td>
                  ))}
                  {onDelete && (
                    <td className="px-1.5 py-1">
                      <Button
                        variant="quiet"
                        size="sm"
                        aria-label="Delete row"
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-risk"
                        icon={<Trash2 className="size-3.5" />}
                        onClick={(e) => { e.stopPropagation(); onDelete(row) }}
                      />
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
          {footer && (
            <tfoot className="sticky bottom-0 bg-raised/95 backdrop-blur-sm border-t border-line">
              {footer}
            </tfoot>
          )}
        </table>

        {visible.length === 0 && (
          empty ?? <Empty title={query ? 'Nothing matches that search' : 'No rows yet'} />
        )}
      </div>
    </div>
  )
}

/** A right-aligned figure that greys out when it is zero. */
export function Qty({ value, zero = '·', decimals = 0, className }: {
  value: number | null | undefined; zero?: string; decimals?: number; className?: string
}) {
  if (value == null || !Number.isFinite(value)) return <span className="text-ink-3">—</span>
  if (value === 0) return <span className="text-ink-3/50">{zero}</span>
  return (
    <span className={clsx('num tabular-nums', className)}>
      {value.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
    </span>
  )
}
