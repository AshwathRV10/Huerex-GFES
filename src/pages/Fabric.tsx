/**
 * Fabric — kilograms in, kilograms out, kilograms unexplained.
 *
 * Consumption is worked out from the piece weights recorded at cutting unless
 * somebody has weighed the leftovers and typed the real figure. The gap between
 * what was issued and what was consumed is wastage, and wastage is fabric the
 * costing has to charge to somebody.
 */
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Layers } from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { LogTable, type DerivedColumn, type FieldDef } from '../components/LogTable'
import { Badge, Button, Card, CardHeader, Section } from '../components/ui'
import { StatTile } from '../components/StatTile'
import { useDerived, useStore } from '../lib/store'
import { kg, pct, today } from '../lib/format'
import { colourField, dateField, fabricTypesOf, orderField } from './fields'
import type { FabricRow } from '../lib/types'

export default function Fabric() {
  const rows = useStore((s) => s.data.fabric)
  const settings = useStore((s) => s.settings)
  const { derived } = useDerived()

  const fields: FieldDef<FabricRow>[] = useMemo(() => [
    dateField<FabricRow>(),
    orderField<FabricRow>(),
    colourField<FabricRow>(),
    {
      kind: 'combo', key: 'fabricType', header: 'Fabric type', width: '10rem', required: true,
      list: 'fabricTypes', suggest: (draft) => fabricTypesOf(draft.orderNo),
    },
    { kind: 'number', key: 'receivedKg', header: 'Received', width: '6.5rem', decimals: 2, suffix: 'kg' },
    { kind: 'number', key: 'issuedKg', header: 'Issued', width: '6.5rem', decimals: 2, suffix: 'kg' },
    { kind: 'number', key: 'returnedKg', header: 'Returned', width: '6.5rem', decimals: 2, suffix: 'kg' },
    {
      kind: 'number', key: 'manualConsumedKg', header: 'Weighed', width: '6.5rem', decimals: 2, suffix: 'kg',
      note: 'overrides the calculation', hideBelow: 'lg',
    },
    { kind: 'text', key: 'remarks', header: 'Remarks', width: '10rem', hideBelow: 'lg' },
  ], [])

  const orderFabric = useMemo(() => {
    const map = new Map<string, ReturnType<typeof buildFabricFacts>>()
    for (const facts of derived.orders) map.set(facts.order.orderNo, buildFabricFacts(facts))
    return map
  }, [derived])

  const derivedColumns: DerivedColumn<FabricRow>[] = [
    {
      key: 'inStore', header: 'In store', align: 'right', width: '6.5rem',
      render: (row) => {
        const facts = orderFabric.get(row.orderNo)
        return facts ? kg(facts.inStore, 1) : '—'
      },
    },
    {
      key: 'consumed', header: 'Consumed', align: 'right', width: '6.5rem',
      render: (row) => {
        const facts = orderFabric.get(row.orderNo)
        return facts ? kg(facts.consumedKg, 1) : '—'
      },
    },
    {
      key: 'wastage', header: 'Wastage', align: 'right', width: '7.5rem',
      render: (row) => {
        const facts = orderFabric.get(row.orderNo)
        if (!facts || facts.wastagePct == null) return <span className="text-ink-3/50">·</span>
        return (
          <span className={facts.wastagePct > settings.fabricWastageThresholdPct ? 'text-warn font-medium' : ''}>
            {kg(facts.wastageKg, 1)} · {pct(facts.wastagePct, 1)}
          </span>
        )
      },
    },
    {
      key: 'status', header: 'Status', width: '12rem',
      render: (row) => {
        const facts = orderFabric.get(row.orderNo)
        if (!facts) return <Badge tone="risk">Order not found</Badge>
        if (facts.consumedKg === 0) return <Badge tone="neutral">Nothing cut yet</Badge>
        if (facts.wastagePct == null) return <Badge tone="neutral">Nothing issued</Badge>
        return facts.wastagePct > settings.fabricWastageThresholdPct
          ? <Badge tone="warn">Wastage over {pct(settings.fabricWastageThresholdPct, 0)}</Badge>
          : <Badge tone="ok">Within tolerance</Badge>
      },
    },
  ]

  const received = rows.reduce((a, b) => a + b.receivedKg, 0)
  const issued = rows.reduce((a, b) => a + b.issuedKg - b.returnedKg, 0)
  const consumed = derived.orders.reduce((a, o) => a + o.fabric.consumedKg, 0)
  const wastage = derived.orders.reduce((a, o) => a + o.fabric.wastageKg, 0)
  const overWastage = derived.orders.filter(
    (o) => o.fabric.wastagePct != null && o.fabric.wastagePct > settings.fabricWastageThresholdPct,
  )

  return (
    <>
      <PageHeader
        title="Fabric"
        subtitle="Tracked in kilograms, one row per movement. Consumption comes from the piece weights recorded at cutting; type a weighed figure to override it."
        actions={<Link to="/costing"><Button size="sm" variant="ghost">Cost the fabric</Button></Link>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatTile label="Received" value={kg(received, 1)} icon={<Layers className="size-4" />} />
        <StatTile label="Net issued" value={kg(issued, 1)} caption="issued less returned" />
        <StatTile label="Consumed" value={kg(consumed, 1)} caption="from cut pieces and their weights" />
        <StatTile
          label="Unaccounted" value={kg(wastage, 1)}
          caption={issued > 0 ? `${pct(wastage / issued, 1)} of what was issued` : 'nothing issued yet'}
          tone={overWastage.length ? 'warn' : 'ok'}
        />
      </div>

      {overWastage.length > 0 && (
        <Card className="mb-5">
          <CardHeader
            title="Wastage above tolerance"
            subtitle={`Over ${pct(settings.fabricWastageThresholdPct, 0)} of what was issued`}
          />
          <div className="divide-y divide-line">
            {overWastage.map((facts) => (
              <div key={facts.order.orderNo} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <Link to={`/orders/${encodeURIComponent(facts.order.orderNo)}`} className="text-sm text-ink hover:text-brand-600">
                  {facts.order.orderNo}
                  <span className="text-ink-3 ml-2 text-xs">{facts.order.buyer}</span>
                </Link>
                <span className="flex items-center gap-3 shrink-0">
                  <span className="num text-sm">{kg(facts.fabric.wastageKg, 1)}</span>
                  <Badge tone="warn">{pct(facts.fabric.wastagePct ?? 0, 1)}</Badge>
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Section title="Fabric movements">
        <LogTable<FabricRow>
          collection="fabric"
          rows={rows}
          fields={fields}
          derived={derivedColumns}
          validate={(draft) => {
            if (!draft.orderNo) return 'Order is required'
            if (!draft.colour) return 'Colour is required'
            if (!draft.fabricType) return 'Fabric type is required'
            if (!draft.receivedKg && !draft.issuedKg && !draft.returnedKg) {
              return 'Enter at least one of received, issued or returned'
            }
            return null
          }}
          blank={() => ({
            date: today(), orderNo: '', colour: '', fabricType: '',
            receivedKg: 0, issuedKg: 0, returnedKg: 0, manualConsumedKg: null, remarks: '',
          })}
          sortBy={(a, b) => (b.date ?? '').localeCompare(a.date ?? '')}
          emptyTitle="No fabric logged yet"
        />
      </Section>
    </>
  )
}

function buildFabricFacts(facts: { fabric: { receivedKg: number; issuedKg: number; returnedKg: number; consumedKg: number; wastageKg: number; wastagePct: number | null } }) {
  const { receivedKg, issuedKg, returnedKg, consumedKg, wastageKg, wastagePct } = facts.fabric
  return { inStore: receivedKg - issuedKg + returnedKg, consumedKg, wastageKg, wastagePct }
}
