/**
 * Usage history for the type-to-search fields.
 *
 * Every option a SmartCombo offers can show how many rows already use it and
 * which order it appeared on last. That turns a dropdown into a memory: the
 * colours this factory really runs float to the top, and a near-duplicate
 * ("OFF WHITE" next to "OFF-WHITE") is obvious before someone creates it.
 */
import { useMemo } from 'react'
import { useStore } from '../lib/store'
import type { ComboStat } from '../components/SmartCombo'

export type StatMap = Record<string, ComboStat>

/** Which rows feed which list, and how to read a value and an order out of them. */
export function useComboStats(list: string | undefined): StatMap | undefined {
  const data = useStore((s) => s.data)

  return useMemo(() => {
    if (!list) return undefined
    const tally: StatMap = {}
    const note = (value: string | undefined | null, orderNo?: string, date?: string) => {
      if (!value) return
      const entry = (tally[value] ??= { count: 0 })
      entry.count += 1
      // Keep the most recent order this value was seen on.
      const seen = (entry as { _date?: string })._date
      if (orderNo && (!seen || (date ?? '') >= seen)) {
        entry.lastOrderNo = orderNo
        ;(entry as { _date?: string })._date = date ?? ''
      }
    }

    switch (list) {
      case 'buyers':
        for (const o of data.orders) note(o.buyer, o.orderNo, o.orderDate)
        break
      case 'styles':
        for (const o of data.orders) note(o.styleCode, o.orderNo, o.orderDate)
        break
      case 'colours':
        for (const r of data.matrix) note(r.colour, r.orderNo)
        for (const r of data.cutting) note(r.colour, r.orderNo, r.date)
        for (const r of data.fabric) note(r.colour, r.orderNo, r.date)
        break
      case 'sizes':
        for (const r of data.matrix) note(r.size, r.orderNo)
        break
      case 'fabricTypes':
        for (const r of data.cutting) note(r.fabricType, r.orderNo, r.date)
        for (const r of data.fabric) note(r.fabricType, r.orderNo, r.date)
        break
      case 'vendors':
        for (const r of data.jobwork) note(r.vendor, r.orderNo, r.date)
        break
      case 'jobWorkProcesses':
      case 'processes':
        for (const r of data.jobwork) note(r.process, r.orderNo, r.date)
        for (const r of data.routeSteps) note(r.process, r.orderNo)
        break
      case 'trimItems':
        for (const r of data.trims) note(r.trimItem, r.orderNo, r.date)
        break
      case 'lines':
        for (const r of data.sewing) note(r.line, r.orderNo, r.date)
        break
      case 'team':
        for (const o of data.orders) { note(o.merchandiser, o.orderNo, o.orderDate); note(o.planner, o.orderNo, o.orderDate) }
        break
      case 'approvalTypes':
        for (const r of data.approvals) note(r.approvalType, r.orderNo, r.sentDate)
        break
      case 'inspectors':
        for (const r of data.inspection) note(r.inspector, r.orderNo, r.inspectionDate)
        break
      case 'cmtOperations':
        for (const c of data.costings) for (const l of c.cmt) note(l.operation, c.orderNo, c.updatedAt)
        break
      case 'overheadHeads':
        for (const c of data.costings) for (const l of c.overheads) note(l.head, c.orderNo, c.updatedAt)
        break
      case 'suppliers':
        for (const c of data.costings) for (const l of c.trims) note(l.supplier, c.orderNo, c.updatedAt)
        break
      default:
        return undefined
    }

    for (const entry of Object.values(tally)) delete (entry as { _date?: string })._date
    return tally
  }, [list, data])
}

/** The colours and sizes this order was actually booked in — the obvious picks. */
export function useOrderSuggestions(orderNo: string | undefined) {
  const data = useStore((s) => s.data)
  return useMemo(() => {
    if (!orderNo) return { colours: [], sizes: [], fabricTypes: [], vendors: [], processes: [] }
    const rows = data.matrix.filter((r) => r.orderNo === orderNo)
    const cuts = data.cutting.filter((r) => r.orderNo === orderNo)
    const jobs = data.jobwork.filter((r) => r.orderNo === orderNo)
    const steps = data.routeSteps.filter((r) => r.orderNo === orderNo)
    return {
      colours: [...new Set(rows.map((r) => r.colour).filter(Boolean))],
      sizes: [...new Set(rows.map((r) => r.size).filter(Boolean))],
      fabricTypes: [...new Set([
        ...cuts.map((r) => r.fabricType),
        ...data.fabric.filter((r) => r.orderNo === orderNo).map((r) => r.fabricType),
      ].filter(Boolean))],
      vendors: [...new Set(jobs.map((r) => r.vendor).filter(Boolean))],
      processes: [...new Set(steps.map((r) => r.process).filter(Boolean))],
    }
  }, [orderNo, data])
}
