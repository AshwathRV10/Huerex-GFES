/**
 * The HUEREX component kit.
 *
 * Small, unopinionated primitives that carry the design language so pages can
 * stay about the work rather than about styling.
 */
import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { Check, ChevronDown, Info, TriangleAlert, X } from 'lucide-react'

/* ── Button ──────────────────────────────────────────────────────────── */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet'
type ButtonSize = 'sm' | 'md' | 'lg'

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700 shadow-sm border border-brand-600/40 dark:text-canvas',
  secondary: 'bg-surface text-ink border border-line hover:border-line-strong hover:bg-raised active:bg-sunken',
  ghost: 'text-ink-2 hover:text-ink hover:bg-ink/[0.05] active:bg-ink/[0.08] border border-transparent',
  danger: 'bg-risk text-white hover:brightness-110 active:brightness-95 border border-risk/40',
  quiet: 'text-ink-3 hover:text-ink border border-transparent hover:bg-ink/[0.04]',
}

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  md: 'h-9 px-3.5 gap-2 rounded-lg',
  lg: 'h-10 px-4 gap-2 rounded-lg',
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ReactNode
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, loading, className, children, disabled, ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center font-medium select-none transition-all',
        'disabled:opacity-45 disabled:pointer-events-none active:scale-[.985]',
        BUTTON_VARIANT[variant], BUTTON_SIZE[size], className,
      )}
      {...rest}
    >
      {loading
        ? <span className="size-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
        : icon}
      {children}
    </button>
  )
})

/* ── Card ────────────────────────────────────────────────────────────── */

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx('card', className)} {...rest}>{children}</div>
}

export function CardHeader({
  title, subtitle, actions, icon, className,
}: {
  title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; icon?: ReactNode; className?: string
}) {
  return (
    <div className={clsx('flex items-start justify-between gap-4 px-4 py-3 border-b border-line', className)}>
      <div className="flex items-start gap-2.5 min-w-0">
        {icon && <span className="mt-0.5 text-ink-3 shrink-0">{icon}</span>}
        <div className="min-w-0">
          <h3 className="font-semibold text-ink leading-snug truncate">{title}</h3>
          {subtitle && <p className="text-xs text-ink-3 mt-0.5 leading-relaxed">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
    </div>
  )
}

/* ── Badge ───────────────────────────────────────────────────────────── */

export type Tone = 'neutral' | 'brand' | 'ok' | 'warn' | 'risk' | 'info' | 'saffron'

const TONE: Record<Tone, string> = {
  neutral: 'bg-ink/[0.06] text-ink-2',
  brand: 'bg-brand-500/12 text-brand-600',
  ok: 'bg-ok/12 text-ok',
  warn: 'bg-warn/14 text-warn',
  risk: 'bg-risk/12 text-risk',
  info: 'bg-info/12 text-info',
  saffron: 'bg-saffron/14 text-saffron',
}

export function Badge({
  tone = 'neutral', children, className, dot,
}: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={clsx('chip', TONE[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current opacity-80" />}
      {children}
    </span>
  )
}

/* ── Inputs ──────────────────────────────────────────────────────────── */

export interface FieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label?: string
  hint?: string
  error?: string
  prefix?: ReactNode
  suffix?: ReactNode
  small?: boolean
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, hint, error, prefix, suffix, small, className, ...rest }, ref,
) {
  return (
    <label className="block min-w-0">
      {label && <span className="label">{label}</span>}
      <span className="relative flex items-center">
        {prefix && (
          <span className="absolute left-2.5 text-ink-3 text-xs pointer-events-none num">{prefix}</span>
        )}
        <input
          ref={ref}
          className={clsx(
            'field num', small && 'field-sm',
            prefix && 'pl-7', suffix && 'pr-9',
            error && 'border-risk focus:border-risk focus:ring-risk/20',
            className,
          )}
          {...rest}
        />
        {suffix && (
          <span className="absolute right-2.5 text-ink-3 text-xs pointer-events-none">{suffix}</span>
        )}
      </span>
      {(hint || error) && (
        <span className={clsx('block mt-1 text-2xs', error ? 'text-risk' : 'text-ink-3')}>
          {error ?? hint}
        </span>
      )}
    </label>
  )
})

/** A number input that keeps an empty box empty rather than forcing a zero. */
export function NumberField({
  value, onCommit, decimals = 2, ...rest
}: Omit<FieldProps, 'value' | 'onChange'> & {
  value: number | null | undefined
  onCommit: (value: number | null) => void
  decimals?: number
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? (value == null || Number.isNaN(value) ? '' : String(round(value, decimals)))
  return (
    <Field
      {...rest}
      inputMode="decimal"
      value={shown}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => {
        if (draft === null) return
        const trimmed = draft.trim()
        setDraft(null)
        if (trimmed === '') return onCommit(null)
        const parsed = Number(trimmed.replace(/,/g, ''))
        onCommit(Number.isFinite(parsed) ? parsed : null)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur() }
      }}
      className={clsx('text-right', rest.className)}
    />
  )
}

const round = (v: number, places: number) => {
  const f = 10 ** places
  return Math.round(v * f) / f
}

export function Select({
  label, hint, options, className, small, ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string; hint?: string; small?: boolean; options: { value: string; label: string }[]
}) {
  return (
    <label className="block min-w-0">
      {label && <span className="label">{label}</span>}
      <span className="relative flex items-center">
        <select className={clsx('field appearance-none pr-8', small && 'field-sm', className)} {...rest}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ChevronDown className="absolute right-2.5 size-3.5 text-ink-3 pointer-events-none" />
      </span>
      {hint && <span className="block mt-1 text-2xs text-ink-3">{hint}</span>}
    </label>
  )
}

export function Toggle({
  checked, onChange, label, hint,
}: { checked: boolean; onChange: (v: boolean) => void; label?: string; hint?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-start gap-2.5 text-left group"
    >
      <span
        className={clsx(
          'mt-0.5 relative w-8 h-[18px] rounded-full transition-colors shrink-0',
          checked ? 'bg-brand-500' : 'bg-line-strong group-hover:bg-ink-3/60',
        )}
      >
        <span
          className={clsx(
            'absolute top-0.5 size-[14px] rounded-full bg-white shadow-sm transition-transform',
            checked ? 'translate-x-[16px]' : 'translate-x-0.5',
          )}
        />
      </span>
      {(label || hint) && (
        <span className="min-w-0">
          {label && <span className="block text-sm text-ink leading-tight">{label}</span>}
          {hint && <span className="block text-2xs text-ink-3 mt-0.5 leading-snug">{hint}</span>}
        </span>
      )}
    </button>
  )
}

/* ── Segmented control ───────────────────────────────────────────────── */

export function Segmented<T extends string>({
  value, onChange, options, size = 'md', className,
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: ReactNode; title?: string }[]
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <div className={clsx('inline-flex p-0.5 rounded-lg bg-sunken border border-line', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          onClick={() => onChange(option.value)}
          className={clsx(
            'rounded-[7px] font-medium transition-all whitespace-nowrap',
            size === 'sm' ? 'h-6 px-2 text-2xs' : 'h-7 px-3 text-xs',
            value === option.value
              ? 'bg-surface text-ink shadow-card'
              : 'text-ink-3 hover:text-ink-2',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/* ── Modal ───────────────────────────────────────────────────────────── */

export function Modal({
  open, onClose, title, subtitle, children, footer, width = 'md',
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = previous }
  }, [open, onClose])

  if (!open) return null
  const widths = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-8 overflow-y-auto">
      <div className="fixed inset-0 bg-ink/25 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className={clsx(
          'relative w-full bg-surface border border-line rounded-2xl shadow-pop animate-scale-in my-auto',
          widths[width],
        )}
      >
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-line">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            {subtitle && <p className="text-xs text-ink-3 mt-1 leading-relaxed">{subtitle}</p>}
          </div>
          <Button variant="quiet" size="sm" onClick={onClose} icon={<X className="size-4" />} aria-label="Close" />
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-line bg-raised rounded-b-2xl">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/* ── Drawer ──────────────────────────────────────────────────────────── */

export function Drawer({
  open, onClose, title, subtitle, children, footer, width = 'w-[min(560px,100vw)]',
}: {
  open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode
  children: ReactNode; footer?: ReactNode; width?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-ink/25 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />
      <div className={clsx('relative bg-surface border-l border-line shadow-pop flex flex-col animate-slide-left', width)}>
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-line shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink truncate">{title}</h2>
            {subtitle && <p className="text-xs text-ink-3 mt-1">{subtitle}</p>}
          </div>
          <Button variant="quiet" size="sm" onClick={onClose} icon={<X className="size-4" />} aria-label="Close" />
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-line bg-raised shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/* ── Empty state ─────────────────────────────────────────────────────── */

export function Empty({
  icon, title, detail, action,
}: { icon?: ReactNode; title: string; detail?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      {icon && (
        <div className="size-11 rounded-xl bg-sunken border border-line flex items-center justify-center text-ink-3 mb-3">
          {icon}
        </div>
      )}
      <p className="font-medium text-ink">{title}</p>
      {detail && <p className="text-sm text-ink-3 mt-1.5 max-w-sm leading-relaxed text-balance">{detail}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/* ── Callout ─────────────────────────────────────────────────────────── */

export function Callout({
  tone = 'info', title, children, action,
}: { tone?: 'info' | 'warn' | 'risk' | 'ok'; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const styles = {
    info: 'bg-info/[0.07] border-info/25 text-info',
    warn: 'bg-warn/[0.08] border-warn/25 text-warn',
    risk: 'bg-risk/[0.07] border-risk/25 text-risk',
    ok: 'bg-ok/[0.07] border-ok/25 text-ok',
  }[tone]
  const Icon = tone === 'info' ? Info : tone === 'ok' ? Check : TriangleAlert
  return (
    <div className={clsx('flex items-start gap-2.5 rounded-xl border px-3.5 py-3', styles)}>
      <Icon className="size-4 shrink-0 mt-px" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold text-sm leading-snug">{title}</p>}
        {children && <div className="text-sm text-ink-2 mt-1 leading-relaxed">{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

/* ── Tooltip ─────────────────────────────────────────────────────────── */

export function Tooltip({ label, children }: { label: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState({ x: 0, y: 0 })
  const ref = useRef<HTMLSpanElement>(null)

  const show = () => {
    const rect = ref.current?.getBoundingClientRect()
    if (rect) setCoords({ x: rect.left + rect.width / 2, y: rect.top })
    setOpen(true)
  }

  return (
    <>
      <span
        ref={ref}
        onMouseEnter={show}
        onMouseLeave={() => setOpen(false)}
        onFocus={show}
        onBlur={() => setOpen(false)}
        className="inline-flex"
      >
        {children}
      </span>
      {open && createPortal(
        <div
          role="tooltip"
          style={{ left: coords.x, top: coords.y }}
          className="fixed z-[60] -translate-x-1/2 -translate-y-full pb-1.5 pointer-events-none animate-fade-in"
        >
          <div className="max-w-xs rounded-lg bg-ink text-canvas text-xs px-2.5 py-1.5 shadow-pop leading-snug">
            {label}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

/* ── Progress ────────────────────────────────────────────────────────── */

export function Meter({
  value, max, tone = 'brand', height = 'h-1.5', className,
}: { value: number; max: number; tone?: Tone; height?: string; className?: string }) {
  const fraction = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0
  const fill: Record<Tone, string> = {
    neutral: 'bg-ink-3', brand: 'bg-brand-500', ok: 'bg-ok', warn: 'bg-warn',
    risk: 'bg-risk', info: 'bg-info', saffron: 'bg-saffron',
  }
  return (
    <div className={clsx('w-full rounded-full bg-ink/[0.07] overflow-hidden', height, className)}>
      <div
        className={clsx('h-full rounded-full origin-left animate-bar-grow transition-[width] duration-500', fill[tone])}
        style={{ width: `${fraction * 100}%` }}
      />
    </div>
  )
}

/* ── Section ─────────────────────────────────────────────────────────── */

export function Section({
  title, description, actions, children, className,
}: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx('space-y-3', className)}>
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[0.9375rem] font-semibold text-ink tracking-tight">{title}</h2>
          {description && <p className="text-xs text-ink-3 mt-0.5 leading-relaxed">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
      {children}
    </section>
  )
}
