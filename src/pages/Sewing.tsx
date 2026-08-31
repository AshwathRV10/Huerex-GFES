/**
 * Sewing — three fixed blocks a day, with pace and efficiency.
 *
 * Blocks run 09:00–12:30, 13:30–18:00 and 18:30–20:30. There is no colour or
 * size here on purpose: the line runs an order, not a size.
 */
import { useMemo } from 'react'
import { Factory } from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { LogTable, type DerivedColumn, type FieldDef } from '../components/LogTable'
import { Badge, Section } from '../components/ui'
import { StatTile } from '../components/StatTile'
import { useDerived, useStore } from '../lib/store'
import { num, pct, today } from '../lib/format'
import { dateField, orderField, requireFields } from './fields'
import type { SewingRow } from '../lib/types'

export default function Sewing() {
  const rows = useStore((s) => s.data.sewing)
  const orders = useStore((s) => s.data.orders)
  const { derived } = useDerived()

  const fields: FieldDef<SewingRow>[] = useMemo(() => [
    dateField<SewingRow>(),
    orderField<SewingRow>(),
    { kind: 'combo', key: 'line', header: 'Line', width: '7rem', required: true, list: 'lines' },
    { kind: 'number', key: 'operators', header: 'Operators', width: '6rem', required: true },
    { kind: 'number', key: 'hours', header: 'Hours', width: '5.5rem', decimals: 1, required: true },
    { kind: 'number', key: 'block1', header: 'Block 1', width: '5.5rem', note: '09:00–12:30' },
    { kind: 'number', key: 'block2', header: 'Block 2', width: '5.5rem', note: '13:30–18:00' },
    { kind: 'number', key: 'block3', header: 'Block 3', width: '5.5rem', note: '18:30–20:30' },
    { kind: 'number', key: 'issuedToLine', header: 'Issued', width: '6rem', note: 'fed into the line', hideBelow: 'md' },
    { kind: 'text', key: 'remarks', header: 'Remarks', width: '9rem', hideBelow: 'lg' },
  ], [])

  const samByOrder = useMemo(
    () => new Map(orders.map((o) => [o.orderNo, o.sam])),
    [orders],
  )

  const derivedColumns: DerivedColumn<SewingRow>[] = [
    {
      key: 'output', header: 'Output', align: 'right', width: '6rem',
      render: (row) => <span className="font-medium text-ink">{num(row.block1 + row.block2 + row.block3)}</span>,
    },
    {
      key: 'perOpHour', header: 'Pcs / op-hr', align: 'right', width: '6.5rem',
      render: (row) => {
        const opHours = row.operators * row.hours
        if (!opHours) return <span className="text-ink-3/50">·</span>
        return num((row.block1 + row.block2 + row.block3) / opHours, 2)
      },
    },
    {
      key: 'efficiency', header: 'Efficiency', align: 'right', width: '6.5rem',
      render: (row) => {
        const sam = samByOrder.get(row.orderNo) ?? 0
        const minutes = row.operators * row.hours * 60
        if (!sam || !minutes) return <span className="text-ink-3/50">·</span>
        const efficiency = ((row.block1 + row.block2 + row.block3) * sam) / minutes
        return (
          <span className={efficiency >= 0.6 ? 'text-ok' : efficiency >= 0.4 ? 'text-warn' : 'text-risk'}>
            {pct(efficiency, 0)}
          </span>
        )
      },
    },
    {
      key: 'status', header: 'Status', width: '11rem',
      render: (row) => {
        const facts = derived.byOrderNo.get(row.orderNo)
        if (!facts) return <Badge tone="risk">Order not found</Badge>
        if (!facts.route.has('Sewing')) return <Badge tone="warn">Sewing is not in this route</Badge>
        const output = row.block1 + row.block2 + row.block3
        if (output === 0 && row.issuedToLine > 0) return <Badge tone="info">Fed into the line</Badge>
        const remaining = Math.max(0, facts.order.orderQty - facts.sewn)
        return remaining > 0
          ? <Badge tone="neutral">{num(remaining)} still to sew</Badge>
          : <Badge tone="ok">Sewing complete</Badge>
      },
    },
  ]

  const totalOutput = rows.reduce((a, b) => a + b.block1 + b.block2 + b.block3, 0)
  const totalOpHours = rows.reduce((a, b) => a + b.operators * b.hours, 0)
  const samMinutes = rows.reduce(
    (a, b) => a + (b.block1 + b.block2 + b.block3) * (samByOrder.get(b.orderNo) ?? 0), 0,
  )
  const efficiency = totalOpHours > 0 ? samMinutes / (totalOpHours * 60) : null

  return (
    <>
      <PageHeader
        title="Sewing"
        subtitle="Three fixed blocks a day. Efficiency is standard minutes produced against operator minutes paid for, so it needs the order's SAM to be filled in."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatTile label="Output" value={num(totalOutput)} caption="pcs off the line" icon={<Factory className="size-4" />} />
        <StatTile label="Operator hours" value={num(totalOpHours, 0)} caption="worked" />
        <StatTile
          label="Pcs / operator-hour"
          value={totalOpHours > 0 ? num(totalOutput / totalOpHours, 2) : '—'}
        />
        <StatTile
          label="Efficiency" value={efficiency != null ? pct(efficiency, 0) : '—'}
          caption="standard minutes against minutes paid"
          tone={efficiency == null ? 'neutral' : efficiency >= 0.6 ? 'ok' : efficiency >= 0.4 ? 'warn' : 'risk'}
        />
      </div>

      <Section title="Daily production">
        <LogTable<SewingRow>
          collection="sewing"
          rows={rows}
          fields={fields}
          derived={derivedColumns}
          validate={requireFields<SewingRow>(fields)}
          blank={() => ({
            date: today(), orderNo: '', line: '', operators: 0, hours: 8,
            block1: 0, block2: 0, block3: 0, issuedToLine: 0, remarks: '',
          })}
          sortBy={(a, b) => (b.date ?? '').localeCompare(a.date ?? '')}
          emptyTitle="No sewing logged yet"
        />
      </Section>
    </>
  )
}
