/**
 * Trims — what is short, and whether it stops packing.
 *
 * A trim marked as blocking packing is one the carton cannot close without.
 * Everything else is a nuisance; these are a stopped shipment.
 */
import { useMemo } from 'react'
import { Boxes } from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { LogTable, type DerivedColumn, type FieldDef } from '../components/LogTable'
import { Badge, Callout, Section } from '../components/ui'
import { StatTile } from '../components/StatTile'
import { useStore } from '../lib/store'
import { num, pct, today } from '../lib/format'
import { dateField, orderField, requireFields } from './fields'
import type { TrimRow } from '../lib/types'

export default function Trims() {
  const rows = useStore((s) => s.data.trims)

  const fields: FieldDef<TrimRow>[] = useMemo(() => [
    dateField<TrimRow>(),
    orderField<TrimRow>(),
    { kind: 'combo', key: 'trimItem', header: 'Trim item', width: '11rem', required: true, list: 'trimItems' },
    { kind: 'number', key: 'requiredQty', header: 'Required', width: '6.5rem', required: true },
    { kind: 'number', key: 'receivedQty', header: 'Received', width: '6.5rem' },
    { kind: 'number', key: 'issuedQty', header: 'Issued', width: '6.5rem' },
    { kind: 'toggle', key: 'blocksPacking', header: 'Blocks packing?', width: '7rem' },
    { kind: 'text', key: 'remarks', header: 'Remarks', width: '11rem', hideBelow: 'lg' },
  ], [])

  /** Cumulative receipts per order and trim item, so a part delivery adds up. */
  const cumulative = useMemo(() => {
    const map = new Map<string, { required: number; received: number }>()
    for (const row of rows) {
      const key = `${row.orderNo} ${row.trimItem}`
      const cur = map.get(key) ?? { required: 0, received: 0 }
      cur.required += row.requiredQty
      cur.received += row.receivedQty
      map.set(key, cur)
    }
    return map
  }, [rows])

  const derivedColumns: DerivedColumn<TrimRow>[] = [
    {
      key: 'cumRecd', header: 'Cum received', align: 'right', width: '7rem',
      render: (row) => num(cumulative.get(`${row.orderNo} ${row.trimItem}`)?.received),
    },
    {
      key: 'short', header: 'Short by', align: 'right', width: '6.5rem',
      render: (row) => {
        const cur = cumulative.get(`${row.orderNo} ${row.trimItem}`)
        const short = Math.max(0, (cur?.required ?? 0) - (cur?.received ?? 0))
        return short > 0 ? <span className="text-risk font-medium">{num(short)}</span> : <span className="text-ink-3/50">·</span>
      },
    },
    {
      key: 'coverage', header: 'Coverage', align: 'right', width: '6.5rem',
      render: (row) => {
        const cur = cumulative.get(`${row.orderNo} ${row.trimItem}`)
        if (!cur?.required) return <span className="text-ink-3/50">·</span>
        return pct(cur.received / cur.required, 0)
      },
    },
    {
      key: 'status', header: 'Status', width: '13rem',
      render: (row) => {
        const cur = cumulative.get(`${row.orderNo} ${row.trimItem}`)
        const short = Math.max(0, (cur?.required ?? 0) - (cur?.received ?? 0))
        if (short === 0) return <Badge tone="ok">Fully covered</Badge>
        return row.blocksPacking
          ? <Badge tone="risk">Blocking packing — {num(short)} short</Badge>
          : <Badge tone="warn">{num(short)} short</Badge>
      },
    },
  ]

  const blocking = rows.filter((row) => {
    const cur = cumulative.get(`${row.orderNo} ${row.trimItem}`)
    return row.blocksPacking && (cur?.required ?? 0) > (cur?.received ?? 0)
  })
  const blockedOrders = new Set(blocking.map((r) => r.orderNo))

  return (
    <>
      <PageHeader
        title="Trims"
        subtitle="Set Blocks packing to Yes for any trim the carton cannot close without. Everything else is tracked but will not stop a shipment."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatTile label="Trim lines" value={num(rows.length)} icon={<Boxes className="size-4" />} />
        <StatTile label="Items tracked" value={num(new Set(rows.map((r) => r.trimItem)).size)} />
        <StatTile label="Short lines" value={num(blocking.length)} tone={blocking.length ? 'risk' : 'ok'} />
        <StatTile
          label="Orders blocked" value={num(blockedOrders.size)}
          caption={blockedOrders.size ? [...blockedOrders].join(', ') : 'nothing is stopping a carton'}
          tone={blockedOrders.size ? 'risk' : 'ok'}
        />
      </div>

      {rows.length === 0 && (
        <Callout tone="info" title="No trims logged yet">
          Log what each order needs and what has arrived. Anything marked as blocking packing will hold the
          carton and raise an alert until it lands.
        </Callout>
      )}

      <Section title="Trim log" className="mt-5">
        <LogTable<TrimRow>
          collection="trims"
          rows={rows}
          fields={fields}
          derived={derivedColumns}
          validate={requireFields<TrimRow>(fields)}
          blank={() => ({
            date: today(), orderNo: '', trimItem: '', requiredQty: 0, receivedQty: 0,
            issuedQty: 0, blocksPacking: false, remarks: '',
          })}
          sortBy={(a, b) => (b.date ?? '').localeCompare(a.date ?? '')}
          rowTone={(row) => {
            const cur = cumulative.get(`${row.orderNo} ${row.trimItem}`)
            const short = (cur?.required ?? 0) > (cur?.received ?? 0)
            return short ? (row.blocksPacking ? 'risk' : 'warn') : null
          }}
          emptyTitle="No trims logged"
        />
      </Section>
    </>
  )
}
