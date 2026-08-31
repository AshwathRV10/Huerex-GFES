/**
 * Reconciliation — the identity that must always hold.
 *
 *   Cut = Shipped + Rejected + WIP
 *
 * If the difference is anything other than zero, a transaction is missing or
 * has been entered twice. No amount of dashboard polish is worth anything
 * until this balances.
 */
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ShieldCheck, TriangleAlert } from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { DataGrid, Qty, type Column } from '../components/DataGrid'
import { StatTile } from '../components/StatTile'
import { Badge, Callout, Card, CardHeader, Empty } from '../components/ui'
import { useDerived, useStore } from '../lib/store'
import { num } from '../lib/format'
import type { OrderFacts } from '../lib/engine/production'

export default function Reconciliation() {
  const { derived } = useDerived()
  const state = useStore((s) => s.data)

  const rows = derived.orders.filter((o) => o.cumCut > 0 || o.order.status === 'Active')
  const outOfBalance = rows.filter((o) => !o.reconciliation.balanced && o.cumCut > 0)

  /** The entries that most often break the identity, so they can be found fast. */
  const audit = useMemo(() => {
    const orderNumbers = new Set(state.orders.map((o) => o.orderNo))
    const cellKeys = new Set(state.matrix.map((m) => `${m.orderNo} ${m.colour} ${m.size}`))

    const orphans: { sheet: string; detail: string }[] = []
    const check = (sheet: string, rows: { orderNo: string; colour?: string; size?: string }[]) => {
      for (const row of rows) {
        if (!orderNumbers.has(row.orderNo)) {
          orphans.push({ sheet, detail: `${row.orderNo} is not on the order book` })
        } else if (row.colour !== undefined && row.size !== undefined &&
          !cellKeys.has(`${row.orderNo} ${row.colour} ${row.size}`)) {
          orphans.push({ sheet, detail: `${row.orderNo} · ${row.colour} · ${row.size} is not in the size breakdown` })
        }
      }
    }
    check('Cutting', state.cutting)
    check('Fusing', state.fusing)
    check('Job work', state.jobwork)
    check('Checking', state.checking)
    check('Packing', state.packing)
    check('Shipment', state.shipment)
    check('Fabric', state.fabric.map((r) => ({ orderNo: r.orderNo })))
    check('Trims', state.trims.map((r) => ({ orderNo: r.orderNo })))
    check('Sewing', state.sewing.map((r) => ({ orderNo: r.orderNo })))

    const tallyErrors = state.checking.filter(
      (r) => r.checkedQty !== r.passQty + r.alterQty + r.rejectQty,
    )
    const noRoute = derived.orders.filter((o) => o.route.processes.length === 0)
    const routeErrors = derived.orders.filter((o) => o.route.issues.length > 0)
    const matrixGap = derived.orders.filter((o) => o.variance !== 0 && o.order.status === 'Active')

    // Collapse duplicates so the same missing order is not listed twenty times.
    const uniqueOrphans = [...new Map(orphans.map((o) => [`${o.sheet}|${o.detail}`, o])).values()]
    return { orphans: uniqueOrphans, tallyErrors, noRoute, routeErrors, matrixGap }
  }, [state, derived])

  const columns: Column<OrderFacts>[] = [
    {
      key: 'order', header: 'Order', width: '10rem', sticky: true,
      value: (o) => o.order.orderNo,
      render: (o) => (
        <Link to={`/orders/${encodeURIComponent(o.order.orderNo)}`} className="text-sm text-ink hover:text-brand-600">
          {o.order.orderNo}
        </Link>
      ),
    },
    {
      key: 'buyer', header: 'Buyer', width: '12rem', hideBelow: 'md',
      value: (o) => o.order.buyer,
      render: (o) => <span className="text-sm text-ink-2 truncate block">{o.order.buyer}</span>,
    },
    {
      key: 'status', header: 'Status', width: '7rem', hideBelow: 'lg',
      value: (o) => o.order.status,
      render: (o) => <Badge tone={o.order.status === 'Active' ? 'ok' : 'neutral'}>{o.order.status}</Badge>,
    },
    { key: 'ordered', header: 'Ordered', align: 'right', width: '6.5rem', value: (o) => o.order.orderQty, render: (o) => <Qty value={o.order.orderQty} /> },
    { key: 'cut', header: 'Cut', align: 'right', width: '6rem', derived: true, value: (o) => o.cumCut, render: (o) => <Qty value={o.cumCut} /> },
    { key: 'shipped', header: 'Shipped', align: 'right', width: '6.5rem', derived: true, value: (o) => o.cumShipped, render: (o) => <Qty value={o.cumShipped} /> },
    { key: 'rejected', header: 'Rejected', align: 'right', width: '6.5rem', derived: true, value: (o) => o.cumReject, render: (o) => <Qty value={o.cumReject} /> },
    { key: 'wip', header: 'WIP', align: 'right', width: '6rem', derived: true, value: (o) => o.totalWip, render: (o) => <Qty value={o.totalWip} /> },
    {
      key: 'accounted', header: 'Accounted', align: 'right', width: '7rem', derived: true,
      value: (o) => o.reconciliation.accounted,
      render: (o) => <Qty value={o.reconciliation.accounted} />,
    },
    {
      key: 'difference', header: 'Difference', align: 'right', width: '7rem', derived: true,
      value: (o) => Math.abs(o.reconciliation.difference),
      render: (o) => o.reconciliation.difference === 0
        ? <span className="text-ok num text-sm">0</span>
        : <span className="text-risk num text-sm font-semibold">
            {o.reconciliation.difference > 0 ? '+' : '−'}{num(Math.abs(o.reconciliation.difference))}
          </span>,
    },
    {
      key: 'verdict', header: 'Verdict', width: '20rem', derived: true,
      value: (o) => o.reconciliation.verdict,
      render: (o) => (
        <span className={`text-sm ${o.reconciliation.balanced ? 'text-ink-2' : 'text-risk'}`}>
          {o.reconciliation.verdict}
        </span>
      ),
    },
  ]

  const auditIssues =
    audit.orphans.length + audit.tallyErrors.length + audit.noRoute.length +
    audit.routeErrors.length + audit.matrixGap.length

  return (
    <>
      <PageHeader
        title="Reconciliation"
        subtitle="Cut = Shipped + Rejected + WIP. If a difference is anything other than zero, an entry behind it is wrong — this page finds it."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatTile
          label="Balanced" value={num(rows.filter((o) => o.reconciliation.balanced && o.cumCut > 0).length)}
          tone="ok" icon={<ShieldCheck className="size-4" />}
        />
        <StatTile
          label="Out of balance" value={num(outOfBalance.length)}
          tone={outOfBalance.length ? 'risk' : 'ok'} icon={<TriangleAlert className="size-4" />}
        />
        <StatTile
          label="Pieces unexplained"
          value={num(outOfBalance.reduce((a, b) => a + Math.abs(b.reconciliation.difference), 0))}
          tone={outOfBalance.length ? 'risk' : 'ok'}
        />
        <StatTile
          label="Data audit findings" value={num(auditIssues)}
          tone={auditIssues ? 'warn' : 'ok'}
        />
      </div>

      {outOfBalance.length === 0 && rows.some((o) => o.cumCut > 0) && (
        <Callout tone="ok" title="Every cut piece is accounted for">
          Across every order with production against it, cut equals shipped plus rejected plus work in
          progress. The numbers on the dashboard can be trusted.
        </Callout>
      )}

      <div className="mt-5">
        <DataGrid
          rows={rows}
          columns={columns}
          rowKey={(o) => o.order.orderNo}
          searchable
          defaultSort={{ key: 'difference', direction: 'desc' }}
          rowTone={(o) => (o.reconciliation.balanced ? null : 'risk')}
          empty={<Empty title="Nothing to reconcile" detail="No order has any production logged against it yet." />}
        />
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Data audit"
          subtitle="A clean audit does not mean the numbers are right — it means nothing is obviously broken."
        />
        {auditIssues === 0 ? (
          <Empty icon={<ShieldCheck className="size-5" />} title="Nothing to flag" detail="Every entry points at a real order, every checking row tallies, and every live order has a route and a size breakdown." />
        ) : (
          <div className="divide-y divide-line">
            <AuditRow
              title="Entries pointing at something that does not exist"
              count={audit.orphans.length}
              detail={audit.orphans.slice(0, 6).map((o) => `${o.sheet}: ${o.detail}`)}
              fix="Correct the order number, colour or size on the entry, or add the missing row to the size breakdown."
            />
            <AuditRow
              title="Checking rows that do not tally"
              count={audit.tallyErrors.length}
              detail={audit.tallyErrors.slice(0, 6).map((r) => `${r.orderNo} · ${r.colour} · ${r.size}: checked ${r.checkedQty} against ${r.passQty + r.alterQty + r.rejectQty}`)}
              fix="Checked must equal pass plus alter plus reject."
            />
            <AuditRow
              title="Live orders with no route"
              count={audit.noRoute.length}
              detail={audit.noRoute.map((o) => o.order.orderNo)}
              fix="Nothing calculates for an order until its steps are listed."
            />
            <AuditRow
              title="Routes with a problem"
              count={audit.routeErrors.length}
              detail={audit.routeErrors.map((o) => `${o.order.orderNo}: ${o.route.issues.join('; ')}`)}
              fix="Open the order's route tab and fix the sequence."
            />
            <AuditRow
              title="Size breakdown does not add up to the order"
              count={audit.matrixGap.length}
              detail={audit.matrixGap.map((o) => `${o.order.orderNo}: ${o.variance > 0 ? '+' : '−'}${Math.abs(o.variance)} pcs`)}
              fix="The colour and size rows must add up to the order quantity."
            />
          </div>
        )}
      </Card>
    </>
  )
}

function AuditRow({
  title, count, detail, fix,
}: { title: string; count: number; detail: string[]; fix: string }) {
  if (count === 0) return null
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-2.5">
        <Badge tone="warn">{count}</Badge>
        <p className="text-sm font-medium text-ink">{title}</p>
      </div>
      <ul className="mt-1.5 ml-1 space-y-0.5 text-xs text-ink-2">
        {detail.slice(0, 6).map((line) => <li key={line}>· {line}</li>)}
        {detail.length > 6 && <li className="text-ink-3">· and {detail.length - 6} more</li>}
      </ul>
      <p className="mt-1.5 text-xs text-ink-3">{fix}</p>
    </div>
  )
}
