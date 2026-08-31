/**
 * WIP — every running piece, by order, colour and size.
 *
 * Each column is a physical place on the floor, not a stage in a spreadsheet.
 * The ageing column is the one to read: a pile that has not moved in a
 * fortnight is a pile nobody owns.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Waypoints } from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { DataGrid, Qty, type Column } from '../components/DataGrid'
import { StatTile } from '../components/StatTile'
import { Badge, Empty, Segmented } from '../components/ui'
import { useDerived } from '../lib/store'
import { num, shortDate } from '../lib/format'
import type { CellFacts } from '../lib/engine/production'

export default function Wip() {
  const { derived } = useDerived()
  const [filter, setFilter] = useState<'running' | 'aged' | 'all'>('running')

  const rows = useMemo(() => {
    const live = derived.cells.filter((c) => c.live)
    if (filter === 'running') return live.filter((c) => c.totalWip > 0)
    if (filter === 'aged') return live.filter((c) => c.flag === 'AGED' || c.flag === 'WATCH')
    return live
  }, [derived, filter])

  const totals = useMemo(() => {
    const running = derived.cells.filter((c) => c.live && c.totalWip > 0)
    const sum = (pick: (c: CellFacts) => number) => running.reduce((a, b) => a + pick(b), 0)
    return {
      wip: sum((c) => c.totalWip),
      atVendor: sum((c) => c.atJobWorkVendor),
      rework: sum((c) => c.inRework),
      aged: running.filter((c) => c.flag === 'AGED').reduce((a, b) => a + b.totalWip, 0),
    }
  }, [derived])

  const columns: Column<CellFacts>[] = [
    {
      key: 'order', header: 'Order', width: '9rem', sticky: true,
      value: (c) => c.orderNo,
      render: (c) => (
        <Link to={`/orders/${encodeURIComponent(c.orderNo)}`} className="text-sm text-ink hover:text-brand-600">
          {c.orderNo}
        </Link>
      ),
    },
    {
      key: 'colour', header: 'Colour', width: '9rem',
      value: (c) => c.colour,
      render: (c) => <span className="text-sm text-ink-2">{c.colour}</span>,
    },
    {
      key: 'size', header: 'Size', width: '6rem',
      value: (c) => c.size,
      render: (c) => <span className="text-sm text-ink-2">{c.size}</span>,
    },
    { key: 'cut', header: 'Cut', align: 'right', width: '5.5rem', derived: true, value: (c) => c.cumCut, render: (c) => <Qty value={c.cumCut} /> },
    { key: 'fusing', header: 'Fusing', align: 'right', width: '5.5rem', derived: true, value: (c) => c.awaitingFusing, render: (c) => <Qty value={c.awaitingFusing} />, hideBelow: 'md' },
    { key: 'toVendor', header: 'To vendor', align: 'right', width: '6rem', derived: true, value: (c) => c.awaitingJobWork, render: (c) => <Qty value={c.awaitingJobWork} /> },
    { key: 'atVendor', header: 'At vendor', align: 'right', width: '6rem', derived: true, value: (c) => c.atJobWorkVendor, render: (c) => <Qty value={c.atJobWorkVendor} className="text-warn" /> },
    { key: 'toSew', header: 'To sew', align: 'right', width: '5.5rem', derived: true, value: (c) => c.readyForSewing, render: (c) => <Qty value={c.readyForSewing} />, hideBelow: 'lg' },
    { key: 'sewing', header: 'Sewing', align: 'right', width: '5.5rem', derived: true, value: (c) => c.inSewing, render: (c) => <Qty value={c.inSewing} />, hideBelow: 'lg' },
    { key: 'toCheck', header: 'To check', align: 'right', width: '6rem', derived: true, value: (c) => c.awaitingChecking, render: (c) => <Qty value={c.awaitingChecking} />, hideBelow: 'md' },
    { key: 'rework', header: 'Rework', align: 'right', width: '5.5rem', derived: true, value: (c) => c.inRework, render: (c) => <Qty value={c.inRework} className="text-warn" />, hideBelow: 'lg' },
    { key: 'toPack', header: 'To pack', align: 'right', width: '5.5rem', derived: true, value: (c) => c.awaitingPacking, render: (c) => <Qty value={c.awaitingPacking} />, hideBelow: 'md' },
    { key: 'toShip', header: 'To ship', align: 'right', width: '5.5rem', derived: true, value: (c) => c.packedNotShipped, render: (c) => <Qty value={c.packedNotShipped} /> },
    {
      key: 'total', header: 'Total WIP', align: 'right', width: '6.5rem', derived: true,
      value: (c) => c.totalWip,
      render: (c) => <span className="text-sm font-semibold num">{num(c.totalWip)}</span>,
    },
    {
      key: 'where', header: 'Where it is now', width: '13rem', derived: true,
      value: (c) => c.whereNow,
      render: (c) => <span className="text-sm text-ink-2">{c.whereNow}</span>,
    },
    {
      key: 'ageing', header: 'Idle', align: 'right', width: '7rem', derived: true,
      value: (c) => c.ageingDays ?? -1,
      render: (c) => c.ageingDays == null
        ? <span className="text-ink-3/50">·</span>
        : (
          <Badge tone={c.flag === 'AGED' ? 'risk' : c.flag === 'WATCH' ? 'warn' : 'ok'}>
            {c.ageingDays}d
          </Badge>
        ),
    },
    {
      key: 'moved', header: 'Last movement', align: 'right', width: '8rem', derived: true, hideBelow: 'lg',
      value: (c) => c.lastMovement,
      render: (c) => <span className="text-sm text-ink-3">{shortDate(c.lastMovement)}</span>,
    },
  ]

  return (
    <>
      <PageHeader
        title="Work in progress"
        subtitle="One row per order, colour and size. Every column is a real place on the floor — what fills each one comes from that order's own route."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatTile label="On the floor" value={num(totals.wip)} caption="pcs cut but not shipped" icon={<Waypoints className="size-4" />} tone="brand" />
        <StatTile label="At vendors" value={num(totals.atVendor)} caption="outside the factory" tone={totals.atVendor ? 'warn' : 'neutral'} />
        <StatTile label="In rework" value={num(totals.rework)} tone={totals.rework ? 'warn' : 'neutral'} />
        <StatTile label="Aged" value={num(totals.aged)} caption="not moved for 14 days or more" tone={totals.aged ? 'risk' : 'ok'} />
      </div>

      <DataGrid
        rows={rows}
        columns={columns}
        rowKey={(c) => c.id}
        searchable
        searchPlaceholder="Search order, colour or size…"
        defaultSort={{ key: 'total', direction: 'desc' }}
        rowTone={(c) => (c.flag === 'AGED' ? 'risk' : c.flag === 'WATCH' ? 'warn' : null)}
        toolbar={
          <Segmented
            size="sm" value={filter} onChange={setFilter}
            options={[
              { value: 'running', label: 'Running' },
              { value: 'aged', label: 'Aged & watch' },
              { value: 'all', label: 'Every row' },
            ]}
          />
        }
        empty={
          <Empty
            icon={<Waypoints className="size-5" />}
            title="Nothing running"
            detail="Either nothing has been cut yet, or everything cut has already shipped."
          />
        }
      />
    </>
  )
}
