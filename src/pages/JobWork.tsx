/**
 * Job work — every outsourced process in one bucket.
 *
 * Two rows per movement: one OUT when pieces leave, one IN when they come
 * back. Anything still out is money and material sitting in somebody else's
 * building, so the ageing column is the one that matters.
 */
import { useMemo, useState } from 'react'
import { Truck } from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { LogTable, type DerivedColumn, type FieldDef } from '../components/LogTable'
import { Badge, Card, CardHeader, Section, Segmented } from '../components/ui'
import { StatTile } from '../components/StatTile'
import { useDerived, useStore } from '../lib/store'
import { daysBetween, num, today } from '../lib/format'
import { colourField, dateField, jobWorkProcessesOf, orderField, requireFields, sizeField, vendorsOf } from './fields'
import type { JobWorkRow } from '../lib/types'

export default function JobWork() {
  const rows = useStore((s) => s.data.jobwork)
  const { derived } = useDerived()
  const [filter, setFilter] = useState<'all' | 'out' | 'pending'>('all')

  const fields: FieldDef<JobWorkRow>[] = useMemo(() => [
    dateField<JobWorkRow>(),
    orderField<JobWorkRow>(),
    colourField<JobWorkRow>(),
    sizeField<JobWorkRow>(),
    {
      kind: 'combo', key: 'process', header: 'Process', width: '8.5rem', required: true,
      list: 'jobWorkProcesses', suggest: (draft) => jobWorkProcessesOf(draft.orderNo),
    },
    {
      kind: 'combo', key: 'vendor', header: 'Vendor', width: '11rem', required: true,
      list: 'vendors', suggest: (draft) => vendorsOf(draft.orderNo, draft.process),
    },
    {
      kind: 'select', key: 'direction', header: 'Direction', width: '6rem', required: true,
      options: [{ value: 'OUT', label: 'OUT · sent' }, { value: 'IN', label: 'IN · returned' }],
    },
    { kind: 'number', key: 'qty', header: 'Qty', width: '5.5rem', required: true },
    { kind: 'text', key: 'remarks', header: 'DC / remarks', width: '9rem', hideBelow: 'lg' },
  ], [])

  /** Cumulative movements per order, colour, size and process. */
  const balance = useMemo(() => {
    const map = new Map<string, { out: number; in: number; lastOut: string }>()
    for (const row of rows) {
      const key = `${row.orderNo} ${row.colour} ${row.size} ${row.process}`
      const cur = map.get(key) ?? { out: 0, in: 0, lastOut: '' }
      if (row.direction === 'OUT') {
        cur.out += row.qty
        if (row.date > cur.lastOut) cur.lastOut = row.date
      } else cur.in += row.qty
      map.set(key, cur)
    }
    return map
  }, [rows])

  const routeHas = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const facts of derived.orders) {
      map.set(facts.order.orderNo, new Set(facts.route.processes))
    }
    return map
  }, [derived])

  const derivedColumns: DerivedColumn<JobWorkRow>[] = [
    {
      key: 'atVendor', header: 'Still out', align: 'right', width: '6rem',
      render: (row) => {
        const key = `${row.orderNo} ${row.colour} ${row.size} ${row.process}`
        const cur = balance.get(key)
        const still = Math.max(0, (cur?.out ?? 0) - (cur?.in ?? 0))
        return still > 0 ? <span className="text-warn font-medium">{num(still)}</span> : <span className="text-ink-3/50">·</span>
      },
    },
    {
      key: 'days', header: 'Days out', align: 'right', width: '5.5rem',
      render: (row) => {
        const key = `${row.orderNo} ${row.colour} ${row.size} ${row.process}`
        const cur = balance.get(key)
        const still = Math.max(0, (cur?.out ?? 0) - (cur?.in ?? 0))
        if (still === 0 || !cur?.lastOut) return <span className="text-ink-3/50">·</span>
        const days = daysBetween(cur.lastOut, today()) ?? 0
        return <span className={days >= 14 ? 'text-risk font-medium' : days >= 7 ? 'text-warn' : ''}>{days}</span>
      },
    },
    {
      key: 'status', header: 'Status', width: '13rem',
      render: (row) => {
        if (!routeHas.get(row.orderNo)?.has(row.process)) {
          return <Badge tone="warn">{row.process} is not in this order's route</Badge>
        }
        const key = `${row.orderNo} ${row.colour} ${row.size} ${row.process}`
        const cur = balance.get(key)
        const still = Math.max(0, (cur?.out ?? 0) - (cur?.in ?? 0))
        if (row.direction === 'IN') return <Badge tone="ok">Returned</Badge>
        if (still === 0) return <Badge tone="ok">Returned complete</Badge>
        const days = cur?.lastOut ? daysBetween(cur.lastOut, today()) ?? 0 : 0
        return <Badge tone={days >= 14 ? 'risk' : 'warn'}>{num(still)} at {row.vendor.split(' ')[0]}</Badge>
      },
    },
  ]

  const visible = useMemo(() => {
    if (filter === 'out') return rows.filter((r) => r.direction === 'OUT')
    if (filter === 'pending') {
      return rows.filter((row) => {
        if (row.direction !== 'OUT') return false
        const cur = balance.get(`${row.orderNo} ${row.colour} ${row.size} ${row.process}`)
        return Math.max(0, (cur?.out ?? 0) - (cur?.in ?? 0)) > 0
      })
    }
    return rows
  }, [rows, filter, balance])

  const atVendor = derived.orders.reduce((a, o) => a + o.atJobWorkVendor, 0)

  /** What is sitting where, by vendor. */
  const byVendor = useMemo(() => {
    const map = new Map<string, { out: number; in: number; oldest: string }>()
    for (const row of rows) {
      const cur = map.get(row.vendor) ?? { out: 0, in: 0, oldest: '' }
      if (row.direction === 'OUT') {
        cur.out += row.qty
        if (!cur.oldest || row.date < cur.oldest) cur.oldest = row.date
      } else cur.in += row.qty
      map.set(row.vendor, cur)
    }
    return [...map.entries()]
      .map(([vendor, v]) => ({ vendor, pending: Math.max(0, v.out - v.in), oldest: v.oldest }))
      .filter((v) => v.pending > 0)
      .sort((a, b) => b.pending - a.pending)
  }, [rows])

  return (
    <>
      <PageHeader
        title="Job work"
        subtitle="Print, embroidery, wash, tie & dye — any outsourced process lands in this one bucket. Nothing disappears because a process has no column of its own."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatTile label="At vendors now" value={num(atVendor)} caption="pcs outside the factory" tone={atVendor > 0 ? 'warn' : 'ok'} icon={<Truck className="size-4" />} />
        <StatTile label="Sent" value={num(rows.filter((r) => r.direction === 'OUT').reduce((a, b) => a + b.qty, 0))} caption="pcs, all time" />
        <StatTile label="Returned" value={num(rows.filter((r) => r.direction === 'IN').reduce((a, b) => a + b.qty, 0))} caption="pcs, all time" />
        <StatTile label="Vendors holding stock" value={num(byVendor.length)} tone={byVendor.length ? 'warn' : 'ok'} />
      </div>

      {byVendor.length > 0 && (
        <Card className="mb-5">
          <CardHeader title="Who is holding your pieces" subtitle="Oldest consignment first" />
          <div className="divide-y divide-line">
            {byVendor.map((entry) => {
              const days = entry.oldest ? daysBetween(entry.oldest, today()) ?? 0 : 0
              return (
                <div key={entry.vendor} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="text-sm text-ink truncate">{entry.vendor}</span>
                  <span className="flex items-center gap-3 shrink-0">
                    <span className="num text-sm">{num(entry.pending)} pcs</span>
                    <Badge tone={days >= 14 ? 'risk' : days >= 7 ? 'warn' : 'neutral'}>{days}d</Badge>
                  </span>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      <Section title="Movements">
        <LogTable<JobWorkRow>
          collection="jobwork"
          rows={visible}
          fields={fields}
          derived={derivedColumns}
          validate={requireFields<JobWorkRow>(fields)}
          blank={() => ({
            date: today(), orderNo: '', colour: '', size: '', process: '', vendor: '',
            direction: 'OUT', qty: 0, remarks: '',
          })}
          sortBy={(a, b) => (b.date ?? '').localeCompare(a.date ?? '')}
          rowTone={(row) => (routeHas.get(row.orderNo)?.has(row.process) ? null : 'warn')}
          toolbar={
            <Segmented
              size="sm"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All movements' },
                { value: 'out', label: 'Sent out' },
                { value: 'pending', label: 'Still at vendor' },
              ]}
            />
          }
          emptyTitle="No job work logged"
        />
      </Section>
    </>
  )
}
