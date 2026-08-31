/**
 * The costing engine.
 *
 * It answers one question: what did this garment actually cost to make, and
 * how does that sit against the price quoted to the buyer?
 *
 * Three quantities drive everything, and keeping them apart is the whole game:
 *
 *   ordered   what the buyer asked for
 *   shipped   ordered + excess — excess leaves the gate too, and the
 *             percentage differs from buyer to buyer
 *   produced  shipped grossed up for the pieces expected to fail checking;
 *             a rejected garment still ate fabric, thread and a sewing seat
 *
 * Material and making costs are charged on `produced`. Revenue is charged on
 * `invoiced`, which is `ordered` plus the excess only when the buyer pays for
 * it. When they do not, those free pieces come straight out of the margin —
 * and this engine puts a number on that instead of hiding it.
 */
import type {
  Buyer, Costing, CmtCostLine, FabricCostLine, JobWorkCostLine, Order,
  OverheadCostLine, RateEntry, Settings, TrimCostLine, AppState,
} from '../types'
import type { OrderFacts } from './production'

/* ── Quantities ──────────────────────────────────────────────────────── */

export interface Quantities {
  ordered: number
  excessPct: number
  excessQty: number
  shipped: number
  rejectionPct: number
  produced: number
  /** Pieces expected to be lost at checking. */
  rejectAllowance: number
  invoiced: number
  excessInvoiced: boolean
  /** True when nobody has told the app what this buyer's excess is. */
  excessUnset: boolean
}

export function resolveQuantities(
  order: Order,
  buyer: Buyer | undefined,
  costing: Pick<Costing, 'excessPct' | 'excessInvoiced' | 'rejectionPct'> | null,
): Quantities {
  const excessPct = costing?.excessPct ?? order.excessPct ?? buyer?.excessPct ?? 0
  const excessInvoiced = costing?.excessInvoiced ?? order.excessInvoiced ?? buyer?.excessInvoiced ?? true
  const rejectionPct = clamp(costing?.rejectionPct ?? 0, 0, 0.5)

  const ordered = Math.max(0, order.orderQty)
  const excessQty = Math.round(ordered * excessPct)
  const shipped = ordered + excessQty
  const produced = rejectionPct >= 1 ? shipped : Math.ceil(shipped / (1 - rejectionPct))

  return {
    ordered,
    excessPct,
    excessQty,
    shipped,
    rejectionPct,
    produced,
    rejectAllowance: produced - shipped,
    invoiced: ordered + (excessInvoiced ? excessQty : 0),
    excessInvoiced,
    excessUnset: costing?.excessPct == null && order.excessPct == null && buyer?.excessPctSet !== true,
  }
}

/* ── Line results ────────────────────────────────────────────────────── */

export interface FabricLineResult {
  line: FabricCostLine
  landedRate: number
  netKg: number
  grossKg: number
  wastageKg: number
  cost: number
  costPerPc: number
}

export interface TrimLineResult {
  line: TrimCostLine
  qtyNeeded: number
  cost: number
  costPerPc: number
}

export interface JobWorkLineResult {
  line: JobWorkCostLine
  pieces: number
  cost: number
  costPerPc: number
}

export interface CmtLineResult {
  line: CmtCostLine
  effectiveRate: number
  cost: number
  costPerPc: number
}

export interface OverheadLineResult {
  line: OverheadCostLine
  cost: number
  costPerPc: number
}

export interface CostBucket {
  key: 'fabric' | 'trims' | 'jobwork' | 'cmt' | 'overheads'
  label: string
  cost: number
  costPerPc: number
  sharePct: number
}

export interface CostResult {
  quantities: Quantities
  currency: string

  fabric: FabricLineResult[]
  trims: TrimLineResult[]
  jobwork: JobWorkLineResult[]
  cmt: CmtLineResult[]
  overheads: OverheadLineResult[]

  fabricCost: number
  trimsCost: number
  jobworkCost: number
  cmtCost: number
  overheadCost: number
  /** Everything except overheads charged as a percentage of cost. */
  directCost: number
  totalCost: number
  buckets: CostBucket[]

  /** Cost of one garment that leaves the gate — the honest per-garment cost. */
  costPerShippedPc: number
  /** Cost spread over the pieces the buyer actually pays for. */
  costPerInvoicedPc: number
  costPerProducedPc: number

  sellingPrice: number | null
  revenue: number
  margin: number
  marginPct: number | null
  /** The price at which this order breaks even, per invoiced piece. */
  breakEvenPrice: number
  contributionPerPc: number | null

  /** What the free excess pieces cost, when the buyer is not paying for them. */
  excessGiveaway: number
  excessGiveawayMarginPoints: number | null
  /** What the expected rejects cost. */
  rejectionCost: number

  totalFabricKg: number
  fabricKgPerPc: number
  verdict: { tone: 'ok' | 'warn' | 'risk' | 'unknown'; label: string; detail: string }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const money = (v: number) => (Number.isFinite(v) ? v : 0)

export function landedRateOf(line: FabricCostLine): number {
  if (line.landedRateOverride != null) return line.landedRateOverride
  return money(line.yarnRate) + money(line.knittingRate) + money(line.dyeingRate) +
    money(line.finishingRate) + money(line.otherRate)
}

export function computeCosting(
  costing: Costing,
  order: Order,
  buyer: Buyer | undefined,
  /** Pass real production quantities to cost what actually happened. */
  actual?: { produced: number; shipped: number; invoiced: number; fabricKg?: number } | null,
): CostResult {
  const planned = resolveQuantities(order, buyer, costing)
  const quantities: Quantities = actual
    ? {
        ...planned,
        ordered: order.orderQty,
        shipped: actual.shipped,
        produced: actual.produced,
        invoiced: actual.invoiced,
        excessQty: Math.max(0, actual.shipped - order.orderQty),
        rejectAllowance: Math.max(0, actual.produced - actual.shipped),
        rejectionPct: actual.produced > 0 ? Math.max(0, actual.produced - actual.shipped) / actual.produced : 0,
      }
    : planned

  const qty = quantities.produced
  const currency = costing.currency || order.currency || 'INR'

  /* Fabric — kilograms, then rupees a kilogram. */
  const fabric: FabricLineResult[] = costing.fabric.map((line) => {
    const landedRate = landedRateOf(line)
    const netKg = line.netKgOverride != null
      ? line.netKgOverride
      : (qty * money(line.netGramsPerPc ?? 0)) / 1000
    const grossKg = netKg * (1 + money(line.wastagePct))
    const cost = grossKg * landedRate
    return {
      line, landedRate, netKg, grossKg,
      wastageKg: grossKg - netKg,
      cost,
      costPerPc: qty > 0 ? cost / qty : 0,
    }
  })

  // When the real fabric weight is known, scale the plan to it so the actual
  // column reflects what was really issued rather than the estimate.
  if (actual?.fabricKg != null && actual.fabricKg > 0) {
    const plannedKg = fabric.map((f) => f.grossKg).reduce((a, b) => a + b, 0)
    if (plannedKg > 0) {
      const scale = actual.fabricKg / plannedKg
      for (const f of fabric) {
        f.netKg *= scale
        f.grossKg *= scale
        f.wastageKg *= scale
        f.cost = f.grossKg * f.landedRate
        f.costPerPc = qty > 0 ? f.cost / qty : 0
      }
    }
  }

  /* Trims — a rate per piece of trim, and how many go on a garment. */
  const trims: TrimLineResult[] = costing.trims.map((line) => {
    const qtyNeeded = qty * money(line.qtyPerPc) * (1 + money(line.wastagePct))
    const cost = qtyNeeded * money(line.rate)
    return { line, qtyNeeded, cost, costPerPc: qty > 0 ? cost / qty : 0 }
  })

  /* Job work — rupees a piece, per process, per vendor. */
  const jobwork: JobWorkLineResult[] = costing.jobwork.map((line) => {
    const pieces = qty * clamp(money(line.coverage), 0, 10)
    const cost = pieces * money(line.ratePerPc)
    return { line, pieces, cost, costPerPc: qty > 0 ? cost / qty : 0 }
  })

  /* CMT — either a flat rate a piece or standard minutes at a rate a minute. */
  const cmt: CmtLineResult[] = costing.cmt.map((line) => {
    const effectiveRate = line.basis === 'sam'
      ? money(line.samMinutes) * money(line.costPerMinute)
      : money(line.ratePerPc)
    const cost = qty * effectiveRate
    return { line, effectiveRate, cost, costPerPc: qty > 0 ? cost / qty : 0 }
  })

  const fabricCost = fabric.map((f) => f.cost).reduce((a, b) => a + b, 0)
  const trimsCost = trims.map((t) => t.cost).reduce((a, b) => a + b, 0)
  const jobworkCost = jobwork.map((j) => j.cost).reduce((a, b) => a + b, 0)
  const cmtCost = cmt.map((c) => c.cost).reduce((a, b) => a + b, 0)
  const beforeOverheads = fabricCost + trimsCost + jobworkCost + cmtCost

  /* Overheads — a lump sum for the order, a rate a piece, or a percentage. */
  const overheads: OverheadLineResult[] = costing.overheads.map((line) => {
    const cost =
      line.basis === 'lumpSum' ? money(line.amount)
      : line.basis === 'perPc' ? qty * money(line.amount)
      : beforeOverheads * money(line.amount)
    return { line, cost, costPerPc: qty > 0 ? cost / qty : 0 }
  })
  const overheadCost = overheads.map((o) => o.cost).reduce((a, b) => a + b, 0)
  const totalCost = beforeOverheads + overheadCost

  const buckets: CostBucket[] = ([
    ['fabric', 'Fabric', fabricCost],
    ['trims', 'Trims', trimsCost],
    ['jobwork', 'Job work', jobworkCost],
    ['cmt', 'CMT', cmtCost],
    ['overheads', 'Other costs', overheadCost],
  ] as const).map(([key, label, cost]) => ({
    key, label, cost,
    costPerPc: qty > 0 ? cost / qty : 0,
    sharePct: totalCost > 0 ? cost / totalCost : 0,
  }))

  const sellingPrice = costing.sellingPrice ?? order.sellingPrice
  const revenue = sellingPrice != null ? sellingPrice * quantities.invoiced : 0
  const margin = revenue - totalCost
  const marginPct = sellingPrice != null && revenue > 0 ? margin / revenue : null

  const costPerShippedPc = quantities.shipped > 0 ? totalCost / quantities.shipped : 0
  const costPerInvoicedPc = quantities.invoiced > 0 ? totalCost / quantities.invoiced : 0
  const costPerProducedPc = qty > 0 ? totalCost / qty : 0

  const freePieces = quantities.excessInvoiced ? 0 : quantities.excessQty
  const excessGiveaway = freePieces * costPerShippedPc
  const rejectionCost = quantities.rejectAllowance * costPerProducedPc

  const totalFabricKg = fabric.map((f) => f.grossKg).reduce((a, b) => a + b, 0)

  const verdict = ((): CostResult['verdict'] => {
    if (sellingPrice == null) {
      return { tone: 'unknown', label: 'No price quoted', detail: 'Enter the price quoted to the buyer to see the margin' }
    }
    if (totalCost === 0) {
      return { tone: 'unknown', label: 'No costs entered', detail: 'Add fabric, trims, job work and CMT rates to build the cost' }
    }
    if (margin < 0) {
      return { tone: 'risk', label: 'Losing money', detail: `Every piece loses ${(costPerInvoicedPc - sellingPrice).toFixed(2)} against the quote` }
    }
    if (marginPct != null && marginPct < 0.08) {
      return { tone: 'warn', label: 'Thin margin', detail: `${(marginPct * 100).toFixed(1)}% leaves nothing for a surprise` }
    }
    return { tone: 'ok', label: 'Healthy margin', detail: `${((marginPct ?? 0) * 100).toFixed(1)}% on the invoiced quantity` }
  })()

  return {
    quantities, currency,
    fabric, trims, jobwork, cmt, overheads,
    fabricCost, trimsCost, jobworkCost, cmtCost, overheadCost,
    directCost: beforeOverheads,
    totalCost, buckets,
    costPerShippedPc, costPerInvoicedPc, costPerProducedPc,
    sellingPrice, revenue, margin, marginPct,
    breakEvenPrice: costPerInvoicedPc,
    contributionPerPc: sellingPrice != null ? sellingPrice - costPerInvoicedPc : null,
    excessGiveaway,
    excessGiveawayMarginPoints: revenue > 0 ? excessGiveaway / revenue : null,
    rejectionCost,
    totalFabricKg,
    fabricKgPerPc: qty > 0 ? totalFabricKg / qty : 0,
    verdict,
  }
}

/**
 * The same costing priced against what the floor actually did, so a quote can
 * be held next to reality. Falls back to the plan while nothing has shipped.
 */
export function computeActual(
  costing: Costing,
  order: Order,
  buyer: Buyer | undefined,
  facts: OrderFacts | undefined,
): CostResult | null {
  if (!facts || facts.cumCut === 0) return null
  const produced = facts.cumCut
  const shipped = facts.cumShipped > 0 ? facts.cumShipped : Math.max(0, facts.cumCut - facts.cumReject)
  const excessShipped = Math.max(0, shipped - order.orderQty)
  const excessInvoiced = costing.excessInvoiced ?? order.excessInvoiced ?? buyer?.excessInvoiced ?? true
  const fabricKg = facts.fabric.issuedKg - facts.fabric.returnedKg
  return computeCosting(costing, order, buyer, {
    produced,
    shipped,
    invoiced: Math.min(shipped, order.orderQty) + (excessInvoiced ? excessShipped : 0),
    fabricKg: fabricKg > 0 ? fabricKg : undefined,
  })
}

/* ── Rate memory ─────────────────────────────────────────────────────── */

export type RateScope = RateEntry['scope']

/**
 * Finds the best remembered rate for a line.
 *
 * Scoring rewards matching the dimensions that actually drive the price —
 * a dyeing rate that matches the colour beats one that only matches the
 * fabric — and breaks ties on how recently it was used.
 */
export function findRate(
  rateBook: RateEntry[],
  kind: RateEntry['kind'],
  scope: RateScope,
): RateEntry | null {
  const wanted = Object.entries(scope).filter(([, v]) => v) as [keyof RateScope, string][]
  if (wanted.length === 0) return null

  let best: RateEntry | null = null
  let bestScore = 0

  for (const entry of rateBook) {
    if (entry.kind !== kind) continue
    let score = 0
    let contradicted = false
    for (const [dim, value] of wanted) {
      const entryValue = entry.scope[dim]
      if (!entryValue) continue                    // the rate is not scoped by this
      if (entryValue.toLowerCase() === value.toLowerCase()) score += DIMENSION_WEIGHT[dim] ?? 1
      else { contradicted = true; break }          // wrong colour is the wrong rate
    }
    if (contradicted || score === 0) continue
    // A more recently used rate wins a tie; a well-used rate beats a one-off.
    const recency = entry.lastUsedAt ? new Date(entry.lastUsedAt).getTime() / 1e13 : 0
    const total = score + Math.min(entry.uses, 50) / 1000 + recency
    if (total > bestScore) { bestScore = total; best = entry }
  }
  return best
}

/** How much each dimension matters when matching a remembered rate. */
const DIMENSION_WEIGHT: Partial<Record<keyof RateScope, number>> = {
  colour: 8, style: 8, item: 8, process: 6, vendor: 6, fabricType: 5, buyer: 3,
}

export function rateLabel(kind: RateEntry['kind'], scope: RateScope): string {
  const parts = [scope.process, scope.item, scope.fabricType, scope.colour, scope.style, scope.vendor]
    .filter(Boolean)
  const head = KIND_LABEL[kind] ?? kind
  return parts.length ? `${head} · ${parts.join(' · ')}` : head
}

export const KIND_LABEL: Record<RateEntry['kind'], string> = {
  yarn: 'Yarn / greige',
  knitting: 'Knitting',
  dyeing: 'Dyeing',
  finishing: 'Finishing',
  fabricLanded: 'Landed fabric',
  trim: 'Trim',
  jobwork: 'Job work',
  cmt: 'CMT',
  overhead: 'Overhead',
}

/* ── Building a costing with as little typing as possible ────────────── */

const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 9)}`

export interface Prefill {
  costing: Costing
  /** Where each pre-filled rate came from, so it can be trusted or changed. */
  provenance: Record<string, string>
}

/**
 * Builds a costing for an order out of what the system already knows.
 *
 * Fabric lines come from what was actually cut — including the piece weight
 * somebody weighed on the cutting table. Job work lines come from the vendors
 * the order really went to. Rates come from the rate book. The team should
 * only have to type the numbers nobody has recorded yet.
 */
export function prefillCosting(
  order: Order,
  state: AppState,
  facts: OrderFacts | undefined,
  settings: Settings,
  buyer: Buyer | undefined,
): Prefill {
  const provenance: Record<string, string> = {}
  const remember = (id: string, entry: RateEntry | null) => {
    if (!entry) return 0
    const where = entry.lastOrderNo ? ` · last used on ${entry.lastOrderNo}` : ''
    const uses = entry.uses > 1 ? ` · ${entry.uses}×` : ''
    provenance[id] = `${entry.label}${where}${uses}`
    return entry.rate
  }

  /* Fabric: one line per fabric type and colour that was actually cut. */
  const seenFabric = new Map<string, { fabricType: string; colour: string; grams: number[]; }>()
  for (const row of state.cutting) {
    if (row.orderNo !== order.orderNo) continue
    const key = `${row.fabricType} ${row.colour}`
    const cur = seenFabric.get(key) ?? { fabricType: row.fabricType, colour: row.colour, grams: [] }
    if (row.pcWtG) cur.grams.push(row.pcWtG)
    seenFabric.set(key, cur)
  }
  // Nothing cut yet? Fall back to the colours the order was booked in.
  if (seenFabric.size === 0) {
    const fabricType = state.fabric.find((f) => f.orderNo === order.orderNo)?.fabricType ?? ''
    for (const row of state.matrix) {
      if (row.orderNo !== order.orderNo) continue
      const key = `${fabricType} ${row.colour}`
      if (!seenFabric.has(key)) seenFabric.set(key, { fabricType, colour: row.colour, grams: [] })
    }
  }

  const fabric: FabricCostLine[] = [...seenFabric.values()].map(({ fabricType, colour, grams }) => {
    const id = uid('fab')
    const scope = { fabricType, colour }
    return {
      id,
      fabricType,
      colour,
      netGramsPerPc: grams.length ? round(average(grams), 1) : null,
      netKgOverride: null,
      wastagePct: settings.defaultFabricWastagePct,
      yarnRate: remember(`${id}:yarn`, findRate(state.rateBook, 'yarn', { fabricType })),
      knittingRate: remember(`${id}:knitting`, findRate(state.rateBook, 'knitting', { fabricType })),
      dyeingRate: remember(`${id}:dyeing`, findRate(state.rateBook, 'dyeing', scope)),
      finishingRate: remember(`${id}:finishing`, findRate(state.rateBook, 'finishing', { fabricType })),
      otherRate: 0,
      landedRateOverride: null,
      remarks: grams.length ? `Piece weight ${round(average(grams), 1)} g, weighed at cutting` : '',
    }
  })

  /* Trims: whatever this order already booked, converted to a per-piece rate. */
  const trims: TrimCostLine[] = []
  const seenTrims = new Map<string, number>()
  for (const row of state.trims) {
    if (row.orderNo !== order.orderNo || !row.trimItem) continue
    seenTrims.set(row.trimItem, (seenTrims.get(row.trimItem) ?? 0) + row.requiredQty)
  }
  for (const [trimItem, required] of seenTrims) {
    const id = uid('trm')
    trims.push({
      id, trimItem, supplier: '', unit: 'pcs',
      qtyPerPc: order.orderQty > 0 ? round(required / order.orderQty, 3) : 1,
      rate: remember(`${id}:rate`, findRate(state.rateBook, 'trim', { item: trimItem })),
      wastagePct: settings.defaultTrimWastagePct,
      remarks: '',
    })
  }

  /* Job work: the processes and vendors the order really went to. */
  const jobwork: JobWorkCostLine[] = []
  const seenJobWork = new Map<string, { process: string; vendor: string; sent: number }>()
  for (const row of state.jobwork) {
    if (row.orderNo !== order.orderNo || row.direction !== 'OUT') continue
    const key = `${row.process} ${row.vendor}`
    const cur = seenJobWork.get(key) ?? { process: row.process, vendor: row.vendor, sent: 0 }
    cur.sent += row.qty
    seenJobWork.set(key, cur)
  }
  // Nothing sent yet? Take the outsourced steps straight off the route.
  if (seenJobWork.size === 0 && facts) {
    for (const step of facts.route.steps) {
      if (['Cutting', 'Fusing', 'Sewing', 'Checking', 'Packing', 'Inspection', 'Shipment'].includes(step.process)) continue
      seenJobWork.set(`${step.process} `, { process: step.process, vendor: '', sent: 0 })
    }
  }
  for (const { process, vendor, sent } of seenJobWork.values()) {
    const id = uid('jw')
    jobwork.push({
      id, process, vendor,
      ratePerPc: remember(`${id}:rate`, findRate(state.rateBook, 'jobwork', { process, vendor, style: order.styleCode })),
      coverage: sent > 0 && order.orderQty > 0 ? round(Math.min(sent / order.orderQty, 1), 3) : 1,
      remarks: sent > 0 ? `${sent.toLocaleString('en-IN')} pcs sent so far` : '',
    })
  }

  /* CMT: the in-house steps this order's route actually contains. */
  const inHouseSteps = facts
    ? facts.route.processes.filter((p) => ['Cutting', 'Fusing', 'Sewing', 'Checking', 'Packing'].includes(p))
    : ['Cutting', 'Sewing', 'Checking', 'Packing']
  const operations = [...new Set([...inHouseSteps, 'Ironing'])]
  const cmt: CmtCostLine[] = operations.map((operation) => {
    const id = uid('cmt')
    const remembered = findRate(state.rateBook, 'cmt', { process: operation, style: order.styleCode })
    return {
      id, operation,
      basis: 'perPc' as const,
      ratePerPc: remember(`${id}:rate`, remembered),
      samMinutes: operation === 'Sewing' ? order.sam : 0,
      costPerMinute: 0,
      remarks: '',
    }
  })

  /* Other costs: the heads every order carries, waiting for their numbers. */
  const overheads: OverheadCostLine[] = ['Sampling', 'Lab Test', 'Documentation', 'Transportation']
    .map((head) => {
      const id = uid('ovh')
      return {
        id, head,
        basis: 'lumpSum' as const,
        amount: remember(`${id}:amount`, findRate(state.rateBook, 'overhead', { item: head, buyer: order.buyer })),
        remarks: '',
      }
    })

  const now = new Date().toISOString()
  return {
    provenance,
    costing: {
      id: uid('cst'),
      orderNo: order.orderNo,
      name: 'Working costing',
      currency: order.currency || buyer?.currency || settings.currency || 'INR',
      createdAt: now,
      updatedAt: now,
      status: 'Draft',
      sellingPrice: order.sellingPrice,
      excessPct: null,
      excessInvoiced: null,
      rejectionPct: settings.defaultRejectionPct,
      fabric, trims, jobwork, cmt, overheads,
      notes: '',
    },
  }
}

/** Every rate a saved costing contains, ready to go back into the rate book. */
export function harvestRates(costing: Costing, order: Order): Omit<RateEntry, 'id' | 'uses'>[] {
  const now = new Date().toISOString()
  const base = { currency: costing.currency, lastUsedAt: now, lastOrderNo: order.orderNo, note: '' }
  const out: Omit<RateEntry, 'id' | 'uses'>[] = []

  for (const line of costing.fabric) {
    const byFabric = { fabricType: line.fabricType }
    const byColour = { fabricType: line.fabricType, colour: line.colour }
    // Knitting follows the fabric; dyeing follows the colour. That split is
    // what lets two orders share one rate and differ on the other.
    if (line.yarnRate) out.push({ ...base, kind: 'yarn', unit: 'kg', rate: line.yarnRate, scope: byFabric, label: rateLabel('yarn', byFabric) })
    if (line.knittingRate) out.push({ ...base, kind: 'knitting', unit: 'kg', rate: line.knittingRate, scope: byFabric, label: rateLabel('knitting', byFabric) })
    if (line.dyeingRate) out.push({ ...base, kind: 'dyeing', unit: 'kg', rate: line.dyeingRate, scope: byColour, label: rateLabel('dyeing', byColour) })
    if (line.finishingRate) out.push({ ...base, kind: 'finishing', unit: 'kg', rate: line.finishingRate, scope: byFabric, label: rateLabel('finishing', byFabric) })
  }
  for (const line of costing.trims) {
    if (!line.rate || !line.trimItem) continue
    const scope = { item: line.trimItem, vendor: line.supplier || undefined }
    out.push({ ...base, kind: 'trim', unit: 'unit', rate: line.rate, scope, label: rateLabel('trim', scope) })
  }
  for (const line of costing.jobwork) {
    if (!line.ratePerPc || !line.process) continue
    // Printing changes style to style, so the exact quote is filed with the
    // style. The vendor's usual rate for that process is filed alongside it,
    // so a new style starts from something rather than a blank box.
    const exact = { process: line.process, vendor: line.vendor || undefined, style: order.styleCode || undefined }
    out.push({ ...base, kind: 'jobwork', unit: 'pc', rate: line.ratePerPc, scope: exact, label: rateLabel('jobwork', exact) })
    if (line.vendor && order.styleCode) {
      const general = { process: line.process, vendor: line.vendor }
      out.push({ ...base, kind: 'jobwork', unit: 'pc', rate: line.ratePerPc, scope: general, label: rateLabel('jobwork', general) })
    }
  }
  for (const line of costing.cmt) {
    const rate = line.basis === 'sam' ? line.samMinutes * line.costPerMinute : line.ratePerPc
    if (!rate || !line.operation) continue
    const exact = { process: line.operation, style: order.styleCode || undefined }
    out.push({ ...base, kind: 'cmt', unit: 'pc', rate, scope: exact, label: rateLabel('cmt', exact) })
    if (order.styleCode) {
      // Cutting and packing barely change style to style; sewing does. Keeping
      // the plain per-operation rate lets the first two carry across on their own.
      const general = { process: line.operation }
      out.push({ ...base, kind: 'cmt', unit: 'pc', rate, scope: general, label: rateLabel('cmt', general) })
    }
  }
  for (const line of costing.overheads) {
    if (!line.amount || !line.head) continue
    const scope = { item: line.head, buyer: order.buyer || undefined }
    out.push({ ...base, kind: 'overhead', unit: line.basis === 'perPc' ? 'pc' : 'order', rate: line.amount, scope, label: rateLabel('overhead', scope) })
  }
  return out
}

const average = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length
const round = (value: number, places: number) => {
  const f = 10 ** places
  return Math.round(value * f) / f
}
