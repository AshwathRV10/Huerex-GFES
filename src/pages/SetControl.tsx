/**
 * Set control — a two-piece set only ships when both halves ship.
 *
 * Nothing is typed here. Declare the pairing once on the order (a set group and
 * a Primary or Secondary role) and every line below works itself out.
 */
import { Link } from 'react-router-dom'
import { Grid2x2 } from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { DataGrid, Qty, type Column } from '../components/DataGrid'
import { StatTile } from '../components/StatTile'
import { Badge, Callout, Empty } from '../components/ui'
import { useDerived, useStore } from '../lib/store'
import { num } from '../lib/format'
import type { SetLine } from '../lib/engine/sets'

export default function SetControl() {
  const { sets } = useDerived()
  const orders = useStore((s) => s.data.orders)

  const grouped = orders.filter((o) => o.setGroup && o.setGroup !== '-')
  const broken = sets.lines.filter((l) => l.configError)
  const unpaired = sets.lines.filter((l) => !l.configError && l.legImbalance > 0)

  const columns: Column<SetLine>[] = [
    {
      key: 'group', header: 'Set group', width: '8rem', sticky: true,
      value: (l) => l.setGroup,
      render: (l) => <span className="text-sm font-medium text-ink">{l.setGroup}</span>,
    },
    { key: 'colour', header: 'Colour', width: '9rem', value: (l) => l.colour, render: (l) => <span className="text-sm text-ink-2">{l.colour}</span> },
    { key: 'size', header: 'Size', width: '6rem', value: (l) => l.size, render: (l) => <span className="text-sm text-ink-2">{l.size}</span> },
    {
      key: 'primary', header: 'Primary', width: '9rem', hideBelow: 'md',
      value: (l) => l.primaryOrder,
      render: (l) => l.primaryOrder
        ? <Link to={`/orders/${encodeURIComponent(l.primaryOrder)}`} className="text-sm text-ink hover:text-brand-600">{l.primaryOrder}</Link>
        : <span className="text-risk text-xs">missing</span>,
    },
    {
      key: 'secondary', header: 'Secondary', width: '9rem', hideBelow: 'md',
      value: (l) => l.secondaryOrder,
      render: (l) => l.secondaryOrder
        ? <Link to={`/orders/${encodeURIComponent(l.secondaryOrder)}`} className="text-sm text-ink hover:text-brand-600">{l.secondaryOrder}</Link>
        : <span className="text-risk text-xs">missing</span>,
    },
    { key: 'setQty', header: 'Sets ordered', align: 'right', width: '7rem', value: (l) => l.setQty, render: (l) => <Qty value={l.setQty} /> },
    { key: 'makeable', header: 'Makeable', align: 'right', width: '6.5rem', derived: true, value: (l) => l.setsMakeable, render: (l) => <Qty value={l.setsMakeable} /> },
    { key: 'packed', header: 'Packed', align: 'right', width: '6rem', derived: true, value: (l) => l.setsPacked, render: (l) => <Qty value={l.setsPacked} /> },
    { key: 'shipped', header: 'Shipped', align: 'right', width: '6rem', derived: true, value: (l) => l.setsShipped, render: (l) => <Qty value={l.setsShipped} /> },
    {
      key: 'imbalance', header: 'Unpaired', align: 'right', width: '6.5rem', derived: true,
      value: (l) => l.legImbalance,
      render: (l) => l.legImbalance > 0
        ? <span className="text-risk num text-sm font-medium">{num(l.legImbalance)}</span>
        : <span className="text-ink-3/50">·</span>,
    },
    {
      key: 'status', header: 'Status', width: '18rem', derived: true,
      value: (l) => l.status,
      render: (l) => (
        <span>
          <Badge tone={l.configError ? 'risk' : l.legImbalance > 0 ? 'warn' : l.setsShipped >= l.setQty && l.setQty > 0 ? 'ok' : 'neutral'}>
            {l.status}
          </Badge>
          {l.configError && <span className="block text-2xs text-ink-3 mt-0.5">{l.configError}</span>}
        </span>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Set control"
        subtitle="A top and a bottom that ship together. Declare the pairing once on each order and everything here works itself out."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatTile label="Set groups" value={num(new Set(sets.lines.map((l) => l.setGroup)).size)} icon={<Grid2x2 className="size-4" />} />
        <StatTile label="Orders paired" value={num(grouped.length)} />
        <StatTile label="Pairing broken" value={num(broken.length)} tone={broken.length ? 'risk' : 'ok'} />
        <StatTile label="Shipped unpaired" value={num(unpaired.reduce((a, b) => a + b.legImbalance, 0))} tone={unpaired.length ? 'warn' : 'ok'} caption="pcs that went without a partner" />
      </div>

      {broken.length > 0 && (
        <Callout tone="risk" title={`${broken.length} line${broken.length > 1 ? 's have' : ' has'} broken pairing`}>
          A set with no partner order, or a partner that has no matching colour and size row, can never
          complete. Fix the set group and role on the order, or add the missing row to the size breakdown.
        </Callout>
      )}

      <div className="mt-5">
        <DataGrid
          rows={sets.lines}
          columns={columns}
          rowKey={(l) => `${l.setGroup} ${l.colour} ${l.size}`}
          searchable
          searchPlaceholder="Search set group, colour, size or order…"
          defaultSort={{ key: 'imbalance', direction: 'desc' }}
          rowTone={(l) => (l.configError ? 'risk' : l.legImbalance > 0 ? 'warn' : null)}
          empty={
            <Empty
              icon={<Grid2x2 className="size-5" />}
              title="No sets declared"
              detail="Give two orders the same set group — one Primary, one Secondary — and this page starts tracking whether both halves can ship together."
            />
          }
        />
      </div>
    </>
  )
}
