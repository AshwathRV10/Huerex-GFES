/**
 * Costing rolled up across the whole order book.
 *
 * Each order's newest costing is priced twice: once on the plan and once on
 * what the floor has actually done, so the quote and the reality sit side by
 * side everywhere they matter.
 */
import { useMemo } from 'react'
import { useDerived, useStore } from '../lib/store'
import { computeActual, computeCosting, type CostResult } from '../lib/engine/costing'
import type { Costing } from '../lib/types'

export interface OrderCosting {
  costing: Costing
  planned: CostResult
  actual: CostResult | null
}

export interface CostSummary {
  byOrder: Map<string, OrderCosting>
  costedOrders: string[]
  uncostedOrders: string[]
  totals: {
    revenue: number
    cost: number
    margin: number
    marginPct: number | null
    /** Orders where the cost exceeds the price quoted. */
    loseMoney: number
    /** Orders whose margin is under eight points. */
    thin: number
    excessGiveaway: number
    currency: string
  }
}

export function useCostSummary(): CostSummary {
  const orders = useStore((s) => s.data.orders)
  const buyers = useStore((s) => s.data.buyers)
  const costings = useStore((s) => s.data.costings)
  const settings = useStore((s) => s.settings)
  const { derived } = useDerived()

  return useMemo(() => {
    const buyerByName = new Map(buyers.map((b) => [b.name, b]))
    const byOrder = new Map<string, OrderCosting>()
    const costedOrders: string[] = []
    const uncostedOrders: string[] = []

    let revenue = 0
    let cost = 0
    let loseMoney = 0
    let thin = 0
    let excessGiveaway = 0

    for (const order of orders) {
      // The most recently touched costing is the one that counts.
      const candidates = costings
        .filter((c) => c.orderNo === order.orderNo)
        .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
      const costing = candidates[0]

      if (!costing) {
        uncostedOrders.push(order.orderNo)
        continue
      }
      costedOrders.push(order.orderNo)

      const buyer = buyerByName.get(order.buyer)
      const facts = derived.byOrderNo.get(order.orderNo)
      const planned = computeCosting(costing, order, buyer, null)
      const actual = computeActual(costing, order, buyer, facts)

      byOrder.set(order.orderNo, { costing, planned, actual })

      if (order.status === 'Active' || order.status === 'Closed') {
        revenue += planned.revenue
        cost += planned.totalCost
        excessGiveaway += planned.excessGiveaway
        if (planned.sellingPrice != null && planned.totalCost > 0) {
          if (planned.margin < 0) loseMoney += 1
          else if ((planned.marginPct ?? 1) < 0.08) thin += 1
        }
      }
    }

    return {
      byOrder,
      costedOrders,
      uncostedOrders,
      totals: {
        revenue,
        cost,
        margin: revenue - cost,
        marginPct: revenue > 0 ? (revenue - cost) / revenue : null,
        loseMoney,
        thin,
        excessGiveaway,
        currency: settings.currency ?? 'INR',
      },
    }
  }, [orders, buyers, costings, derived, settings.currency])
}
