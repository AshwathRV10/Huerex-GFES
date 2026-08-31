/** A hand-worked costing, checked against the engine. */
import { computeCosting, resolveQuantities } from '../src/lib/engine/costing'
import type { Buyer, Costing, Order } from '../src/lib/types'

const order = {
  id: 'o1', orderNo: 'T-1', buyer: 'ACME', styleCode: 'S1', styleName: 'TEE',
  orderQty: 1000, orderDate: '2026-01-01', exFactoryDate: '2026-04-01', sewCompleteBy: '',
  sam: 10, bufferPct: 0.05, merchandiser: '', planner: '', status: 'Active',
  setGroup: '', setRole: '', fabricLeadDays: null, sellingPrice: 250, currency: 'INR',
  excessPct: null, excessInvoiced: null, notes: '',
} satisfies Order

const buyer = {
  id: 'b1', name: 'ACME', excessPct: 0.03, excessPctSet: true, excessInvoiced: false,
  currency: 'INR', paymentTerms: '', notes: '',
} satisfies Buyer

const costing = {
  id: 'c1', orderNo: 'T-1', name: 'x', currency: 'INR',
  createdAt: '', updatedAt: '', status: 'Draft',
  sellingPrice: 250, excessPct: null, excessInvoiced: null, rejectionPct: 0.02,
  fabric: [{
    id: 'f1', fabricType: 'SJ', colour: 'PINK', netGramsPerPc: 200, netKgOverride: null,
    wastagePct: 0.10, yarnRate: 250, knittingRate: 40, dyeingRate: 60, finishingRate: 20,
    otherRate: 0, landedRateOverride: null, remarks: '',
  }],
  trims: [{ id: 't1', trimItem: 'Main Label', supplier: '', unit: 'pcs', qtyPerPc: 1, rate: 2, wastagePct: 0, remarks: '' }],
  jobwork: [{ id: 'j1', process: 'Print', vendor: 'V', ratePerPc: 12, coverage: 1, remarks: '' }],
  cmt: [{ id: 'm1', operation: 'Sewing', basis: 'perPc', ratePerPc: 30, samMinutes: 0, costPerMinute: 0, remarks: '' }],
  overheads: [{ id: 'v1', head: 'Sampling', basis: 'lumpSum', amount: 5000, remarks: '' }],
  notes: '',
} satisfies Costing

const q = resolveQuantities(order, buyer, costing)
const r = computeCosting(costing, order, buyer, null)

const expect = (label: string, actual: number, wanted: number, tol = 0.01) => {
  const ok = Math.abs(actual - wanted) <= tol
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(34)} got ${actual.toFixed(4).padStart(12)}  want ${wanted.toFixed(4)}`)
  if (!ok) process.exitCode = 1
}

// Quantities: 1000 ordered, 3% excess = 30, ships 1030, 2% rejection → ceil(1030/0.98)=1052
expect('excess qty', q.excessQty, 30)
expect('shipped', q.shipped, 1030)
expect('produced', q.produced, Math.ceil(1030 / 0.98))
expect('invoiced (excess is free)', q.invoiced, 1000)

// Fabric: 1052 pcs x 200 g = 210.4 kg net, +10% = 231.44 kg, at 370/kg
const produced = Math.ceil(1030 / 0.98)
const grossKg = (produced * 200 / 1000) * 1.1
expect('fabric kg', r.totalFabricKg, grossKg)
expect('fabric cost', r.fabricCost, grossKg * 370)
expect('trims cost', r.trimsCost, produced * 1 * 2)
expect('job work cost', r.jobworkCost, produced * 12)
expect('cmt cost', r.cmtCost, produced * 30)
expect('overhead cost', r.overheadCost, 5000)

const total = grossKg * 370 + produced * 2 + produced * 12 + produced * 30 + 5000
expect('total cost', r.totalCost, total)
expect('cost per shipped pc', r.costPerShippedPc, total / 1030)
expect('cost per invoiced pc', r.costPerInvoicedPc, total / 1000)
expect('revenue (excess not invoiced)', r.revenue, 250 * 1000)
expect('margin', r.margin, 250 * 1000 - total)
expect('break-even price', r.breakEvenPrice, total / 1000)
// The 30 free pieces cost what any shipped piece costs.
expect('free excess giveaway', r.excessGiveaway, 30 * (total / 1030))
expect('rejection cost', r.rejectionCost, (produced - 1030) * (total / produced))

// Invoicing the excess must lift revenue and cut the giveaway to nothing.
const paid = computeCosting({ ...costing, excessInvoiced: true }, order, buyer, null)
expect('revenue when excess is paid', paid.revenue, 250 * 1030)
expect('giveaway when excess is paid', paid.excessGiveaway, 0)
console.log(paid.margin > r.margin ? 'PASS  invoicing the excess improves the margin' : 'FAIL  margin did not improve')
