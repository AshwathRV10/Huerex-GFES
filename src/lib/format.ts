/** Formatting helpers. Every number the user reads passes through here. */

const CURRENCY_SYMBOL: Record<string, string> = { INR: '₹', USD: '$', EUR: '€', GBP: '£' }

export const symbolFor = (currency = 'INR') => CURRENCY_SYMBOL[currency] ?? `${currency} `

/** ₹1,23,456.78 — Indian digit grouping, because that is how the office reads it. */
export function money(value: number | null | undefined, currency = 'INR', decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const locale = currency === 'INR' ? 'en-IN' : 'en-US'
  const body = Math.abs(value).toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  return `${value < 0 ? '−' : ''}${symbolFor(currency)}${body}`
}

/** A compact money figure for tiles: ₹12.4L, ₹3.2Cr. */
export function moneyShort(value: number | null | undefined, currency = 'INR'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const sym = symbolFor(currency)
  const a = Math.abs(value)
  const sign = value < 0 ? '−' : ''
  if (currency === 'INR') {
    if (a >= 1e7) return `${sign}${sym}${(a / 1e7).toFixed(2)}Cr`
    if (a >= 1e5) return `${sign}${sym}${(a / 1e5).toFixed(2)}L`
    if (a >= 1e3) return `${sign}${sym}${(a / 1e3).toFixed(1)}k`
  } else {
    if (a >= 1e9) return `${sign}${sym}${(a / 1e9).toFixed(2)}B`
    if (a >= 1e6) return `${sign}${sym}${(a / 1e6).toFixed(2)}M`
    if (a >= 1e3) return `${sign}${sym}${(a / 1e3).toFixed(1)}k`
  }
  return `${sign}${sym}${a.toFixed(0)}`
}

export function num(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return value.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export function pct(fraction: number | null | undefined, decimals = 1): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return '—'
  return `${(fraction * 100).toFixed(decimals)}%`
}

export function kg(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${num(value, decimals)} kg`
}

/** 2026-08-20 → 20 Aug 26 */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
}

export function longDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** "3 days ago", "in 12 days", "today". */
export function relativeDays(iso: string | null | undefined, from = new Date()): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const days = Math.round((startOfDay(d).getTime() - startOfDay(from).getTime()) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  return days > 0 ? `in ${days} days` : `${-days} days ago`
}

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

export function daysBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null
  const da = new Date(a), dbb = new Date(b)
  if (Number.isNaN(da.getTime()) || Number.isNaN(dbb.getTime())) return null
  return Math.round((startOfDay(dbb).getTime() - startOfDay(da).getTime()) / 86_400_000)
}

export const today = () => new Date().toISOString().slice(0, 10)

/** Signed, for variance columns: +42 / −18 / 0 */
export function signed(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  if (value === 0) return '0'
  return `${value > 0 ? '+' : '−'}${num(Math.abs(value), decimals)}`
}

export function initials(name: string): string {
  return name.split(/[\s\-–]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')
}
