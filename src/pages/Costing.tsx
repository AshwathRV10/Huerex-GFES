/**
 * The costing book: every order, what it costs, what it sells for, and the gap.
 */
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip as ReTooltip, XAxis, YAxis,
} from 'recharts'
import { Calculator, CircleDollarSign, TriangleAlert } from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { DataGrid, type Column } from '../components/DataGrid'
import { StatTile } from '../components/StatTile'
import { Badge, Button, Callout, Card, CardHeader, Empty, Segmented, Tooltip } from '../components/ui'
import { useCostSummary, type OrderCosting } from '../hooks/useCostSummary'
import { useDerived, useStore } from '../lib/store'
import { money, moneyShort, num, pct } from '../lib/format'
import type { Order } from '../lib/types'

type Row = { order: Order; entry: OrderCosting | undefined }
type View = 'plan' | 'actual'

export default function Costing() {
  const orders = useStore((s) => s.data.orders)
  const cost = useCostSummary()
  const { derived } = useDerived()
  const navigate = useNavigate()
  const [view, setView] = useState<View>('plan')
  const [filter, setFilter] = useState<'live' | 'all' | 'attention'>('live')

  const rows = useMemo<Row[]>(() => {
    const all = orders.map((order) => ({ order, entry: cost.byOrder.get(order.orderNo) }))
    if (filter === 'live') return all.filter((r) => r.order.status === 'Active')
    if (filter === 'attention') {
      return all.filter((r) => {
        if (!r.entry) return true
        const result = r.entry.planned
        return result.sellingPrice == null || result.totalCost === 0 || result.margin < 0 || (result.marginPct ?? 1) < 0.08
      })
    }
    return all
  }, [orders, cost, filter])

  const pick = (entry: OrderCosting | undefined) =>
    view === 'actual' ? entry?.actual ?? entry?.planned ?? null : entry?.planned ?? null

  const currency = cost.totals.currency

  const chartData = useMemo(() => (
    orders
      .map((order) => {
        const result = pick(cost.byOrder.get(order.orderNo))
        if (!result || result.sellingPrice == null || result.totalCost === 0) return null
        return {
          orderNo: order.orderNo,
          margin: result.marginPct ?? 0,
          value: result.margin,
        }
      })
      .filter((d): d is { orderNo: string; margin: number; value: number } => d !== null)
      .sort((a, b) => a.margin - b.margin)
      .slice(0, 14)
  ), [orders, cost, view])

  const columns: Column<Row>[] = [
    {
      key: 'orderNo', header: 'Order', width: '11rem', sticky: true,
      value: (r) => r.order.orderNo,
      render: (r) => (
        <>
          <Link
            to={`/costing/${encodeURIComponent(r.order.orderNo)}`}
            className="text-sm font-medium text-ink hover:text-brand-600 transition-colors"
          >
            {r.order.orderNo}
          </Link>
          <span className="block text-2xs text-ink-3 truncate">{r.order.styleCode}</span>
        </>
      ),
    },
    {
      key: 'buyer', header: 'Buyer', width: '11rem', hideBelow: 'md',
      value: (r) => r.order.buyer,
      render: (r) => <span className="text-sm text-ink-2 truncate block">{r.order.buyer}</span>,
    },
    {
      key: 'ordered', header: 'Ordered', align: 'right', width: '6.5rem',
      value: (r) => r.order.orderQty,
      render: (r) => <span className="text-sm">{num(r.order.orderQty)}</span>,
    },
    {
      key: 'shipped', header: view === 'actual' ? 'Shipped' : 'Will ship', align: 'right', width: '7rem', derived: true,
      value: (r) => pick(r.entry)?.quantities.shipped ?? 0,
      render: (r) => {
        const result = pick(r.entry)
        if (!result) return <span className="text-ink-3/50">—</span>
        const excess = result.quantities.excessQty
        return (
          <Tooltip label={excess > 0
            ? `${num(result.quantities.ordered)} ordered + ${num(excess)} excess${result.quantities.excessInvoiced ? ' (invoiced)' : ' (free)'}`
            : 'no excess'}>
            <span className="text-sm">
              {num(result.quantities.shipped)}
              {excess > 0 && <span className={result.quantities.excessInvoiced ? 'text-ink-3' : 'text-saffron'}> +{num(excess)}</span>}
            </span>
          </Tooltip>
        )
      },
    },
    {
      key: 'price', header: 'Price / pc', align: 'right', width: '7rem',
      value: (r) => r.order.sellingPrice ?? -1,
      render: (r) => {
        const price = r.entry?.costing.sellingPrice ?? r.order.sellingPrice
        return price != null
          ? <span className="text-sm">{money(price, r.order.currency)}</span>
          : <span className="text-ink-3/60 text-xs">not quoted</span>
      },
    },
    {
      key: 'cost', header: 'Cost / pc', align: 'right', width: '7.5rem', derived: true,
      value: (r) => pick(r.entry)?.costPerShippedPc ?? -1,
      render: (r) => {
        const result = pick(r.entry)
        if (!result || result.totalCost === 0) return <span className="text-ink-3/50">—</span>
        return <span className="text-sm">{money(result.costPerShippedPc, result.currency)}</span>
      },
    },
    {
      key: 'contribution', header: 'Per pc', align: 'right', width: '7rem', derived: true, hideBelow: 'lg',
      value: (r) => pick(r.entry)?.contributionPerPc ?? -9999,
      render: (r) => {
        const result = pick(r.entry)
        if (!result || result.contributionPerPc == null || result.totalCost === 0) return <span className="text-ink-3/50">—</span>
        return (
          <span className={`text-sm ${result.contributionPerPc < 0 ? 'text-risk' : 'text-ok'}`}>
            {money(result.contributionPerPc, result.currency)}
          </span>
        )
      },
    },
    {
      key: 'total', header: 'Order margin', align: 'right', width: '8.5rem', derived: true,
      value: (r) => pick(r.entry)?.margin ?? -1e12,
      render: (r) => {
        const result = pick(r.entry)
        if (!result || result.sellingPrice == null || result.totalCost === 0) return <span className="text-ink-3/50">—</span>
        return (
          <span className={`text-sm num ${result.margin < 0 ? 'text-risk' : 'text-ink'}`}>
            {moneyShort(result.margin, result.currency)}
          </span>
        )
      },
    },
    {
      key: 'marginPct', header: 'Margin', align: 'right', width: '6.5rem', derived: true,
      value: (r) => pick(r.entry)?.marginPct ?? -99,
      render: (r) => {
        const result = pick(r.entry)
        if (!result || result.sellingPrice == null || result.totalCost === 0) {
          return <Badge tone="neutral">not costed</Badge>
        }
        return (
          <Badge tone={result.margin < 0 ? 'risk' : (result.marginPct ?? 0) < 0.08 ? 'warn' : 'ok'}>
            {pct(result.marginPct ?? 0, 1)}
          </Badge>
        )
      },
    },
    {
      key: 'action', header: '', width: '6rem',
      render: (r) => (
        <Link to={`/costing/${encodeURIComponent(r.order.orderNo)}`}>
          <Button size="sm" variant={r.entry ? 'ghost' : 'secondary'}>{r.entry ? 'Open' : 'Start'}</Button>
        </Link>
      ),
    },
  ]

  const withPrice = derived.orders.filter((o) => o.order.sellingPrice != null).length

  return (
    <>
      <PageHeader
        title="Costing"
        subtitle="What a garment actually costs to make, against the price quoted to the buyer. Every order is costed on its own — dyeing follows the colour, knitting follows the fabric, printing follows the style."
        actions={
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'plan', label: 'Planned', title: 'Costed on the quantities the order should produce' },
              { value: 'actual', label: 'Actual', title: 'Costed on what the floor has really done' },
            ]}
          />
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatTile
          label="Order value" value={moneyShort(cost.totals.revenue, currency)}
          caption={`${cost.costedOrders.length} orders costed`} icon={<CircleDollarSign className="size-4" />}
        />
        <StatTile label="Cost to make" value={moneyShort(cost.totals.cost, currency)} />
        <StatTile
          label="Margin" value={moneyShort(cost.totals.margin, currency)}
          caption={cost.totals.marginPct != null ? pct(cost.totals.marginPct) : 'no prices quoted yet'}
          tone={cost.totals.margin < 0 ? 'risk' : (cost.totals.marginPct ?? 1) < 0.08 ? 'warn' : 'ok'}
        />
        <StatTile
          label="Needs attention"
          value={num(cost.totals.loseMoney + cost.totals.thin + cost.uncostedOrders.length)}
          caption={`${cost.totals.loseMoney} losing money · ${cost.totals.thin} thin · ${cost.uncostedOrders.length} uncosted`}
          tone={cost.totals.loseMoney ? 'risk' : cost.totals.thin || cost.uncostedOrders.length ? 'warn' : 'ok'}
          icon={<TriangleAlert className="size-4" />}
        />
      </div>

      {withPrice === 0 && (
        <Callout tone="info" title="No prices quoted yet">
          A costing works without a price — it will still tell you what a garment costs. Add the price the
          buyer was quoted and it can tell you whether that price is worth taking.
        </Callout>
      )}

      {chartData.length > 0 && (
        <Card className="mb-5">
          <CardHeader
            title="Margin by order"
            subtitle={`Thinnest first. ${view === 'actual' ? 'Priced on what has actually been produced.' : 'Priced on the plan.'}`}
          />
          <div className="p-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: -12, bottom: 4 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="rgb(var(--c-line))" vertical={false} />
                <XAxis
                  dataKey="orderNo" tick={{ fontSize: 10, fill: 'rgb(var(--c-ink-3))' }}
                  axisLine={false} tickLine={false} interval={0} angle={-30} textAnchor="end" height={50}
                />
                <YAxis
                  tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                  tick={{ fontSize: 10, fill: 'rgb(var(--c-ink-3))' }} axisLine={false} tickLine={false}
                />
                <ReTooltip
                  cursor={{ fill: 'rgb(var(--c-ink) / 0.04)' }}
                  contentStyle={{
                    background: 'rgb(var(--c-surface))', border: '1px solid rgb(var(--c-line))',
                    borderRadius: 10, fontSize: 12, boxShadow: '0 8px 24px rgb(0 0 0 / .12)',
                  }}
                  formatter={(value: number, _name, entry) => [
                    `${(value * 100).toFixed(1)}%  ·  ${moneyShort((entry.payload as { value: number }).value, currency)}`,
                    'margin',
                  ]}
                />
                <Bar dataKey="margin" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry) => (
                    <Cell
                      key={entry.orderNo}
                      fill={entry.margin < 0 ? 'rgb(var(--c-risk))' : entry.margin < 0.08 ? 'rgb(var(--c-warn))' : 'rgb(var(--c-ok))'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      <DataGrid
        rows={rows}
        columns={columns}
        rowKey={(r) => r.order.orderNo}
        searchable
        searchPlaceholder="Search order, buyer or style…"
        onRowClick={(r) => navigate(`/costing/${encodeURIComponent(r.order.orderNo)}`)}
        rowTone={(r) => {
          const result = pick(r.entry)
          if (!result || result.sellingPrice == null || result.totalCost === 0) return null
          if (result.margin < 0) return 'risk'
          if ((result.marginPct ?? 1) < 0.08) return 'warn'
          return null
        }}
        toolbar={
          <Segmented
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'live', label: 'Live orders' },
              { value: 'attention', label: 'Needs attention' },
              { value: 'all', label: 'All' },
            ]}
          />
        }
        empty={
          <Empty
            icon={<Calculator className="size-5" />}
            title="Nothing to show"
            detail="Open an order and start its costing — the app fills in what it already knows from cutting, fabric and job work."
          />
        }
      />
    </>
  )
}
