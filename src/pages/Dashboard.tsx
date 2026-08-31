/**
 * The dashboard: what the factory is running, what it is worth, and what needs
 * a decision today. Everything here is derived — there is nothing to type.
 */
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  Cell, Pie, PieChart, ResponsiveContainer, Tooltip as ReTooltip,
} from 'recharts'
import {
  AlertTriangle, ArrowRight, Boxes, Calculator, CircleDollarSign, Clock,
  Container, Factory, Package, Scissors, ShieldCheck, Shirt,
} from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { StatTile, Stat } from '../components/StatTile'
import { Badge, Button, Card, CardHeader, Empty, Meter, Section, Tooltip } from '../components/ui'
import { useDerived, useStore } from '../lib/store'
import { useCostSummary } from '../hooks/useCostSummary'
import { money, moneyShort, num, pct, shortDate } from '../lib/format'
import type { Alert } from '../lib/engine/alerts'

export default function Dashboard() {
  const { derived, alerts } = useDerived()
  const cost = useCostSummary()
  const orders = useStore((s) => s.data.orders)
  const { totals } = derived

  const live = derived.orders.filter((o) => o.order.status === 'Active')
  const overdue = live.filter((o) => (o.daysToExFactory ?? 1) < 0 && o.cumShipped < o.order.orderQty)
  const closed = derived.orders.filter((o) => o.timeline.closed)
  const onTime = closed.filter((o) => (o.timeline.delayDays ?? 0) <= 0)
  const outOfBalance = derived.orders.filter((o) => !o.reconciliation.balanced && o.cumCut > 0)

  const currency = cost.totals.currency

  return (
    <>
      <PageHeader
        title="Factory control"
        subtitle="Live orders only. One row per transaction, one truth per number — if a figure looks wrong, the entry behind it is wrong."
        actions={
          <>
            <Link to="/costing"><Button icon={<Calculator className="size-4" />}>Costing</Button></Link>
            <Link to="/orders"><Button variant="primary" icon={<Shirt className="size-4" />}>Orders</Button></Link>
          </>
        }
      />

      {/* ── Production ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-3">
        <StatTile
          label="Live orders" value={num(totals.liveOrders)} caption="active on the floor"
          icon={<Factory className="size-4" />} to="/orders"
        />
        <StatTile label="Order qty" value={num(totals.orderQty)} caption="pcs committed" icon={<Boxes className="size-4" />} />
        <StatTile
          label="Cut" value={num(totals.cut)} caption="pcs in the system" icon={<Scissors className="size-4" />}
          to="/cutting" meter={{ value: totals.cut, max: totals.orderQty }}
        />
        <StatTile
          label="Sewn" value={num(totals.sewn)} caption="pcs off the line" icon={<Factory className="size-4" />}
          to="/sewing" meter={{ value: totals.sewn, max: totals.orderQty }}
        />
        <StatTile
          label="Packed" value={num(totals.packed)} caption="pcs in cartons" icon={<Package className="size-4" />}
          to="/packing" meter={{ value: totals.packed, max: totals.orderQty }}
        />
        <StatTile
          label="Shipped" value={num(totals.shipped)} caption="pcs out the gate" icon={<Container className="size-4" />}
          to="/shipment" tone="ok" meter={{ value: totals.shipped, max: totals.orderQty }}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
        <StatTile label="WIP on floor" value={num(totals.wip)} caption="cut, not yet shipped" to="/wip" tone="brand" />
        <StatTile
          label="Aged WIP" value={num(totals.agedWip)} caption="stalled 14 days or more"
          tone={totals.agedWip > 0 ? 'warn' : 'neutral'} to="/wip"
        />
        <StatTile
          label="Open alerts" value={num(alerts.open.length)} caption="things asking for you"
          tone={alerts.open.some((a) => a.severity === 'HIGH') ? 'risk' : 'neutral'} to="/alerts"
          icon={<AlertTriangle className="size-4" />}
        />
        <StatTile
          label="Under approval" value={num(alerts.suppressed.length)} caption="accepted by management"
          tone={alerts.suppressed.length ? 'info' : 'neutral'} to="/alerts"
          icon={<ShieldCheck className="size-4" />}
        />
        <StatTile
          label="Overdue" value={num(overdue.length)} caption="orders past ex-factory"
          tone={overdue.length ? 'risk' : 'ok'} icon={<Clock className="size-4" />}
        />
        <StatTile
          label="On time" value={closed.length ? pct(onTime.length / closed.length, 0) : '—'}
          caption={closed.length ? `of ${closed.length} closed orders` : 'nothing closed yet'}
          tone="ok" to="/timeline"
        />
      </div>

      {/* ── Commercial ─────────────────────────────────────────────── */}
      <Section
        title="The money"
        description="Every costed order priced against the quote. Orders without a costing are not in these figures."
        actions={<Link to="/costing"><Button size="sm" variant="ghost">Open costing<ArrowRight className="size-3.5" /></Button></Link>}
        className="mb-6"
      >
        <div className="grid lg:grid-cols-[1fr_1fr_1fr_1.2fr] gap-3">
          <StatTile
            label="Order value" value={moneyShort(cost.totals.revenue, currency)}
            caption={`${cost.costedOrders.length} of ${orders.length} orders costed`}
            icon={<CircleDollarSign className="size-4" />}
          />
          <StatTile
            label="Cost to make" value={moneyShort(cost.totals.cost, currency)}
            caption="fabric, trims, job work, CMT and overheads"
          />
          <StatTile
            label="Margin"
            value={moneyShort(cost.totals.margin, currency)}
            caption={cost.totals.marginPct != null ? `${pct(cost.totals.marginPct)} of order value` : 'quote a price to see this'}
            tone={cost.totals.margin < 0 ? 'risk' : cost.totals.marginPct != null && cost.totals.marginPct < 0.08 ? 'warn' : 'ok'}
          />
          <Card className="p-4">
            <p className="text-2xs font-semibold uppercase tracking-[0.07em] text-ink-3 mb-2">Watch list</p>
            <Stat
              label="Losing money" value={num(cost.totals.loseMoney)}
              tone={cost.totals.loseMoney ? 'risk' : 'ok'}
            />
            <Stat
              label="Margin under 8%" value={num(cost.totals.thin)}
              tone={cost.totals.thin ? 'warn' : 'ok'}
            />
            <Stat
              label="Not costed yet" value={num(cost.uncostedOrders.length)}
              tone={cost.uncostedOrders.length ? 'warn' : 'ok'}
            />
            <Stat
              label="Free excess given away" value={moneyShort(cost.totals.excessGiveaway, currency)}
              tone={cost.totals.excessGiveaway > 0 ? 'warn' : 'neutral'}
              hint="Excess pieces shipped that the buyer is not invoiced for"
            />
          </Card>
        </div>
      </Section>

      <div className="grid xl:grid-cols-[1.55fr_1fr] gap-5 items-start">
        {/* ── What needs me today ──────────────────────────────────── */}
        <Card className="overflow-hidden">
          <CardHeader
            title="What needs me today"
            subtitle={
              alerts.open.length
                ? `${alerts.open.filter((a) => a.severity === 'HIGH').length} high, ${alerts.open.filter((a) => a.severity === 'MEDIUM').length} medium`
                : 'Nothing is asking for a decision'
            }
            icon={<AlertTriangle className="size-4" />}
            actions={
              alerts.open.length > 8
                ? <Link to="/alerts"><Button size="sm" variant="ghost">See all {alerts.open.length}</Button></Link>
                : undefined
            }
          />
          {alerts.open.length === 0 ? (
            <Empty
              icon={<ShieldCheck className="size-5" />}
              title="Nothing needs you right now"
              detail="Every order is inside its dates, nothing is stalled, and the buyer owes you nothing. This is what a clean floor looks like."
            />
          ) : (
            <div className="divide-y divide-line">
              {alerts.open.slice(0, 8).map((alert) => <AlertRow key={alert.id} alert={alert} />)}
            </div>
          )}
        </Card>

        <div className="space-y-5">
          {/* ── Where the WIP is ───────────────────────────────────── */}
          <WipBreakdown />

          {/* ── Reconciliation ─────────────────────────────────────── */}
          <Card>
            <CardHeader
              title="Cut = Shipped + Rejected + WIP"
              subtitle="The identity that must always hold"
              actions={<Link to="/reconciliation"><Button size="sm" variant="ghost">Detail</Button></Link>}
            />
            <div className="p-4">
              {outOfBalance.length === 0 ? (
                <div className="flex items-center gap-2.5 text-sm">
                  <span className="size-8 rounded-lg bg-ok/12 text-ok grid place-items-center shrink-0">
                    <ShieldCheck className="size-4" />
                  </span>
                  <span className="text-ink-2">
                    Every cut piece is accounted for across{' '}
                    <span className="text-ink font-medium">{derived.orders.filter((o) => o.cumCut > 0).length} orders</span>.
                  </span>
                </div>
              ) : (
                <div className="space-y-2">
                  {outOfBalance.slice(0, 4).map((facts) => (
                    <Link
                      key={facts.order.orderNo}
                      to={`/orders/${encodeURIComponent(facts.order.orderNo)}`}
                      className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 hover:bg-risk/[0.06] transition-colors"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-ink">{facts.order.orderNo}</span>
                        <span className="block text-xs text-ink-3 truncate">{facts.reconciliation.verdict}</span>
                      </span>
                      <Badge tone="risk">{facts.reconciliation.difference > 0 ? '+' : '−'}{num(Math.abs(facts.reconciliation.difference))}</Badge>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* ── Order health ───────────────────────────────────────────── */}
      <Section
        title="Order health"
        description="How far each live order has travelled, and what it is worth."
        className="mt-6"
      >
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="sticky-head">
                <tr className="text-2xs font-semibold uppercase tracking-[0.06em] text-ink-3">
                  <th className="text-left px-3 py-2">Order</th>
                  <th className="text-left px-3 py-2 hidden md:table-cell">Buyer</th>
                  <th className="text-right px-3 py-2">Qty</th>
                  <th className="text-left px-3 py-2 w-56">Progress</th>
                  <th className="text-right px-3 py-2 hidden lg:table-cell">WIP</th>
                  <th className="text-right px-3 py-2 hidden lg:table-cell">Ex-factory</th>
                  <th className="text-right px-3 py-2">Cost / pc</th>
                  <th className="text-right px-3 py-2">Margin</th>
                </tr>
              </thead>
              <tbody>
                {live.map((facts) => {
                  const costing = cost.byOrder.get(facts.order.orderNo)
                  const result = costing?.actual ?? costing?.planned ?? null
                  const late = (facts.daysToExFactory ?? 1) < 0
                  return (
                    <tr key={facts.order.orderNo} className="border-b border-line/70 last:border-0 grid-row-hover">
                      <td className="px-3 py-2">
                        <Link
                          to={`/orders/${encodeURIComponent(facts.order.orderNo)}`}
                          className="text-sm font-medium text-ink hover:text-brand-600 transition-colors"
                        >
                          {facts.order.orderNo}
                        </Link>
                        <span className="block text-2xs text-ink-3 truncate max-w-[16rem]">
                          {facts.order.styleName || facts.order.styleCode}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-sm text-ink-2 hidden md:table-cell truncate max-w-[12rem]">
                        {facts.order.buyer}
                      </td>
                      <td className="px-3 py-2 text-right num text-sm">{num(facts.order.orderQty)}</td>
                      <td className="px-3 py-2">
                        <ProgressTrack facts={facts} />
                      </td>
                      <td className="px-3 py-2 text-right num text-sm hidden lg:table-cell">
                        {facts.totalWip > 0
                          ? <span className={facts.agedWip > 0 ? 'text-warn' : ''}>{num(facts.totalWip)}</span>
                          : <span className="text-ink-3/50">·</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-sm hidden lg:table-cell">
                        <span className={late ? 'text-risk font-medium' : 'text-ink-2'}>
                          {shortDate(facts.order.exFactoryDate)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right num text-sm">
                        {result && result.totalCost > 0
                          ? money(result.costPerShippedPc, result.currency)
                          : <Link to={`/costing/${encodeURIComponent(facts.order.orderNo)}`} className="text-brand-600 hover:underline text-xs">cost it</Link>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {result && result.sellingPrice != null && result.totalCost > 0 ? (
                          <Tooltip label={`${money(result.margin, result.currency)} on ${num(result.quantities.invoiced)} invoiced pcs`}>
                            <Badge tone={result.margin < 0 ? 'risk' : (result.marginPct ?? 0) < 0.08 ? 'warn' : 'ok'}>
                              {result.marginPct != null ? pct(result.marginPct, 1) : '—'}
                            </Badge>
                          </Tooltip>
                        ) : (
                          <span className="text-ink-3/60 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {live.length === 0 && <Empty title="No live orders" detail="Mark an order Active to see it here." />}
        </Card>
      </Section>
    </>
  )
}

/* ── Pieces ──────────────────────────────────────────────────────────── */

function AlertRow({ alert }: { alert: Alert }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 hover:bg-ink/[0.02] transition-colors">
      <span
        className={`mt-1 size-1.5 rounded-full shrink-0 ${
          alert.severity === 'HIGH' ? 'bg-risk' : alert.severity === 'MEDIUM' ? 'bg-warn' : 'bg-info'
        }`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            to={`/orders/${encodeURIComponent(alert.orderNo)}`}
            className="text-sm font-medium text-ink hover:text-brand-600 transition-colors"
          >
            {alert.orderNo}
          </Link>
          <Badge tone={alert.severity === 'HIGH' ? 'risk' : 'warn'}>{alert.type}</Badge>
          <span className="text-2xs text-ink-3">{alert.buyer}</span>
        </div>
        <p className="text-sm text-ink-2 mt-1 leading-snug">{alert.message}</p>
        <p className="text-xs text-ink-3 mt-1 leading-snug">{alert.action}</p>
      </div>
      <span className="text-2xs text-ink-3 shrink-0 text-right">
        {alert.owner}
        {alert.days > 0 && <span className="block num mt-0.5">{alert.days}d</span>}
      </span>
    </div>
  )
}

function ProgressTrack({ facts }: { facts: ReturnType<typeof useDerived>['derived']['orders'][number] }) {
  const target = facts.order.orderQty || 1
  const stages = facts.progress.filter((p) => p.label !== 'Inspection')
  if (stages.length === 0) {
    return <span className="text-2xs text-ink-3">no route set</span>
  }
  return (
    <div className="flex items-center gap-[3px]">
      {stages.map((stage) => {
        const fraction = Math.min(1, stage.done / target)
        return (
          <Tooltip key={stage.label} label={`${stage.label}: ${num(stage.done)} of ${num(target)}`}>
            <span className="flex-1 min-w-[10px] block">
              <Meter
                value={stage.done}
                max={target}
                height="h-2"
                tone={fraction >= 1 ? 'ok' : fraction > 0 ? 'brand' : 'neutral'}
              />
            </span>
          </Tooltip>
        )
      })}
    </div>
  )
}

const WIP_COLOURS = ['#5B5BD6', '#7C7CF0', '#C87C16', '#0D8A6A', '#2060D0', '#8A8378', '#C62828']

function WipBreakdown() {
  const { derived } = useDerived()

  const data = useMemo(() => {
    const live = derived.cells.filter((c) => c.live && c.totalWip > 0)
    const totals = {
      'Awaiting fusing': 0, 'Awaiting job work': 0, 'At vendor': 0, 'Ready for sewing': 0,
      'In sewing': 0, 'Awaiting checking': 0, 'In rework': 0, 'Awaiting packing': 0, 'Packed, not shipped': 0,
    }
    for (const cell of live) {
      totals['Awaiting fusing'] += cell.awaitingFusing
      totals['Awaiting job work'] += cell.awaitingJobWork
      totals['At vendor'] += cell.atJobWorkVendor
      totals['Ready for sewing'] += cell.readyForSewing
      totals['In sewing'] += cell.inSewing
      totals['Awaiting checking'] += cell.awaitingChecking
      totals['In rework'] += cell.inRework
      totals['Awaiting packing'] += cell.awaitingPacking
      totals['Packed, not shipped'] += cell.packedNotShipped
    }
    return Object.entries(totals)
      .filter(([, value]) => value > 0)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  }, [derived])

  const total = data.reduce((a, b) => a + b.value, 0)

  return (
    <Card>
      <CardHeader
        title="Where the WIP is standing"
        subtitle={total > 0 ? `${num(total)} pcs on the floor right now` : 'Nothing running'}
        actions={<Link to="/wip"><Button size="sm" variant="ghost">Detail</Button></Link>}
      />
      {total === 0 ? (
        <Empty title="No work in progress" detail="Nothing has been cut, or everything cut has shipped." />
      ) : (
        <div className="p-4 flex items-center gap-4">
          <div className="size-32 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="value" innerRadius={38} outerRadius={62} paddingAngle={2} stroke="none">
                  {data.map((entry, index) => (
                    <Cell key={entry.name} fill={WIP_COLOURS[index % WIP_COLOURS.length]} />
                  ))}
                </Pie>
                <ReTooltip
                  contentStyle={{
                    background: 'rgb(var(--c-surface))',
                    border: '1px solid rgb(var(--c-line))',
                    borderRadius: 10,
                    fontSize: 12,
                    boxShadow: '0 8px 24px rgb(0 0 0 / .12)',
                  }}
                  formatter={(value: number) => [`${num(value)} pcs`, '']}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex-1 min-w-0 space-y-1">
            {data.slice(0, 6).map((entry, index) => (
              <div key={entry.name} className="flex items-center gap-2 text-xs">
                <span
                  className="size-2 rounded-[3px] shrink-0"
                  style={{ background: WIP_COLOURS[index % WIP_COLOURS.length] }}
                />
                <span className="text-ink-2 truncate flex-1">{entry.name}</span>
                <span className="num tabular-nums text-ink shrink-0">{num(entry.value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}
