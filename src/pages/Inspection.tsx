/** Final inspection — the gate in front of shipment. */
import { useMemo } from 'react'
import { ClipboardCheck } from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { LogTable, type DerivedColumn, type FieldDef } from '../components/LogTable'
import { Badge, Section } from '../components/ui'
import { StatTile } from '../components/StatTile'
import { useDerived, useStore } from '../lib/store'
import { num, today } from '../lib/format'
import { orderField, requireFields } from './fields'
import type { InspectionRow } from '../lib/types'

export default function Inspection() {
  const rows = useStore((s) => s.data.inspection)
  const { derived } = useDerived()

  const fields: FieldDef<InspectionRow>[] = useMemo(() => [
    { kind: 'date', key: 'inspectionDate', header: 'Inspection date', width: '9rem', required: true },
    orderField<InspectionRow>(),
    { kind: 'number', key: 'offeredQty', header: 'Offered qty', width: '7rem', required: true },
    {
      kind: 'select', key: 'result', header: 'Result', width: '7rem', required: true,
      options: [
        { value: 'Pending', label: 'Pending' },
        { value: 'Pass', label: 'Pass' },
        { value: 'Fail', label: 'Fail' },
        { value: 'Not Required', label: 'Not required' },
      ],
    },
    { kind: 'text', key: 'aql', header: 'AQL', width: '6rem' },
    { kind: 'combo', key: 'inspector', header: 'Inspector / agency', width: '11rem', list: 'inspectors' },
    { kind: 'text', key: 'remarks', header: 'Remarks', width: '12rem', hideBelow: 'lg' },
  ], [])

  const derivedColumns: DerivedColumn<InspectionRow>[] = [
    {
      key: 'inRoute', header: 'In route?', width: '7rem',
      render: (row) => derived.byOrderNo.get(row.orderNo)?.route.has('Inspection')
        ? <Badge tone="ok">Yes</Badge>
        : <Badge tone="neutral">Not routed</Badge>,
    },
    {
      key: 'gate', header: 'Shipment gate', width: '13rem',
      render: (row) => {
        const facts = derived.byOrderNo.get(row.orderNo)
        if (!facts) return <Badge tone="risk">Order not found</Badge>
        if (!facts.route.has('Inspection')) return <Badge tone="neutral">Shipment is open</Badge>
        if (row.result === 'Pass') return <Badge tone="ok">Open — inspection passed</Badge>
        if (row.result === 'Fail') return <Badge tone="risk">Closed — inspection failed</Badge>
        return <Badge tone="warn">Closed until a result is recorded</Badge>
      },
    },
    {
      key: 'packed', header: 'Packed waiting', align: 'right', width: '7.5rem',
      render: (row) => {
        const facts = derived.byOrderNo.get(row.orderNo)
        if (!facts) return '—'
        return num(Math.max(0, facts.cumPacked - facts.cumShipped))
      },
    },
  ]

  const passed = rows.filter((r) => r.result === 'Pass').length
  const failed = rows.filter((r) => r.result === 'Fail').length
  const pending = rows.filter((r) => r.result === 'Pending' || !r.result).length

  const blocked = derived.orders.filter(
    (o) => o.route.has('Inspection') && o.cumPacked > o.cumShipped &&
      !rows.some((r) => r.orderNo === o.order.orderNo && r.result === 'Pass'),
  )

  return (
    <>
      <PageHeader
        title="Final inspection"
        subtitle="If inspection is in an order's route, nothing ships until a pass is recorded here."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatTile label="Passed" value={num(passed)} tone="ok" icon={<ClipboardCheck className="size-4" />} />
        <StatTile label="Failed" value={num(failed)} tone={failed ? 'risk' : 'neutral'} />
        <StatTile label="Pending" value={num(pending)} tone={pending ? 'warn' : 'neutral'} />
        <StatTile
          label="Orders held at the gate" value={num(blocked.length)}
          caption={blocked.length ? blocked.map((o) => o.order.orderNo).join(', ') : 'nothing waiting'}
          tone={blocked.length ? 'risk' : 'ok'}
        />
      </div>

      <Section title="Inspections">
        <LogTable<InspectionRow>
          collection="inspection"
          rows={rows}
          fields={fields}
          derived={derivedColumns}
          validate={requireFields<InspectionRow>(fields)}
          blank={() => ({
            orderNo: '', inspectionDate: today(), offeredQty: 0,
            result: 'Pending', aql: '', inspector: '', remarks: '',
          })}
          sortBy={(a, b) => (b.inspectionDate ?? '').localeCompare(a.inspectionDate ?? '')}
          rowTone={(row) => (row.result === 'Fail' ? 'risk' : row.result === 'Pass' ? 'ok' : null)}
          emptyTitle="No inspection recorded"
          emptyDetail="Book an inspection and record the result here. Orders whose route includes inspection cannot ship until it passes."
        />
      </Section>
    </>
  )
}
