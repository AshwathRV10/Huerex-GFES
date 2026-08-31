/**
 * The production engine, checked against the workbook this app replaces.
 *
 * The rule under test is the one the whole system exists to defend:
 * Cut = Shipped + Rejected + WIP, for every order, every time.
 */
import { derive, buildRoute } from '../src/lib/engine/production'
import { deriveSets } from '../src/lib/engine/sets'
import { deriveAlerts } from '../src/lib/engine/alerts'
import { buildSeed } from '../server/seed'
import type { AppState, Settings } from '../src/lib/types'
import type { ProcessTypes } from '../src/lib/engine/production'

let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`)
  if (!ok) failures++
}

const db = buildSeed()
const state = db.collections as unknown as AppState
const settings = db.singletons.settings as Settings
const processTypes = db.singletons.processTypes as ProcessTypes

const derived = derive(state, settings, processTypes)
const sets = deriveSets(state, derived.cells)
const alerts = deriveAlerts(state, derived, sets, settings)

check('the workbook imported', derived.orders.length === 16, `${derived.orders.length} orders`)
check('every order has a route', derived.orders.every((o) => o.route.processes.length > 0))
check('the size breakdown matches every order', derived.orders.every((o) => o.variance === 0),
  derived.orders.filter((o) => o.variance !== 0).map((o) => `${o.order.orderNo} ${o.variance}`).join(', '))

/* The identity. */
const unbalanced = derived.orders.filter((o) => o.cumCut > 0 && !o.reconciliation.balanced)
check('Cut = Shipped + Rejected + WIP holds for every order', unbalanced.length === 0,
  unbalanced.map((o) => `${o.order.orderNo} out by ${o.reconciliation.difference}`).join(', '))

/* No bucket may ever go negative — a negative pile is a broken model. */
const negative = derived.cells.filter((c) =>
  [c.awaitingFusing, c.awaitingJobWork, c.atJobWorkVendor, c.readyForSewing, c.inSewing,
    c.awaitingChecking, c.inRework, c.awaitingPacking, c.packedNotShipped].some((v) => v < 0))
check('no WIP bucket is negative', negative.length === 0)

/* Sewing is poured across the size rows and must never exceed what the line made. */
for (const facts of derived.orders) {
  const poured = facts.cells.reduce((a, c) => a + c.sewn, 0)
  if (facts.sewn > 0) {
    check(`sewing allocation for ${facts.order.orderNo} never exceeds the line's output`,
      poured <= facts.sewn + 0.001, `${poured} poured against ${facts.sewn} produced`)
  }
}

/* A process the workbook could not represent must now work. */
const rotary = buildRoute([
  { id: '1', orderNo: 'X', stepNo: 1, process: 'Cutting' },
  { id: '2', orderNo: 'X', stepNo: 2, process: 'Rotary AOP' },
  { id: '3', orderNo: 'X', stepNo: 3, process: 'Sewing' },
])
check('an unlisted outsourced process still routes', rotary.previousOf('Sewing') === 'Rotary AOP')
check('the first step is fed by the plan', rotary.previousOf('Cutting') === '')

/* A repeated process keeps its place in the sequence. */
const twice = buildRoute([
  { id: '1', orderNo: 'Y', stepNo: 1, process: 'Cutting' },
  { id: '2', orderNo: 'Y', stepNo: 2, process: 'Wash' },
  { id: '3', orderNo: 'Y', stepNo: 3, process: 'Sewing' },
  { id: '4', orderNo: 'Y', stepNo: 4, process: 'Wash' },
])
check('a process listed twice does not break the route', twice.previousOf('Wash') === 'Cutting')
check('the step after the first wash is sewing', twice.nextOf('Wash') === 'Sewing')

/* Alerts fire, and a waiver silences without deleting. */
check('the alerts engine produces findings', alerts.open.length > 0, `${alerts.open.length} open`)
check('every alert names a live order',
  alerts.open.every((a) => derived.byOrderNo.get(a.orderNo)?.order.status === 'Active'))
check('management waivers suppress rather than delete',
  alerts.suppressed.every((a) => a.suppressedUntil !== null))

const overCut = alerts.open.filter((a) => a.type === 'OVER-CUT')
check('an approved over-cut does not raise an alert',
  overCut.every((a) => {
    const facts = derived.byOrderNo.get(a.orderNo)!
    return facts.cells.some((c) => c.overCut > 0 && c.recutDecision !== 'Over Cut Approved')
  }))

/* Fabric consumption comes from the piece weights recorded at cutting. */
const weighed = derived.orders.filter((o) => o.fabric.consumedKg > 0)
check('fabric consumption is derived from cutting', weighed.length > 0, `${weighed.length} orders`)

console.log(failures === 0 ? '\nAll production checks passed.' : `\n${failures} check(s) failed.`)
process.exitCode = failures === 0 ? 0 : 1
