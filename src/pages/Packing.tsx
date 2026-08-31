/** Packing — cartons, and the trims that must be there first. */
import { useMemo } from 'react'
import { Package } from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { LogTable, type DerivedColumn, type FieldDef } from '../components/LogTable'
import { Badge, Callout, Section } from '../components/ui'
import { StatTile } from '../components/StatTile'
import { useDerived, useStore } from '../lib/store'
import { num, today } from '../lib/format'
import { colourField, dateField, orderField, requireFields, sizeField } from './fields'
import type { PackingRow } from '../lib/types'

export default function Packing() {
  const rows = useStore((s) => s.data.packing)
  const trims = useStore((s) => s.data.trims)
  const { derived } = useDerived()

  const fields: FieldDef<PackingRow>[] = useMemo(() => [
    dateField<PackingRow>(),
    orderField<PackingRow>(),
    colourField<PackingRow>(),
    sizeField<PackingRow>(),
    { kind: 'number', key: 'packedQty', header: 'Packed qty', width: '6.5rem', required: true },
    { kind: 'text', key: 'cartonNo', header: 'Carton no', width: '8rem' },
    { kind: 'text', key: 'remarks', header: 'Remarks', width: '11rem', hideBelow: 'lg' },
  ], [])

  /** Orders where a blocking trim is short — the carton cannot close. */
  const blockedOrders = useMemo(() => {
    const blocked = new Set<string>()
    for (const trim of trims) {
      if (trim.blocksPacking && trim.requiredQty > trim.receivedQty) blocked.add(trim.orderNo)
    }
    return blocked
  }, [trims])

  const cellFacts = useMemo(() => {
    const map = new Map<string, { available: number; packed: number }>()
    for (const cell of derived.cells) {
      map.set(`${cell.orderNo} ${cell.colour} ${cell.size}`, {
        available: cell.cumPacked + cell.awaitingPacking,
        packed: cell.cumPacked,
      })
    }
    return map
  }, [derived])

  const derivedColumns: DerivedColumn<PackingRow>[] = [
    {
      key: 'available', header: 'Available', align: 'right', width: '6.5rem',
      render: (row) => num(cellFacts.get(`${row.orderNo} ${row.colour} ${row.size}`)?.available),
    },
    {
      key: 'cum', header: 'Cum packed', align: 'right', width: '6.5rem',
      render: (row) => num(cellFacts.get(`${row.orderNo} ${row.colour} ${row.size}`)?.packed),
    },
    {
      key: 'trims', header: 'Trims', width: '7rem',
      render: (row) => blockedOrders.has(row.orderNo)
        ? <Badge tone="risk">Short</Badge>
        : <Badge tone="ok">OK</Badge>,
    },
    {
      key: 'status', header: 'Status', width: '11rem',
      render: (row) => {
        const facts = cellFacts.get(`${row.orderNo} ${row.colour} ${row.size}`)
        if (!facts) return <Badge tone="risk">Not in the size breakdown</Badge>
        const balance = facts.available - facts.packed
        return balance > 0
          ? <Badge tone="neutral">{num(balance)} still to pack</Badge>
          : <Badge tone="ok">Complete</Badge>
      },
    },
  ]

  const packed = rows.reduce((a, b) => a + b.packedQty, 0)
  const cartons = new Set(rows.map((r) => r.cartonNo).filter(Boolean)).size

  return (
    <>
      <PageHeader
        title="Packing"
        subtitle="What is available to pack follows whatever step comes before packing in each order's own route — checking for most, job work for some."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatTile label="Packed" value={num(packed)} caption="pcs in cartons" icon={<Package className="size-4" />} />
        <StatTile label="Cartons" value={num(cartons)} caption="numbered so far" />
        <StatTile label="Entries" value={num(rows.length)} />
        <StatTile
          label="Orders blocked by trims" value={num(blockedOrders.size)}
          tone={blockedOrders.size ? 'risk' : 'ok'}
        />
      </div>

      {blockedOrders.size > 0 && (
        <Callout tone="risk" title="A carton cannot close without its trims">
          {[...blockedOrders].join(', ')} — expedite the trim or clear the carton spec with the buyer.
        </Callout>
      )}

      <Section title="Packing log" className="mt-5">
        <LogTable<PackingRow>
          collection="packing"
          rows={rows}
          fields={fields}
          derived={derivedColumns}
          validate={requireFields<PackingRow>(fields)}
          blank={() => ({ date: today(), orderNo: '', colour: '', size: '', packedQty: 0, cartonNo: '', remarks: '' })}
          sortBy={(a, b) => (b.date ?? '').localeCompare(a.date ?? '')}
          rowTone={(row) => (blockedOrders.has(row.orderNo) ? 'warn' : null)}
          emptyTitle="Nothing packed yet"
        />
      </Section>
    </>
  )
}
