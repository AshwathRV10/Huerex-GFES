/**
 * The tiles that carry the headline numbers.
 *
 * A number on its own means nothing, so every tile also says what it counts.
 */
import clsx from 'clsx'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Meter, type Tone } from './ui'

export function StatTile({
  label, value, unit, caption, tone = 'neutral', icon, to, trend, meter, className,
}: {
  label: string
  value: ReactNode
  unit?: string
  caption?: string
  tone?: Tone
  icon?: ReactNode
  to?: string
  trend?: { value: string; tone: 'ok' | 'risk' | 'neutral' }
  meter?: { value: number; max: number }
  className?: string
}) {
  const accent: Record<Tone, string> = {
    neutral: 'text-ink', brand: 'text-brand-600', ok: 'text-ok', warn: 'text-warn',
    risk: 'text-risk', info: 'text-info', saffron: 'text-saffron',
  }

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-2xs font-semibold uppercase tracking-[0.07em] text-ink-3">{label}</p>
        {icon && <span className={clsx('shrink-0 opacity-70', accent[tone])}>{icon}</span>}
      </div>
      <p className={clsx('mt-2 text-[1.75rem] leading-none font-semibold num tracking-tight', accent[tone])}>
        {value}
        {unit && <span className="text-sm font-medium text-ink-3 ml-1">{unit}</span>}
      </p>
      {meter && <Meter value={meter.value} max={meter.max} tone={tone} className="mt-3" />}
      {(caption || trend) && (
        <p className="mt-auto pt-2 text-xs text-ink-3 leading-snug flex items-center gap-1.5">
          {trend && (
            <span className={clsx(
              'font-medium num',
              trend.tone === 'ok' ? 'text-ok' : trend.tone === 'risk' ? 'text-risk' : 'text-ink-2',
            )}>
              {trend.value}
            </span>
          )}
          {caption}
        </p>
      )}
    </>
  )

  const classes = clsx(
    'card p-4 transition-all flex flex-col',
    to && 'hover:shadow-lift hover:border-line-strong hover:-translate-y-px',
    className,
  )

  return to ? <Link to={to} className={classes}>{body}</Link> : <div className={classes}>{body}</div>
}

/** A compact figure for dense summary rails. */
export function Stat({
  label, value, tone, hint, emphasis,
}: { label: string; value: ReactNode; tone?: Tone; hint?: string; emphasis?: boolean }) {
  const accent: Record<Tone, string> = {
    neutral: 'text-ink', brand: 'text-brand-600', ok: 'text-ok', warn: 'text-warn',
    risk: 'text-risk', info: 'text-info', saffron: 'text-saffron',
  }
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-xs text-ink-3 shrink-0">{label}</span>
      <span className="flex-1 border-b border-dashed border-line/80 translate-y-[-2px]" />
      <span
        className={clsx(
          'num tabular-nums shrink-0',
          emphasis ? 'text-base font-semibold' : 'text-sm font-medium',
          tone ? accent[tone] : 'text-ink',
        )}
        title={hint}
      >
        {value}
      </span>
    </div>
  )
}
