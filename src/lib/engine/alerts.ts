/**
 * The alerts engine — the "what needs me today" list.
 *
 * Fourteen checks, each producing at most one alert per order. Management can
 * accept a delay: the alert is then suppressed until the date they set, never
 * deleted, and stays visible as a waived count.
 */
import type { AppState, Settings } from '../types'
import { daysBetween, today } from '../format'
import type { Derived, OrderFacts } from './production'
import type { SetSummary } from './sets'

export type Severity = 'HIGH' | 'MEDIUM' | 'LOW'

export const ALERT_TYPES = [
  'OVERDUE', 'SHIPMENT RISK', 'APPROVAL BLOCK', 'FABRIC WAITING', 'TRIMS BLOCK',
  'AT JOB WORK', 'AGED WIP', 'OVER-CUT', 'RECUT PENDING', 'SEWING BEHIND',
  'DHU HIGH', 'INSPECTION BLOCK', 'SET PAIR GAP', 'FABRIC WASTAGE',
] as const
export type AlertType = (typeof ALERT_TYPES)[number]

export interface Alert {
  id: string
  type: AlertType
  severity: Severity
  orderNo: string
  buyer: string
  qty: number
  days: number
  owner: string
  message: string
  action: string
  /** Set when management has accepted the delay; the date it lapses. */
  suppressedUntil: string | null
  /** Sorting weight — highest first. */
  score: number
}

const SEVERITY_WEIGHT: Record<Severity, number> = { HIGH: 1_000_000, MEDIUM: 10_000, LOW: 100 }

export function deriveAlerts(
  state: AppState,
  derived: Derived,
  sets: SetSummary,
  settings: Settings,
): { open: Alert[]; suppressed: Alert[] } {
  const now = today()
  const open: Alert[] = []
  const suppressed: Alert[] = []

  /** A live waiver silences an alert until the date management set. */
  const waiverFor = (orderNo: string, type: AlertType): string | null => {
    for (const waiver of state.waivers) {
      if (!waiver.approved) continue
      if (waiver.orderNo !== orderNo) continue
      if (waiver.alertType !== type && waiver.alertType !== 'ALL') continue
      if (waiver.validUntil && waiver.validUntil < now) continue
      return waiver.validUntil || 'no end date'
    }
    return null
  }

  const push = (
    facts: OrderFacts,
    type: AlertType,
    severity: Severity,
    qty: number,
    days: number,
    message: string,
    action: string,
  ) => {
    const until = waiverFor(facts.order.orderNo, type)
    const alert: Alert = {
      id: `${facts.order.orderNo}:${type}`,
      type,
      severity,
      orderNo: facts.order.orderNo,
      buyer: facts.order.buyer,
      qty,
      days,
      owner: facts.order.merchandiser || facts.order.planner || '—',
      message,
      action,
      suppressedUntil: until,
      score: SEVERITY_WEIGHT[severity] + days * 100 + Math.min(qty, 9_999) / 10,
    }
    ;(until ? suppressed : open).push(alert)
  }

  const trimsByOrder = new Map<string, { short: number; blocking: number }>()
  for (const row of state.trims) {
    const short = Math.max(0, row.requiredQty - row.receivedQty)
    const cur = trimsByOrder.get(row.orderNo) ?? { short: 0, blocking: 0 }
    cur.short += short
    if (row.blocksPacking && short > 0) cur.blocking += 1
    trimsByOrder.set(row.orderNo, cur)
  }

  const inspectionPassed = new Map<string, boolean>()
  for (const row of state.inspection) {
    if (row.result === 'Pass') inspectionPassed.set(row.orderNo, true)
    else if (!inspectionPassed.has(row.orderNo)) inspectionPassed.set(row.orderNo, false)
  }

  for (const facts of derived.orders) {
    const { order } = facts
    if (order.status !== 'Active') continue // a paused order is not shouting at anyone

    const unshipped = Math.max(0, order.orderQty - facts.cumShipped)

    /* 1 · OVERDUE ─ past the ex-factory date with pieces still here. */
    const overdueBy = order.exFactoryDate ? (daysBetween(order.exFactoryDate, now) ?? 0) : 0
    if (overdueBy > 0 && unshipped > 0) {
      push(facts, 'OVERDUE', 'HIGH', unshipped, overdueBy,
        `Past ex-factory by ${overdueBy} days with ${fmt(unshipped)} pcs unshipped`,
        'Agree a revised date with the buyer and update the ex-factory date')
    }

    /* 2 · SHIPMENT RISK ─ the line cannot finish at the pace it is running. */
    const sewTarget = order.sewCompleteBy || order.exFactoryDate
    const toSew = Math.max(0, order.orderQty - facts.sewn)
    if (facts.route.has('Sewing') && toSew > 0 && sewTarget) {
      const daysLeft = daysBetween(now, sewTarget) ?? 0
      const pace = averageDailyOutput(state, order.orderNo)
      if (daysLeft >= 0 && pace > 0 && toSew > pace * daysLeft) {
        push(facts, 'SHIPMENT RISK', 'HIGH', toSew, daysLeft,
          `At ${fmt(Math.round(pace))} pcs a day sewing will not finish by ${sewTarget} — ${fmt(toSew)} pcs still to sew`,
          'Add a line, add hours, or move the sew-complete date')
      } else if (daysLeft < 0) {
        push(facts, 'SHIPMENT RISK', 'HIGH', toSew, -daysLeft,
          `Sew-complete date passed ${-daysLeft} days ago with ${fmt(toSew)} pcs still to sew`,
          'Add a line, add hours, or move the sew-complete date')
      }
    }

    /* 3 · APPROVAL BLOCK ─ the buyer still owes something production needs. */
    const blocking = state.approvals.filter(
      (a) => a.orderNo === order.orderNo && a.required && a.blocksProduction && a.status === 'Pending',
    )
    if (blocking.length > 0) {
      const oldest = blocking
        .map((a) => (a.sentDate ? daysBetween(a.sentDate, now) ?? 0 : 0))
        .reduce((a, b) => Math.max(a, b), 0)
      push(facts, 'APPROVAL BLOCK', 'HIGH', blocking.length, oldest,
        `${blocking.length} approval${blocking.length > 1 ? 's' : ''} that block production still pending — ${blocking.map((a) => a.approvalType).join(', ')}`,
        'Chase the buyer today; production cannot start without them')
    }

    /* 4 · FABRIC WAITING ─ but only once the required-by date is in sight. */
    if (facts.fabric.receivedKg === 0 && facts.fabricRequiredBy) {
      const daysToRequired = daysBetween(now, facts.fabricRequiredBy) ?? 0
      if (daysToRequired <= settings.fabricDueSoonWindowDays) {
        const severity: Severity = daysToRequired < 0 ? 'HIGH' : daysToRequired === 0 ? 'HIGH' : 'MEDIUM'
        const when = daysToRequired < 0
          ? `overdue by ${-daysToRequired} days`
          : daysToRequired === 0 ? 'due today' : `due in ${daysToRequired} days`
        push(facts, 'FABRIC WAITING', severity, order.orderQty, Math.abs(daysToRequired),
          `No fabric received and it is ${when} (required by ${facts.fabricRequiredBy})`,
          'Chase the knitter or dyer, or move the fabric lead time on the order')
      }
    }

    /* 5 · TRIMS BLOCK ─ a carton that cannot close. */
    const trims = trimsByOrder.get(order.orderNo)
    if (trims && trims.blocking > 0) {
      push(facts, 'TRIMS BLOCK', 'HIGH', trims.short, 0,
        `${trims.blocking} trim line${trims.blocking > 1 ? 's' : ''} short and marked as blocking packing`,
        'Expedite the trim or clear the carton spec with the buyer')
    }

    /* 6 · AT JOB WORK ─ pieces sitting at a vendor. */
    const atVendor = facts.atJobWorkVendor
    if (atVendor > 0) {
      const oldestOut = state.jobwork
        .filter((r) => r.orderNo === order.orderNo && r.direction === 'OUT' && r.date)
        .map((r) => daysBetween(r.date, now) ?? 0)
        .reduce((a, b) => Math.max(a, b), 0)
      if (oldestOut >= 3) {
        push(facts, 'AT JOB WORK', oldestOut >= settings.jobWorkWatchDays ? 'HIGH' : 'MEDIUM', atVendor, oldestOut,
          `${fmt(atVendor)} pcs sitting at a job work vendor for ${oldestOut} days`,
          'Escalate to the vendor or send a vehicle to collect')
      }
    }

    /* 7 · AGED WIP ─ a pile nobody has touched. */
    const aged = facts.cells.filter((c) => c.flag === 'AGED')
    if (aged.length > 0) {
      const qty = aged.map((c) => c.totalWip).reduce((a, b) => a + b, 0)
      const days = aged.map((c) => c.ageingDays ?? 0).reduce((a, b) => Math.max(a, b), 0)
      push(facts, 'AGED WIP', 'HIGH', qty, days,
        `${fmt(qty)} pcs have not moved for ${days} days — ${aged[0].whereNow}`,
        'Find the pile on the floor and give it an owner today')
    }

    /* 8 · OVER-CUT ─ fabric being burned without a decision. */
    const overCut = facts.cells
      .filter((c) => c.recutDecision !== 'Over Cut Approved')
      .map((c) => c.overCut)
      .reduce((a, b) => a + b, 0)
    if (overCut > 0) {
      push(facts, 'OVER-CUT', 'MEDIUM', overCut, 0,
        `Cut ${fmt(overCut)} pcs beyond plan plus buffer without approval — fabric is being burned`,
        'Approve it on the size breakdown, correct the cutting entry, or raise the buffer %')
    }

    /* 9 · RECUT PENDING ─ a shortage confirmed by what was actually cut. */
    const shortCells = facts.cells.filter(
      (c) => c.shortBy > 0 && c.cumCut > 0 &&
        c.recutDecision !== 'Recut Done' && c.recutDecision !== 'Ship Short Approved',
    )
    if (shortCells.length > 0 && order.exFactoryDate) {
      const decideBy = shiftDays(order.exFactoryDate, -settings.recutLeadDays)
      const daysToDecide = daysBetween(now, decideBy) ?? 0
      if (daysToDecide <= settings.recutDueNoticeWindowDays) {
        const qty = shortCells.map((c) => c.shortBy).reduce((a, b) => a + b, 0)
        push(facts, 'RECUT PENDING', daysToDecide < 0 ? 'HIGH' : 'MEDIUM', qty, Math.abs(daysToDecide),
          `${fmt(qty)} pcs short across ${shortCells.length} size${shortCells.length > 1 ? 's' : ''} — decision was due ${decideBy}`,
          'Set the recut decision: recut, or get ship-short approved')
      }
    }

    /* 10 · SEWING BEHIND ─ behind the pace the remaining days demand. */
    if (facts.route.has('Sewing') && toSew > 0 && sewTarget) {
      const daysLeft = daysBetween(now, sewTarget) ?? 0
      const pace = averageDailyOutput(state, order.orderNo)
      if (daysLeft > 0 && pace > 0) {
        const required = toSew / daysLeft
        if (required > pace * 1.15) {
          push(facts, 'SEWING BEHIND', 'MEDIUM', toSew, daysLeft,
            `Needs ${fmt(Math.ceil(required))} pcs a day but the line is running at ${fmt(Math.round(pace))}`,
            'Rebalance the line or move volume to another line')
        }
      }
    }

    /* 11 · DHU HIGH ─ too much coming back off the line. */
    if (facts.dhuPct != null && facts.dhuPct > settings.dhuThresholdPct && facts.cumChecked > 0) {
      const failing = Math.round(facts.dhuPct * facts.cumChecked)
      push(facts, 'DHU HIGH', 'MEDIUM', failing, 0,
        `DHU is ${(facts.dhuPct * 100).toFixed(1)}% — ${fmt(failing)} pcs failing at checking`,
        'Take the top defect back to the line before the next block')
    }

    /* 12 · INSPECTION BLOCK ─ packed, but the gate has not opened. */
    if (facts.route.has('Inspection') && facts.cumPacked > 0 && inspectionPassed.get(order.orderNo) !== true) {
      const waiting = Math.max(0, facts.cumPacked - facts.cumShipped)
      if (waiting > 0) {
        push(facts, 'INSPECTION BLOCK', 'HIGH', waiting, 0,
          `${fmt(waiting)} pcs are packed but final inspection has not passed`,
          'Book the inspection or record the result')
      }
    }

    /* 13 · SET PAIR GAP ─ half a set cannot ship. */
    const setInfo = sets.byOrder.get(order.orderNo)
    if (setInfo && (setInfo.broken > 0 || setInfo.imbalance > 0)) {
      push(facts, 'SET PAIR GAP', 'HIGH', setInfo.imbalance, 0,
        setInfo.broken > 0
          ? `Set pairing broken on ${setInfo.broken} line${setInfo.broken > 1 ? 's' : ''} — no partner order, or the partner has no matching colour and size`
          : `${fmt(setInfo.imbalance)} pcs have shipped without their partner`,
        setInfo.broken > 0
          ? 'Fix the set group and role on the order, or add the missing colour and size row'
          : 'Hold the next dispatch until both halves can go together')
    }

    /* 14 · FABRIC WASTAGE ─ kilograms nobody can explain. */
    if (facts.fabric.wastagePct != null && facts.fabric.wastagePct > settings.fabricWastageThresholdPct) {
      push(facts, 'FABRIC WASTAGE', 'MEDIUM', Math.round(facts.fabric.wastageKg), 0,
        `Fabric wastage is ${(facts.fabric.wastagePct * 100).toFixed(1)}% — ${facts.fabric.wastageKg.toFixed(1)} kg unaccounted`,
        'Re-weigh the fabric or enter the consumed kilograms manually')
    }
  }

  const bySeverity = (a: Alert, b: Alert) => b.score - a.score
  return { open: open.sort(bySeverity), suppressed: suppressed.sort(bySeverity) }
}

/** Average pieces a day off the line, from the days it actually ran. */
function averageDailyOutput(state: AppState, orderNo: string): number {
  const rows = state.sewing.filter((r) => r.orderNo === orderNo)
  const producing = rows.filter((r) => r.block1 + r.block2 + r.block3 > 0)
  if (producing.length === 0) return 0
  const output = producing.map((r) => r.block1 + r.block2 + r.block3).reduce((a, b) => a + b, 0)
  return output / producing.length
}

function shiftDays(iso: string, days: number): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-IN')
