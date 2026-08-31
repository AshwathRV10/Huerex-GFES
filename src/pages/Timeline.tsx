/**
 * Order timeline — how long each stage took, and where the days went.
 */
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Clock } from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { DataGrid, type Column } from '../components/DataGrid'
import { StatTile } from '../components/StatTile'
import { Badge, Card, CardHeader, Empty, Tooltip } from '../components/ui'
import { useDerived } from '../lib/store'
import { num, shortDate } from '../lib/format'
import type { OrderFacts } from '../lib/engine/production'

const STAGES = [
  { key: 'fabricLeadTime', label: 'Fabric', colour: 'bg-brand-500' },
  { key: 'cuttingDuration', label: 'Cutting', colour: 'bg-info' },
  { key: 'jobWorkTurnaround', label: 'Job work', colour: 'bg-saffron' },
  { key: 'sewingDuration', label: 'Sewing', colour: 'bg-ok' },
  { key: 'packingDuration', label: 'Packing', colour: 'bg-ink-3' },
  { key: 'dispatchSpread', label: 'Dispatch', colour: 'bg-risk' },
] as const

export default function Timeline() {
  const { derived } = useDerived()
  const rows = derived.orders

  const averages = useMemo(() => {
    const out: Record<string, number | null> = {}
    for (const stage of STAGES) {
      const values = rows
        .map((r) => r.timeline[stage.key])
        .filter((v): v is number => v != null && v >= 0)
      out[stage.key] = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
    }
    return out
  }, [rows])

  const closed = rows.filter((r) => r.timeline.closed)
  const onTime = closed.filter((r) => (r.timeline.delayDays ?? 0) <= 0)
  const cycles = rows.map((r) => r.timeline.totalCycleTime).filter((v): v is number => v != null)
  const avgCycle = cycles.length ? cycles.reduce((a, b) => a + b, 0) / cycles.length : null

  const columns: Column<OrderFacts>[] = [
    {
      key: 'order', header: 'Order', width: '10rem', sticky: true,
      value: (o) => o.order.orderNo,
      render: (o) => (
        <>
          <Link to={`/orders/${encodeURIComponent(o.order.orderNo)}`} className="text-sm text-ink hover:text-brand-600">
            {o.order.orderNo}
          </Link>
          <span className="block text-2xs text-ink-3 truncate">{o.order.buyer}</span>
        </>
      ),
    },
    { key: 'ordered', header: 'Order date', align: 'right', width: '7.5rem', value: (o) => o.timeline.orderDate, render: (o) => <span className="text-sm text-ink-2">{shortDate(o.timeline.orderDate)}</span> },
    { key: 'fabricIn', header: 'Fabric in', align: 'right', width: '7.5rem', derived: true, hideBelow: 'lg', value: (o) => o.timeline.fabricIn, render: (o) => <span className="text-sm text-ink-2">{shortDate(o.timeline.fabricIn)}</span> },
    { key: 'cutStart', header: 'Cut start', align: 'right', width: '7.5rem', derived: true, hideBelow: 'lg', value: (o) => o.timeline.cutStart, render: (o) => <span className="text-sm text-ink-2">{shortDate(o.timeline.cutStart)}</span> },
    { key: 'sewEnd', header: 'Sew end', align: 'right', width: '7.5rem', derived: true, hideBelow: 'md', value: (o) => o.timeline.sewEnd, render: (o) => <span className="text-sm text-ink-2">{shortDate(o.timeline.sewEnd)}</span> },
    { key: 'dispatch', header: 'Last dispatch', align: 'right', width: '8rem', derived: true, value: (o) => o.timeline.lastDispatch, render: (o) => <span className="text-sm text-ink-2">{shortDate(o.timeline.lastDispatch)}</span> },
    { key: 'exf', header: 'Ex-factory', align: 'right', width: '7.5rem', value: (o) => o.timeline.exFactory, render: (o) => <span className="text-sm text-ink-2">{shortDate(o.timeline.exFactory)}</span> },
    {
      key: 'stages', header: 'Where the days went', width: '16rem', derived: true,
      render: (o) => <StageBar timeline={o.timeline} />,
    },
    {
      key: 'cycle', header: 'Cycle', align: 'right', width: '6rem', derived: true,
      value: (o) => o.timeline.totalCycleTime ?? -1,
      render: (o) => o.timeline.totalCycleTime == null
        ? <span className="text-ink-3/50">·</span>
        : <span className="text-sm num">{o.timeline.totalCycleTime}d</span>,
    },
    {
      key: 'delay', header: 'Against ex-factory', align: 'right', width: '9rem', derived: true,
      value: (o) => o.timeline.delayDays ?? -999,
      render: (o) => {
        const delay = o.timeline.delayDays
        if (delay == null) return <span className="text-ink-3/50">·</span>
        return (
          <Badge tone={delay > 0 ? 'risk' : 'ok'}>
            {delay > 0 ? `${delay}d late` : `${-delay}d early`}
          </Badge>
        )
      },
    },
    {
      key: 'status', header: 'Status', width: '8rem', derived: true,
      value: (o) => (o.timeline.closed ? 'Closed' : 'Running'),
      render: (o) => <Badge tone={o.timeline.closed ? 'neutral' : 'brand'}>{o.timeline.closed ? 'Closed' : 'Running'}</Badge>,
    },
  ]

  return (
    <>
      <PageHeader
        title="Order timeline"
        subtitle="Every milestone is derived from a transaction. Cycle time runs while the order is open and freezes when it ships."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatTile
          label="Average cycle time" value={avgCycle != null ? `${Math.round(avgCycle)}` : '—'} unit="days"
          icon={<Clock className="size-4" />}
        />
        <StatTile label="Orders closed" value={num(closed.length)} />
        <StatTile
          label="Delivered on time" value={closed.length ? `${Math.round((onTime.length / closed.length) * 100)}%` : '—'}
          tone="ok" caption={closed.length ? `${onTime.length} of ${closed.length}` : 'nothing closed yet'}
        />
        <StatTile
          label="Slowest stage"
          value={slowestStage(averages)}
          caption="on average across every order"
        />
      </div>

      <Card className="mb-5">
        <CardHeader title="Average days by stage" subtitle="Where the calendar actually goes" />
        <div className="p-4 space-y-2.5">
          {STAGES.map((stage) => {
            const value = averages[stage.key]
            const max = Math.max(...Object.values(averages).map((v) => v ?? 0), 1)
            return (
              <div key={stage.key} className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-xs text-ink-2">{stage.label}</span>
                <span className="flex-1 h-2 rounded-full bg-ink/[0.06] overflow-hidden">
                  <span
                    className={`block h-full rounded-full origin-left animate-bar-grow ${stage.colour}`}
                    style={{ width: `${((value ?? 0) / max) * 100}%` }}
                  />
                </span>
                <span className="w-16 shrink-0 text-right text-sm num text-ink">
                  {value != null ? `${value.toFixed(1)}d` : '—'}
                </span>
              </div>
            )
          })}
        </div>
      </Card>

      <DataGrid
        rows={rows}
        columns={columns}
        rowKey={(o) => o.order.orderNo}
        searchable
        defaultSort={{ key: 'delay', direction: 'desc' }}
        rowTone={(o) => ((o.timeline.delayDays ?? 0) > 0 ? 'risk' : null)}
        empty={<Empty title="No orders yet" />}
      />
    </>
  )
}

function StageBar({ timeline }: { timeline: OrderFacts['timeline'] }) {
  const parts = STAGES
    .map((stage) => ({ ...stage, value: timeline[stage.key] ?? 0 }))
    .filter((stage) => stage.value > 0)
  const total = parts.reduce((a, b) => a + b.value, 0)
  if (total === 0) return <span className="text-2xs text-ink-3">nothing logged yet</span>

  return (
    <span className="flex h-2 rounded-full overflow-hidden bg-ink/[0.06]">
      {parts.map((part) => (
        <Tooltip key={part.key} label={`${part.label}: ${part.value} days`}>
          <span className={`block h-full ${part.colour}`} style={{ width: `${(part.value / total) * 100}%` }} />
        </Tooltip>
      ))}
    </span>
  )
}

function slowestStage(averages: Record<string, number | null>): string {
  let best: { label: string; value: number } | null = null
  for (const stage of STAGES) {
    const value = averages[stage.key]
    if (value != null && (!best || value > best.value)) best = { label: stage.label, value }
  }
  return best ? `${best.label}` : '—'
}
