/**
 * Set control: a two-piece set only ships when both halves ship.
 *
 * Orders carry a Set Group and a role (Primary / Secondary). Everything else
 * is worked out here — nobody types a set quantity.
 */
import type { AppState } from '../types'
import type { CellFacts } from './production'

export interface SetLine {
  setGroup: string
  colour: string
  size: string
  primaryOrder: string
  secondaryOrder: string
  setQty: number
  primaryCut: number
  secondaryCut: number
  primaryGood: number
  secondaryGood: number
  primaryPacked: number
  secondaryPacked: number
  primaryShipped: number
  secondaryShipped: number
  setsMakeable: number
  setsPacked: number
  setsShipped: number
  /** Pieces shipped on one leg with no partner to go with them. */
  legImbalance: number
  configError: string
  status: string
}

export interface SetSummary {
  lines: SetLine[]
  byOrder: Map<string, { imbalance: number; broken: number }>
}

const empty = (): CellFacts | undefined => undefined

export function deriveSets(state: AppState, cells: CellFacts[]): SetSummary {
  const byCell = new Map<string, CellFacts>()
  for (const cell of cells) byCell.set(`${cell.orderNo} ${cell.colour} ${cell.size}`, cell)

  const groups = new Map<string, { primary: string[]; secondary: string[] }>()
  for (const order of state.orders) {
    if (!order.setGroup || order.setGroup === '-') continue
    const group = groups.get(order.setGroup) ?? { primary: [], secondary: [] }
    if (order.setRole === 'Secondary') group.secondary.push(order.orderNo)
    else group.primary.push(order.orderNo)
    groups.set(order.setGroup, group)
  }

  const lines: SetLine[] = []
  const byOrder = new Map<string, { imbalance: number; broken: number }>()
  const note = (orderNo: string, imbalance: number, broken: number) => {
    if (!orderNo) return
    const cur = byOrder.get(orderNo) ?? { imbalance: 0, broken: 0 }
    cur.imbalance += imbalance
    cur.broken += broken
    byOrder.set(orderNo, cur)
  }

  for (const [setGroup, group] of groups) {
    const primaryOrder = group.primary[0] ?? ''
    const secondaryOrder = group.secondary[0] ?? ''

    // Every colour and size either half declares needs a partner.
    const combos = new Map<string, { colour: string; size: string }>()
    for (const orderNo of [...group.primary, ...group.secondary]) {
      for (const row of state.matrix) {
        if (row.orderNo !== orderNo) continue
        combos.set(`${row.colour} ${row.size}`, { colour: row.colour, size: row.size })
      }
    }

    for (const { colour, size } of combos.values()) {
      const primary = primaryOrder ? byCell.get(`${primaryOrder} ${colour} ${size}`) : empty()
      const secondary = secondaryOrder ? byCell.get(`${secondaryOrder} ${colour} ${size}`) : empty()

      const configError = !secondaryOrder
        ? 'No Secondary order declared for this set group'
        : !primaryOrder
          ? 'No Primary order declared for this set group'
          : !primary
            ? `${primaryOrder} has no ${colour} / ${size} row`
            : !secondary
              ? `${secondaryOrder} has no ${colour} / ${size} row`
              : ''

      const setQty = Math.min(primary?.orderQty ?? 0, secondary?.orderQty ?? 0)
      const setsMakeable = Math.min(primary?.netGood ?? 0, secondary?.netGood ?? 0)
      const setsPacked = Math.min(primary?.cumPacked ?? 0, secondary?.cumPacked ?? 0)
      const setsShipped = Math.min(primary?.cumShipped ?? 0, secondary?.cumShipped ?? 0)
      const legImbalance = Math.abs((primary?.cumShipped ?? 0) - (secondary?.cumShipped ?? 0))

      const status = configError
        ? 'PAIRING BROKEN'
        : setQty > 0 && setsShipped >= setQty
          ? 'Sets complete'
          : legImbalance > 0
            ? `${legImbalance} pcs shipped unpaired`
            : setsMakeable > 0
              ? `${setsMakeable} sets makeable`
              : 'Not started'

      lines.push({
        setGroup, colour, size, primaryOrder, secondaryOrder, setQty,
        primaryCut: primary?.cumCut ?? 0,
        secondaryCut: secondary?.cumCut ?? 0,
        primaryGood: primary?.netGood ?? 0,
        secondaryGood: secondary?.netGood ?? 0,
        primaryPacked: primary?.cumPacked ?? 0,
        secondaryPacked: secondary?.cumPacked ?? 0,
        primaryShipped: primary?.cumShipped ?? 0,
        secondaryShipped: secondary?.cumShipped ?? 0,
        setsMakeable, setsPacked, setsShipped, legImbalance, configError, status,
      })

      note(primaryOrder, legImbalance, configError ? 1 : 0)
      note(secondaryOrder, legImbalance, configError ? 1 : 0)
    }
  }

  return { lines, byOrder }
}
