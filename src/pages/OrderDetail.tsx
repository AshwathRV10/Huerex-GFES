/**
 * One order, end to end: the master record, the route it travels, the size
 * breakdown, where its pieces are standing right now, and what it is worth.
 */
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Calculator, ChevronRight, GripVertical, Plus, Trash2, Waypoints,
} from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { LogTable, type FieldDef } from '../components/LogTable'
import { SmartCombo } from '../components/SmartCombo'
import { StatTile, Stat } from '../components/StatTile'
import {
  Badge, Button, Callout, Card, CardHeader, Empty, Field, Section, Segmented, Tooltip,
} from '../components/ui'
import { useComboStats } from '../hooks/useComboStats'
import { useCostSummary } from '../hooks/useCostSummary'
import { useDerived, useStore } from '../lib/store'
import { Gate, usePermission } from '../components/Gate'
import { resolveQuantities } from '../lib/engine/costing'
import { money, num, pct, shortDate } from '../lib/format'
import type { MatrixRow, Order, RouteStep } from '../lib/types'

type Tab = 'overview' | 'route' | 'sizes' | 'wip' | 'timeline'

export default function OrderDetail() {
  const { orderNo = '' } = useParams()
  const decoded = decodeURIComponent(orderNo)
  const navigate = useNavigate()
  const { derived, alerts } = useDerived()
  const cost = useCostSummary()
  const showCosting = usePermission('costing.view')
  const [tab, setTab] = useState<Tab>('overview')

  const facts = derived.byOrderNo.get(decoded)
  const buyers = useStore((s) => s.data.buyers)

  if (!facts) {
    return (
      <>
        <PageHeader title="Order not found" subtitle={`Nothing in the system is numbered ${decoded}.`} />
        <Button onClick={() => navigate('/orders')} icon={<ArrowLeft className="size-4" />}>Back to orders</Button>
      </>
    )
  }

  const { order } = facts
  const buyer = buyers.find((b) => b.name === order.buyer)
  const costing = cost.byOrder.get(order.orderNo)
  const result = costing?.actual ?? costing?.planned ?? null
  const quantities = resolveQuantities(order, buyer, costing?.costing ?? null)
  const orderAlerts = alerts.open.filter((a) => a.orderNo === order.orderNo)

  return (
    <>
      <PageHeader
        breadcrumb={
          <>
            <Link to="/orders" className="hover:text-ink transition-colors">Orders</Link>
            <ChevronRight className="size-3" />
            <span>{order.buyer}</span>
          </>
        }
        title={
          <span className="flex items-center gap-3 flex-wrap">
            {order.orderNo}
            <Badge tone={order.status === 'Active' ? 'ok' : order.status === 'On Hold' ? 'warn' : 'neutral'}>
              {order.status}
            </Badge>
            {facts.setupCheck !== 'OK' && <Badge tone="warn">{facts.setupIssues.length} setup issues</Badge>}
          </span>
        }
        subtitle={[order.styleCode, order.styleName].filter(Boolean).join(' · ')}
        actions={
          <Gate permission="costing.view">
            <Link to={`/costing/${encodeURIComponent(order.orderNo)}`}>
              <Button variant="primary" icon={<Calculator className="size-4" />}>
                {costing ? 'Open costing' : 'Cost this order'}
              </Button>
            </Link>
          </Gate>
        }
      />

      {/* Headline numbers */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
        <StatTile label="Order qty" value={num(order.orderQty)} caption="pcs booked" />
        {showCosting ? (
          <StatTile
            label="Will ship" value={num(quantities.shipped)}
            caption={quantities.excessQty > 0 ? `+${num(quantities.excessQty)} excess at ${pct(quantities.excessPct, 1)}` : 'no excess set'}
            tone={quantities.excessQty > 0 ? 'saffron' : 'neutral'}
          />
        ) : (
          <StatTile label="Size rows" value={num(facts.cells.length)} caption="colour and size combinations" />
        )}
        <StatTile label="Cut" value={num(facts.cumCut)} meter={{ value: facts.cumCut, max: order.orderQty || 1 }} />
        <StatTile label="Shipped" value={num(facts.cumShipped)} tone="ok" meter={{ value: facts.cumShipped, max: order.orderQty || 1 }} />
        <StatTile label="WIP" value={num(facts.totalWip)} tone={facts.agedWip ? 'warn' : 'brand'} caption={facts.agedWip ? `${num(facts.agedWip)} aged` : 'on the floor'} />
        {showCosting ? (
          <StatTile
            label="Margin"
            value={result?.marginPct != null ? pct(result.marginPct, 1) : '—'}
            caption={result && result.totalCost > 0 ? `${money(result.costPerShippedPc, result.currency)} a piece` : 'not costed yet'}
            tone={!result || result.sellingPrice == null ? 'neutral' : result.margin < 0 ? 'risk' : (result.marginPct ?? 0) < 0.08 ? 'warn' : 'ok'}
            to={`/costing/${encodeURIComponent(order.orderNo)}`}
          />
        ) : (
          <StatTile label="Rejected" value={num(facts.cumReject)} caption="pcs failed at checking"
            tone={facts.cumReject ? 'risk' : 'neutral'} />
        )}
      </div>

      {orderAlerts.length > 0 && (
        <Card className="mb-5 overflow-hidden">
          <CardHeader title={`${orderAlerts.length} thing${orderAlerts.length > 1 ? 's' : ''} to deal with`} />
          <div className="divide-y divide-line">
            {orderAlerts.map((alert) => (
              <div key={alert.id} className="flex items-start gap-3 px-4 py-2.5">
                <Badge tone={alert.severity === 'HIGH' ? 'risk' : 'warn'}>{alert.type}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink-2 leading-snug">{alert.message}</p>
                  <p className="text-xs text-ink-3 mt-0.5">{alert.action}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Segmented
        value={tab}
        onChange={setTab}
        className="mb-4"
        options={[
          { value: 'overview', label: 'Overview' },
          { value: 'route', label: `Route · ${facts.route.processes.length}` },
          { value: 'sizes', label: `Sizes · ${facts.cells.length}` },
          { value: 'wip', label: 'WIP' },
          { value: 'timeline', label: 'Timeline' },
        ]}
      />

      {tab === 'overview' && <Overview facts={facts} />}
      {tab === 'route' && <RouteEditor orderNo={order.orderNo} />}
      {tab === 'sizes' && <SizeMatrix orderNo={order.orderNo} order={order} />}
      {tab === 'wip' && <WipView facts={facts} />}
      {tab === 'timeline' && <TimelineView facts={facts} />}
    </>
  )
}

/* ── Overview ────────────────────────────────────────────────────────── */

function Overview({ facts }: { facts: NonNullable<ReturnType<typeof useDerived>['derived']['byOrderNo'] extends Map<string, infer V> ? V : never> }) {
  const patch = useStore((s) => s.patch)
  const settings = useStore((s) => s.settings)
  const teamStats = useComboStats('team')
  const { order } = facts

  const set = <K extends keyof Order>(key: K, value: Order[K]) =>
    patch('orders', order.id, { [key]: value } as never)

  return (
    <div className="grid xl:grid-cols-[1.4fr_1fr] gap-5 items-start">
      <Card>
        <CardHeader title="The master record" subtitle="Change anything here and every derived figure follows." />
        <div className="p-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <SmartCombo
            label="Buyer" list="buyers" value={order.buyer}
            onChange={(v) => set('buyer', v)}
          />
          <SmartCombo
            label="Style code" list="styles" value={order.styleCode}
            onChange={(v) => set('styleCode', v)}
          />
          <Field
            label="Style description" defaultValue={order.styleName}
            onBlur={(e) => set('styleName', e.target.value)}
          />
          <Field
            label="Order qty" defaultValue={order.orderQty} inputMode="numeric" suffix="pcs"
            onBlur={(e) => set('orderQty', Number(e.target.value) || 0)}
          />
          <Field
            label="Order date" type="date" defaultValue={order.orderDate}
            onBlur={(e) => set('orderDate', e.target.value)}
          />
          <Field
            label="Ex-factory date" type="date" defaultValue={order.exFactoryDate}
            onBlur={(e) => set('exFactoryDate', e.target.value)}
          />
          <Field
            label="Sew complete by" type="date" defaultValue={order.sewCompleteBy}
            hint="Blank falls back to ex-factory"
            onBlur={(e) => set('sewCompleteBy', e.target.value)}
          />
          <Field
            label="SAM" defaultValue={order.sam || ''} inputMode="decimal" suffix="min"
            onBlur={(e) => set('sam', Number(e.target.value) || 0)}
          />
          <Field
            label="Cutting buffer" defaultValue={(order.bufferPct * 100) || ''} inputMode="decimal" suffix="%"
            onBlur={(e) => set('bufferPct', (Number(e.target.value) || 0) / 100)}
          />
          <SmartCombo label="Merchandiser" list="team" stats={teamStats} value={order.merchandiser} onChange={(v) => set('merchandiser', v)} />
          <SmartCombo label="Planner" list="team" stats={teamStats} value={order.planner} onChange={(v) => set('planner', v)} />
          <SmartCombo
            label="Status" options={['Active', 'On Hold', 'Closed', 'Cancelled']} allowCreate={false}
            value={order.status} onChange={(v) => set('status', v)}
          />
          <Field
            label="Fabric lead" defaultValue={order.fabricLeadDays ?? ''} inputMode="numeric" suffix="days"
            hint={`Blank uses ${settings.defaultFabricLeadDays} days`}
            onBlur={(e) => set('fabricLeadDays', e.target.value === '' ? null : Number(e.target.value))}
          />
          <Field
            label="Set group" defaultValue={order.setGroup} placeholder="SET-005"
            hint="Two orders that must ship together"
            onBlur={(e) => set('setGroup', e.target.value)}
          />
          <SmartCombo
            label="Set role" options={['Primary', 'Secondary']} allowCreate={false}
            value={order.setRole} onChange={(v) => set('setRole', v)}
          />
        </div>
      </Card>

      <div className="space-y-5">
        <Card>
          <CardHeader title="Where it stands" />
          <div className="px-4 pb-3 pt-1">
            <Stat label="Size breakdown" value={num(facts.matrixQty)} tone={facts.variance === 0 ? 'ok' : 'risk'} />
            <Stat label="Variance against order" value={facts.variance === 0 ? '0' : `${facts.variance > 0 ? '+' : '−'}${num(Math.abs(facts.variance))}`} tone={facts.variance === 0 ? 'ok' : 'risk'} />
            <Stat label="Cut" value={num(facts.cumCut)} />
            <Stat label="Sewn" value={num(facts.sewn)} />
            <Stat label="Checked" value={num(facts.cumChecked)} />
            <Stat label="Net good" value={num(facts.netGood)} tone="ok" />
            <Stat label="Rejected" value={num(facts.cumReject)} tone={facts.cumReject ? 'risk' : 'neutral'} />
            <Stat label="Packed" value={num(facts.cumPacked)} />
            <Stat label="Shipped" value={num(facts.cumShipped)} emphasis tone="ok" />
            <div className="mt-3 pt-3 border-t border-line">
              <Stat
                label="Cut = shipped + rejected + WIP"
                value={facts.reconciliation.balanced ? 'Balanced' : `Out by ${num(Math.abs(facts.reconciliation.difference))}`}
                tone={facts.reconciliation.balanced ? 'ok' : 'risk'}
              />
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Fabric" subtitle="Kilograms, and what happened to them" />
          <div className="px-4 pb-3 pt-1">
            <Stat label="Received" value={`${num(facts.fabric.receivedKg, 1)} kg`} />
            <Stat label="Issued" value={`${num(facts.fabric.issuedKg, 1)} kg`} />
            <Stat label="Returned" value={`${num(facts.fabric.returnedKg, 1)} kg`} />
            <Stat label="Consumed" value={`${num(facts.fabric.consumedKg, 1)} kg`} />
            <Stat
              label="Unaccounted"
              value={facts.fabric.wastagePct != null
                ? `${num(facts.fabric.wastageKg, 1)} kg · ${pct(facts.fabric.wastagePct, 1)}`
                : '—'}
              tone={facts.fabric.wastagePct != null && facts.fabric.wastagePct > settings.fabricWastageThresholdPct ? 'warn' : 'neutral'}
            />
          </div>
        </Card>

        {facts.setupIssues.length > 0 && (
          <Callout tone="warn" title="Setup checklist">
            <ul className="space-y-1 mt-1">
              {facts.setupIssues.map((issue) => <li key={issue}>· {issue}</li>)}
            </ul>
          </Callout>
        )}
      </div>
    </div>
  )
}

/* ── Route ───────────────────────────────────────────────────────────── */

function RouteEditor({ orderNo }: { orderNo: string }) {
  const steps = useStore((s) => s.data.routeSteps.filter((r) => r.orderNo === orderNo))
  const processTypes = useStore((s) => s.processTypes)
  const add = useStore((s) => s.add)
  const drop = useStore((s) => s.drop)
  const patch = useStore((s) => s.patch)
  const [adding, setAdding] = useState('')

  const sorted = useMemo(() => [...steps].sort((a, b) => a.stepNo - b.stepNo), [steps])

  const move = (step: RouteStep, direction: -1 | 1) => {
    const index = sorted.findIndex((s) => s.id === step.id)
    const swap = sorted[index + direction]
    if (!swap) return
    patch('routeSteps', step.id, { stepNo: swap.stepNo })
    patch('routeSteps', swap.id, { stepNo: step.stepNo })
  }

  const append = async (process: string) => {
    if (!process) return
    const next = sorted.length ? Math.max(...sorted.map((s) => s.stepNo)) + 1 : 1
    await add('routeSteps', { orderNo, stepNo: next, process })
    setAdding('')
  }

  return (
    <div className="grid lg:grid-cols-[1fr_20rem] gap-5 items-start">
      <Card>
        <CardHeader
          title="The exact sequence this order travels"
          subtitle="Sewing before tie & dye, fusing after sewing, a process twice — all of it is allowed. The route is what makes every WIP bucket work."
          icon={<Waypoints className="size-4" />}
        />
        {sorted.length === 0 ? (
          <Empty
            title="No route set"
            detail="Nothing will calculate for this order until its steps are listed. Start with Cutting."
            icon={<Waypoints className="size-5" />}
          />
        ) : (
          <ol className="p-4 space-y-1.5">
            {sorted.map((step, index) => {
              const outsourced = (processTypes[step.process] ?? 'In-house') === 'Outsourced'
              return (
                <li key={step.id} className="flex items-center gap-2.5 group">
                  <span className="size-6 shrink-0 rounded-md bg-sunken border border-line grid place-items-center text-2xs font-semibold text-ink-3 num">
                    {index + 1}
                  </span>
                  <span className="flex-1 flex items-center gap-2 rounded-lg border border-line bg-raised/60 px-3 py-2 min-w-0">
                    <GripVertical className="size-3.5 text-ink-3/50 shrink-0" />
                    <span className="text-sm text-ink truncate">{step.process}</span>
                    <Badge tone={outsourced ? 'saffron' : 'neutral'} className="ml-auto shrink-0">
                      {outsourced ? 'vendor' : 'in-house'}
                    </Badge>
                  </span>
                  <span className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <Button size="sm" variant="quiet" onClick={() => move(step, -1)} disabled={index === 0} aria-label="Move up">↑</Button>
                    <Button size="sm" variant="quiet" onClick={() => move(step, 1)} disabled={index === sorted.length - 1} aria-label="Move down">↓</Button>
                    <Button size="sm" variant="quiet" className="hover:text-risk" onClick={() => drop('routeSteps', step.id)} aria-label="Remove step" icon={<Trash2 className="size-3.5" />} />
                  </span>
                </li>
              )
            })}
          </ol>
        )}
        <div className="px-4 pb-4 flex items-end gap-2">
          <SmartCombo
            className="flex-1 max-w-xs"
            label="Add a step"
            list="processes"
            value={adding}
            onChange={setAdding}
            placeholder="Cutting, Print, Sewing…"
          />
          <Button variant="primary" onClick={() => append(adding)} disabled={!adding} icon={<Plus className="size-4" />}>
            Add
          </Button>
        </div>
      </Card>

      <Card className="p-4 text-sm text-ink-2 leading-relaxed space-y-3">
        <p className="font-medium text-ink">Why the sequence matters</p>
        <p>
          Every WIP bucket is filled by what the step before it finished. Put printing after sewing and the
          pieces waiting to print are the sewn ones; put it before and they are the cut ones.
        </p>
        <p>
          A process listed here but never logged shows as pieces waiting, which is exactly right — that is
          work somebody still owes you.
        </p>
        <p className="text-ink-3">
          In-house steps are logged on their own pages. Vendor steps all go through Job work.
        </p>
      </Card>
    </div>
  )
}

/* ── Size matrix ─────────────────────────────────────────────────────── */

function SizeMatrix({ orderNo, order }: { orderNo: string; order: Order }) {
  const rows = useStore((s) => s.data.matrix.filter((r) => r.orderNo === orderNo))
  const { derived } = useDerived()
  const facts = derived.byOrderNo.get(orderNo)

  const fields: FieldDef<MatrixRow>[] = useMemo(() => [
    {
      kind: 'combo', key: 'orderNo', header: 'Order', width: '8rem', required: true,
      options: [orderNo], allowCreate: false,
    },
    { kind: 'combo', key: 'colour', header: 'Colour', width: '11rem', required: true, list: 'colours' },
    { kind: 'combo', key: 'size', header: 'Size', width: '7.5rem', required: true, list: 'sizes' },
    { kind: 'number', key: 'orderQty', header: 'Order qty', width: '7rem', required: true },
    {
      kind: 'combo', key: 'recutDecision', header: 'Recut decision', width: '11rem',
      allowCreate: false,
      options: ['', 'Recut Required', 'Recut Done', 'Ship Short Approved', 'Over Cut Approved', 'Not Required'],
    },
  ], [orderNo])

  const cellByKey = useMemo(() => {
    const map = new Map<string, (typeof derived.cells)[number]>()
    for (const cell of derived.cells) map.set(cell.id, cell)
    return map
  }, [derived])

  const total = rows.reduce((a, b) => a + b.orderQty, 0)
  const variance = total - order.orderQty

  return (
    <>
      {variance !== 0 && (
        <Callout tone="risk" title={`The size breakdown is ${variance > 0 ? 'over' : 'under'} by ${num(Math.abs(variance))} pcs`}>
          It must add up to the order quantity of {num(order.orderQty)}. Until it does, planned cut, WIP and
          the reconciliation will all be wrong.
        </Callout>
      )}

      <Section
        title="Colour × size breakdown"
        description="Planned cut adds the order's cutting buffer to each row."
        className="mt-4"
        actions={
          <span className="text-sm text-ink-3">
            <span className="num text-ink font-medium">{num(total)}</span> of {num(order.orderQty)} pcs
          </span>
        }
      >
        <LogTable<MatrixRow>
          collection="matrix"
          rows={rows}
          fields={fields}
          derived={[
            {
              key: 'planned', header: 'Planned cut', align: 'right', width: '7rem',
              render: (row) => num(cellByKey.get(row.id)?.plannedCut),
            },
            { key: 'cut', header: 'Cut', align: 'right', width: '6rem', render: (row) => num(cellByKey.get(row.id)?.cumCut) },
            { key: 'good', header: 'Good', align: 'right', width: '6rem', render: (row) => num(cellByKey.get(row.id)?.netGood) },
            { key: 'packed', header: 'Packed', align: 'right', width: '6rem', render: (row) => num(cellByKey.get(row.id)?.cumPacked) },
            { key: 'shipped', header: 'Shipped', align: 'right', width: '6rem', render: (row) => num(cellByKey.get(row.id)?.cumShipped) },
            {
              key: 'status', header: 'Status', width: '15rem',
              render: (row) => {
                const cell = cellByKey.get(row.id)
                if (!cell) return null
                const tone = cell.status.startsWith('Over-cut') ? 'warn'
                  : cell.status.startsWith('Short') ? 'risk'
                  : cell.status.includes('complete') ? 'ok' : 'neutral'
                return <Badge tone={tone}>{cell.status}</Badge>
              },
            },
          ]}
          validate={(draft) => {
            if (!draft.colour) return 'Colour is required'
            if (!draft.size) return 'Size is required'
            if (!draft.orderQty) return 'Order qty is required'
            if (rows.some((r) => r.colour === draft.colour && r.size === draft.size)) {
              return `${draft.colour} / ${draft.size} is already in the breakdown`
            }
            return null
          }}
          blank={() => ({ orderNo, colour: '', size: '', orderQty: 0, recutDecision: '' })}
          sortBy={(a, b) => a.colour.localeCompare(b.colour) || a.size.localeCompare(b.size)}
          rowTone={(row) => {
            const cell = cellByKey.get(row.id)
            if (!cell) return null
            if (cell.overCut > 0 && cell.recutDecision !== 'Over Cut Approved') return 'warn'
            if (cell.shortBy > 0 && cell.cumCut > 0) return 'risk'
            return null
          }}
          emptyTitle="No size breakdown yet"
          emptyDetail="Every colour and size this order will be made in, with its quantity. It must add up to the order quantity."
        />
      </Section>

      {facts && facts.cells.length > 0 && (
        <p className="mt-3 text-xs text-ink-3">
          {facts.cells.length} colour and size combinations · planned cut{' '}
          {num(facts.cells.reduce((a, b) => a + b.plannedCut, 0))} pcs at a {pct(order.bufferPct, 0)} buffer
        </p>
      )}
    </>
  )
}

/* ── WIP ─────────────────────────────────────────────────────────────── */

function WipView({ facts }: { facts: NonNullable<ReturnType<typeof useDerived>['derived']['orders'][number]> }) {
  const running = facts.cells.filter((c) => c.totalWip > 0)

  if (running.length === 0) {
    return (
      <Card>
        <Empty
          title="Nothing running"
          detail={facts.cumCut === 0 ? 'This order has not been cut yet.' : 'Everything cut has been shipped or rejected.'}
        />
      </Card>
    )
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader title="Every running piece" subtitle="By colour and size, and what it is waiting for" />
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead className="sticky-head">
            <tr className="text-2xs font-semibold uppercase tracking-[0.06em] text-ink-3">
              <th className="text-left px-3 py-2">Colour</th>
              <th className="text-left px-3 py-2">Size</th>
              <th className="text-right px-3 py-2">Fusing</th>
              <th className="text-right px-3 py-2">To vendor</th>
              <th className="text-right px-3 py-2">At vendor</th>
              <th className="text-right px-3 py-2">To sew</th>
              <th className="text-right px-3 py-2">Sewing</th>
              <th className="text-right px-3 py-2">To check</th>
              <th className="text-right px-3 py-2">Rework</th>
              <th className="text-right px-3 py-2">To pack</th>
              <th className="text-right px-3 py-2">To ship</th>
              <th className="text-right px-3 py-2">Total</th>
              <th className="text-left px-3 py-2">Where it is now</th>
              <th className="text-right px-3 py-2">Idle</th>
            </tr>
          </thead>
          <tbody>
            {running.map((cell) => (
              <tr key={cell.id} className="border-b border-line/70 last:border-0 grid-row-hover">
                <td className="px-3 py-1.5 text-sm">{cell.colour}</td>
                <td className="px-3 py-1.5 text-sm text-ink-2">{cell.size}</td>
                <Cell value={cell.awaitingFusing} />
                <Cell value={cell.awaitingJobWork} />
                <Cell value={cell.atJobWorkVendor} tone="warn" />
                <Cell value={cell.readyForSewing} />
                <Cell value={cell.inSewing} />
                <Cell value={cell.awaitingChecking} />
                <Cell value={cell.inRework} tone="warn" />
                <Cell value={cell.awaitingPacking} />
                <Cell value={cell.packedNotShipped} />
                <td className="px-3 py-1.5 text-right num text-sm font-semibold">{num(cell.totalWip)}</td>
                <td className="px-3 py-1.5 text-sm text-ink-2">{cell.whereNow}</td>
                <td className="px-3 py-1.5 text-right">
                  {cell.ageingDays != null && (
                    <Badge tone={cell.flag === 'AGED' ? 'risk' : cell.flag === 'WATCH' ? 'warn' : 'neutral'}>
                      {cell.ageingDays}d
                    </Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function Cell({ value, tone }: { value: number; tone?: 'warn' }) {
  return (
    <td className="px-3 py-1.5 text-right num text-sm">
      {value > 0
        ? <span className={tone === 'warn' ? 'text-warn' : ''}>{num(value)}</span>
        : <span className="text-ink-3/40">·</span>}
    </td>
  )
}

/* ── Timeline ────────────────────────────────────────────────────────── */

function TimelineView({ facts }: { facts: NonNullable<ReturnType<typeof useDerived>['derived']['orders'][number]> }) {
  const { timeline } = facts
  const milestones = [
    { label: 'Order placed', date: timeline.orderDate },
    { label: 'Fabric in', date: timeline.fabricIn, duration: timeline.fabricLeadTime, durationLabel: 'lead time' },
    { label: 'Cutting started', date: timeline.cutStart },
    { label: 'Cutting finished', date: timeline.cutEnd, duration: timeline.cuttingDuration, durationLabel: 'cutting' },
    { label: 'Sent to job work', date: timeline.jobWorkOut },
    { label: 'Back from job work', date: timeline.jobWorkIn, duration: timeline.jobWorkTurnaround, durationLabel: 'turnaround' },
    { label: 'Sewing started', date: timeline.sewStart },
    { label: 'Sewing finished', date: timeline.sewEnd, duration: timeline.sewingDuration, durationLabel: 'sewing' },
    { label: 'Packing started', date: timeline.packStart },
    { label: 'Packing finished', date: timeline.packEnd, duration: timeline.packingDuration, durationLabel: 'packing' },
    { label: 'Inspection', date: timeline.inspection },
    { label: 'First dispatch', date: timeline.firstDispatch },
    { label: 'Last dispatch', date: timeline.lastDispatch, duration: timeline.dispatchSpread, durationLabel: 'dispatch spread' },
  ]

  return (
    <div className="grid lg:grid-cols-[1fr_20rem] gap-5 items-start">
      <Card>
        <CardHeader
          title="Milestones"
          subtitle="Every date here is derived from a transaction — nothing is typed twice."
        />
        <ol className="p-4 pl-5">
          {milestones.map((milestone, index) => {
            const reached = Boolean(milestone.date)
            return (
              <li key={milestone.label} className="relative pl-6 pb-4 last:pb-0">
                {index < milestones.length - 1 && (
                  <span className={`absolute left-[5px] top-3 bottom-0 w-px ${reached ? 'bg-brand-500/40' : 'bg-line'}`} />
                )}
                <span
                  className={`absolute left-0 top-1.5 size-[11px] rounded-full border-2 ${
                    reached ? 'bg-brand-500 border-brand-500' : 'bg-surface border-line-strong'
                  }`}
                />
                <div className="flex items-baseline justify-between gap-3">
                  <span className={`text-sm ${reached ? 'text-ink' : 'text-ink-3'}`}>{milestone.label}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    {milestone.duration != null && reached && (
                      <Tooltip label={`${milestone.durationLabel}: ${milestone.duration} days`}>
                        <Badge tone="neutral">{milestone.duration}d</Badge>
                      </Tooltip>
                    )}
                    <span className="text-sm num text-ink-2">{shortDate(milestone.date)}</span>
                  </span>
                </div>
              </li>
            )
          })}
        </ol>
      </Card>

      <Card>
        <CardHeader title="Cycle time" />
        <div className="px-4 pb-3 pt-1">
          <Stat label="Ex-factory date" value={shortDate(timeline.exFactory)} />
          <Stat
            label="Total cycle time"
            value={timeline.totalCycleTime != null ? `${timeline.totalCycleTime} days` : '—'}
            emphasis
            hint={timeline.closed ? 'Frozen — the order has shipped' : 'Still running'}
          />
          <Stat
            label={timeline.closed ? 'Delivered' : 'Against ex-factory'}
            value={timeline.delayDays == null ? '—' : timeline.delayDays > 0 ? `${timeline.delayDays} days late` : `${-timeline.delayDays} days early`}
            tone={timeline.delayDays == null ? 'neutral' : timeline.delayDays > 0 ? 'risk' : 'ok'}
          />
          <div className="mt-3 pt-3 border-t border-line space-y-1">
            <p className="text-2xs uppercase tracking-[0.07em] text-ink-3 font-semibold mb-2">Stage durations</p>
            <Stat label="Fabric lead" value={dur(timeline.fabricLeadTime)} />
            <Stat label="Cutting" value={dur(timeline.cuttingDuration)} />
            <Stat label="Job work" value={dur(timeline.jobWorkTurnaround)} />
            <Stat label="Sewing" value={dur(timeline.sewingDuration)} />
            <Stat label="Packing" value={dur(timeline.packingDuration)} />
            <Stat label="Dispatch spread" value={dur(timeline.dispatchSpread)} />
          </div>
        </div>
      </Card>
    </div>
  )
}

const dur = (days: number | null) => (days == null ? '—' : `${days} days`)
