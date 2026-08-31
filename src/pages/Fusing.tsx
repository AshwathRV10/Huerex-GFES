/** Fusing — an in-house process, so it is not job work. */
import { useMemo } from 'react'
import { PageHeader } from '../components/AppShell'
import { LogTable, type DerivedColumn, type FieldDef } from '../components/LogTable'
import { Badge, Callout, Section } from '../components/ui'
import { StatTile } from '../components/StatTile'
import { useDerived, useStore } from '../lib/store'
import { num, today } from '../lib/format'
import { colourField, dateField, orderField, requireFields, sizeField } from './fields'
import type { FusingRow } from '../lib/types'

export default function Fusing() {
  const rows = useStore((s) => s.data.fusing)
  const { derived } = useDerived()

  const fields: FieldDef<FusingRow>[] = useMemo(() => [
    dateField<FusingRow>(),
    orderField<FusingRow>(),
    colourField<FusingRow>(),
    sizeField<FusingRow>(),
    { kind: 'number', key: 'fusedQty', header: 'Fused qty', width: '6.5rem', required: true },
    { kind: 'text', key: 'remarks', header: 'Remarks', width: '14rem' },
  ], [])

  const cellFacts = useMemo(() => {
    const map = new Map<string, { available: number; cum: number; inRoute: boolean }>()
    for (const cell of derived.cells) {
      const facts = derived.byOrderNo.get(cell.orderNo)
      map.set(`${cell.orderNo} ${cell.colour} ${cell.size}`, {
        available: cell.cumFused + cell.awaitingFusing,
        cum: cell.cumFused,
        inRoute: facts?.route.has('Fusing') ?? false,
      })
    }
    return map
  }, [derived])

  const derivedColumns: DerivedColumn<FusingRow>[] = [
    {
      key: 'available', header: 'Available', align: 'right', width: '6.5rem',
      render: (row) => num(cellFacts.get(`${row.orderNo} ${row.colour} ${row.size}`)?.available),
    },
    {
      key: 'cum', header: 'Cum fused', align: 'right', width: '6.5rem',
      render: (row) => num(cellFacts.get(`${row.orderNo} ${row.colour} ${row.size}`)?.cum),
    },
    {
      key: 'status', header: 'Status', width: '12rem',
      render: (row) => {
        const facts = cellFacts.get(`${row.orderNo} ${row.colour} ${row.size}`)
        if (!facts) return <Badge tone="risk">Not in the size breakdown</Badge>
        if (!facts.inRoute) return <Badge tone="warn">Fusing is not in this order's route</Badge>
        const balance = facts.available - facts.cum
        return balance > 0
          ? <Badge tone="neutral">{num(balance)} still to fuse</Badge>
          : <Badge tone="ok">Complete</Badge>
      },
    },
  ]

  const totalFused = rows.reduce((a, b) => a + b.fusedQty, 0)
  const ordersWithFusing = derived.orders.filter((o) => o.route.has('Fusing')).length

  return (
    <>
      <PageHeader
        title="Fusing"
        subtitle="Fusing is done inside the factory, so it has its own sheet rather than sitting in the job work bucket."
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
        <StatTile label="Pieces fused" value={num(totalFused)} />
        <StatTile label="Orders routed through fusing" value={num(ordersWithFusing)} />
        <StatTile label="Entries" value={num(rows.length)} />
      </div>

      {ordersWithFusing === 0 && (
        <Callout tone="info" title="No order has fusing in its route">
          Add a Fusing step to an order's route and the availability and balance columns here will start working.
        </Callout>
      )}

      <Section title="Fusing log" className="mt-5">
        <LogTable<FusingRow>
          collection="fusing"
          rows={rows}
          fields={fields}
          derived={derivedColumns}
          validate={requireFields<FusingRow>(fields)}
          blank={() => ({ date: today(), orderNo: '', colour: '', size: '', fusedQty: 0, remarks: '' })}
          sortBy={(a, b) => (b.date ?? '').localeCompare(a.date ?? '')}
          emptyTitle="Nothing fused yet"
        />
      </Section>
    </>
  )
}
