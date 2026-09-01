/**
 * Shipment — the last movement, and the one that closes the order.
 *
 * Excess ships with the order, so shipped quantity is expected to run over the
 * booked quantity. This page shows by how much, and whether it lands inside the
 * excess the buyer has agreed to.
 */
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Container } from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { LogTable, type DerivedColumn, type FieldDef } from '../components/LogTable'
import { Badge, Button, Callout, Card, CardHeader, Section, Tooltip } from '../components/ui'
import { StatTile } from '../components/StatTile'
import { useDerived, useStore } from '../lib/store'
import { usePermission } from '../components/Gate'
import { num, pct, today } from '../lib/format'
import { colourField, dateField, orderField, requireFields, sizeField } from './fields'
import type { ShipmentRow } from '../lib/types'

export default function Shipment() {
  const rows = useStore((s) => s.data.shipment)
  const orders = useStore((s) => s.data.orders)
  const buyers = useStore((s) => s.data.buyers)
  const inspections = useStore((s) => s.data.inspection)
  const { derived } = useDerived()
  const showCosting = usePermission('costing.view')

  const fields: FieldDef<ShipmentRow>[] = useMemo(() => [
    dateField<ShipmentRow>(),
    orderField<ShipmentRow>(),
    colourField<ShipmentRow>(),
    sizeField<ShipmentRow>(),
    { kind: 'number', key: 'shipQty', header: 'Ship qty', width: '6.5rem', required: true },
    { kind: 'text', key: 'invoiceNo', header: 'Invoice no', width: '8rem' },
    { kind: 'text', key: 'buyerPoNo', header: 'Buyer PO', width: '8rem', hideBelow: 'lg' },
    { kind: 'number', key: 'cartons', header: 'Cartons', width: '5.5rem', hideBelow: 'md' },
    { kind: 'number', key: 'grossWtKg', header: 'Gross wt', width: '6rem', decimals: 2, suffix: 'kg', hideBelow: 'lg' },
    { kind: 'number', key: 'netWtKg', header: 'Net wt', width: '6rem', decimals: 2, suffix: 'kg', hideBelow: 'lg' },
    { kind: 'text', key: 'remarks', header: 'Remarks', width: '9rem', hideBelow: 'lg' },
  ], [])

  const inspectionPassed = useMemo(() => {
    const passed = new Set<string>()
    for (const row of inspections) if (row.result === 'Pass') passed.add(row.orderNo)
    return passed
  }, [inspections])

  const cellFacts = useMemo(() => {
    const map = new Map<string, { available: number; shipped: number; ordered: number }>()
    for (const cell of derived.cells) {
      map.set(`${cell.orderNo} ${cell.colour} ${cell.size}`, {
        available: cell.cumShipped + cell.packedNotShipped,
        shipped: cell.cumShipped,
        ordered: cell.orderQty,
      })
    }
    return map
  }, [derived])

  const derivedColumns: DerivedColumn<ShipmentRow>[] = [
    {
      key: 'available', header: 'Packed avail', align: 'right', width: '7rem',
      render: (row) => num(cellFacts.get(`${row.orderNo} ${row.colour} ${row.size}`)?.available),
    },
    {
      key: 'cum', header: 'Cum shipped', align: 'right', width: '7rem',
      render: (row) => num(cellFacts.get(`${row.orderNo} ${row.colour} ${row.size}`)?.shipped),
    },
    {
      key: 'vsOrder', header: 'vs order', align: 'right', width: '6.5rem',
      render: (row) => {
        const facts = cellFacts.get(`${row.orderNo} ${row.colour} ${row.size}`)
        if (!facts?.ordered) return <span className="text-ink-3/50">·</span>
        return pct(facts.shipped / facts.ordered, 0)
      },
    },
    {
      key: 'gate', header: 'Status', width: '12rem',
      render: (row) => {
        const facts = derived.byOrderNo.get(row.orderNo)
        if (!facts) return <Badge tone="risk">Order not found</Badge>
        if (facts.route.has('Inspection') && !inspectionPassed.has(row.orderNo)) {
          return <Badge tone="risk">Shipped before inspection passed</Badge>
        }
        const cell = cellFacts.get(`${row.orderNo} ${row.colour} ${row.size}`)
        if (!cell) return <Badge tone="risk">Not in the size breakdown</Badge>
        const balance = cell.available - cell.shipped
        return balance > 0
          ? <Badge tone="neutral">{num(balance)} still to ship</Badge>
          : <Badge tone="ok">Nothing left packed</Badge>
      },
    },
  ]

  const shipped = rows.reduce((a, b) => a + b.shipQty, 0)
  const cartons = rows.reduce((a, b) => a + b.cartons, 0)

  /** Shipped against ordered, per order, with the buyer's agreed excess. */
  const excessView = useMemo(() => {
    const buyerByName = new Map(buyers.map((b) => [b.name, b]))
    return orders
      .map((order) => {
        const facts = derived.byOrderNo.get(order.orderNo)
        const buyer = buyerByName.get(order.buyer)
        const agreedPct = order.excessPct ?? buyer?.excessPct ?? 0
        const shippedQty = facts?.cumShipped ?? 0
        const over = shippedQty - order.orderQty
        return {
          order,
          shippedQty,
          over,
          agreedPct,
          agreedQty: Math.round(order.orderQty * agreedPct),
          excessSet: order.excessPct != null || buyer?.excessPctSet === true,
        }
      })
      .filter((row) => row.shippedQty > 0)
      .sort((a, b) => b.over - a.over)
  }, [orders, buyers, derived])

  const beyondAgreed = excessView.filter((row) => row.over > row.agreedQty)

  return (
    <>
      <PageHeader
        title="Shipment"
        subtitle="Excess ships with the order, so shipped quantity is meant to run over what was booked. What matters is whether it stays inside what the buyer agreed."
        actions={showCosting
          ? <Link to="/buyers"><Button size="sm" variant="ghost">Set buyer excess</Button></Link>
          : undefined}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatTile label="Shipped" value={num(shipped)} caption="pcs out the gate" tone="ok" icon={<Container className="size-4" />} />
        <StatTile label="Cartons" value={num(cartons)} />
        <StatTile label="Invoices" value={num(new Set(rows.map((r) => r.invoiceNo).filter(Boolean)).size)} />
        {showCosting ? (
          <StatTile
            label="Over the agreed excess" value={num(beyondAgreed.length)}
            caption={beyondAgreed.length ? 'orders shipped beyond what was agreed' : 'every shipment is inside its excess'}
            tone={beyondAgreed.length ? 'warn' : 'ok'}
          />
        ) : (
          <StatTile label="Entries" value={num(rows.length)} caption="dispatch rows logged" />
        )}
      </div>

      {showCosting && excessView.some((row) => !row.excessSet) && (
        <Callout tone="warn" title="Some buyers have no excess percentage set">
          Excess differs buyer to buyer and the costing cannot tell a planned overship from an accident until
          it is recorded. <Link to="/buyers" className="underline">Set it on the buyers page</Link>.
        </Callout>
      )}

      {showCosting && excessView.length > 0 && (
        <Card className="mt-5">
          <CardHeader title="Excess against the order" subtitle="Shipped pieces beyond the booked quantity, next to the excess the buyer agreed to" />
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="sticky-head">
                <tr className="text-2xs font-semibold uppercase tracking-[0.06em] text-ink-3">
                  <th className="text-left px-3 py-2">Order</th>
                  <th className="text-left px-3 py-2 hidden md:table-cell">Buyer</th>
                  <th className="text-right px-3 py-2">Ordered</th>
                  <th className="text-right px-3 py-2">Shipped</th>
                  <th className="text-right px-3 py-2">Excess</th>
                  <th className="text-right px-3 py-2">Agreed</th>
                  <th className="text-left px-3 py-2 w-40">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {excessView.map((row) => (
                  <tr key={row.order.orderNo} className="border-b border-line/70 last:border-0 grid-row-hover">
                    <td className="px-3 py-2">
                      <Link to={`/orders/${encodeURIComponent(row.order.orderNo)}`} className="text-sm text-ink hover:text-brand-600">
                        {row.order.orderNo}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-sm text-ink-2 hidden md:table-cell truncate max-w-[12rem]">{row.order.buyer}</td>
                    <td className="px-3 py-2 text-right num text-sm">{num(row.order.orderQty)}</td>
                    <td className="px-3 py-2 text-right num text-sm">{num(row.shippedQty)}</td>
                    <td className="px-3 py-2 text-right num text-sm">
                      {row.over > 0
                        ? <span className="text-saffron">+{num(row.over)}</span>
                        : row.over < 0 ? <span className="text-ink-3">{num(row.over)}</span> : <span className="text-ink-3/50">·</span>}
                    </td>
                    <td className="px-3 py-2 text-right num text-sm text-ink-3">
                      {row.excessSet ? `${num(row.agreedQty)} · ${pct(row.agreedPct, 1)}` : '—'}
                    </td>
                    <td className="px-3 py-2">
                      {!row.excessSet ? <Badge tone="warn">Excess not set</Badge>
                        : row.over > row.agreedQty ? (
                          <Tooltip label={`${num(row.over - row.agreedQty)} pcs beyond the agreed excess`}>
                            <Badge tone="risk">Over the agreement</Badge>
                          </Tooltip>
                        )
                        : row.shippedQty < row.order.orderQty ? <Badge tone="neutral">Still shipping</Badge>
                        : <Badge tone="ok">Inside the excess</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Section title="Dispatch log" className="mt-5">
        <LogTable<ShipmentRow>
          collection="shipment"
          rows={rows}
          fields={fields}
          derived={derivedColumns}
          validate={requireFields<ShipmentRow>(fields)}
          blank={() => ({
            date: today(), orderNo: '', colour: '', size: '', shipQty: 0, invoiceNo: '',
            buyerPoNo: '', cartons: 0, grossWtKg: 0, netWtKg: 0, remarks: '',
          })}
          sortBy={(a, b) => (b.date ?? '').localeCompare(a.date ?? '')}
          emptyTitle="Nothing shipped yet"
        />
      </Section>
    </>
  )
}
