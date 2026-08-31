/**
 * The order book. One row per order, with its setup health, its progress and
 * its margin all on the same line.
 */
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Shirt, TriangleAlert } from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { DataGrid, type Column } from '../components/DataGrid'
import { SmartCombo } from '../components/SmartCombo'
import {
  Badge, Button, Callout, Field, Modal, Meter, Segmented, Tooltip,
} from '../components/ui'
import { StatTile } from '../components/StatTile'
import { useComboStats } from '../hooks/useComboStats'
import { useCostSummary } from '../hooks/useCostSummary'
import { useDerived, useStore } from '../lib/store'
import { money, num, pct, shortDate, today } from '../lib/format'
import type { OrderFacts } from '../lib/engine/production'
import type { Order } from '../lib/types'

type StatusFilter = 'all' | 'Active' | 'On Hold' | 'Closed'

export default function Orders() {
  const { derived } = useDerived()
  const cost = useCostSummary()
  const [filter, setFilter] = useState<StatusFilter>('Active')
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()

  const rows = useMemo(
    () => derived.orders.filter((o) => filter === 'all' || o.order.status === filter),
    [derived.orders, filter],
  )

  const needSetup = derived.orders.filter((o) => o.order.status === 'Active' && o.setupCheck !== 'OK')
  const needCosting = derived.orders.filter(
    (o) => o.order.status === 'Active' && !cost.byOrder.has(o.order.orderNo),
  )

  const columns: Column<OrderFacts>[] = [
    {
      key: 'orderNo', header: 'Order', width: '11rem', sticky: true,
      value: (r) => r.order.orderNo,
      render: (r) => (
        <>
          <Link
            to={`/orders/${encodeURIComponent(r.order.orderNo)}`}
            className="text-sm font-medium text-ink hover:text-brand-600 transition-colors"
          >
            {r.order.orderNo}
          </Link>
          <span className="block text-2xs text-ink-3 truncate">{r.order.styleCode}</span>
        </>
      ),
    },
    {
      key: 'buyer', header: 'Buyer', width: '12rem', hideBelow: 'md',
      value: (r) => r.order.buyer,
      render: (r) => <span className="text-sm text-ink-2 truncate block">{r.order.buyer}</span>,
    },
    {
      key: 'style', header: 'Style', width: '13rem', hideBelow: 'lg',
      value: (r) => r.order.styleName,
      render: (r) => <span className="text-sm text-ink-2 truncate block">{r.order.styleName || '—'}</span>,
    },
    {
      key: 'qty', header: 'Order qty', align: 'right', width: '6.5rem',
      value: (r) => r.order.orderQty,
      render: (r) => <span className="text-sm">{num(r.order.orderQty)}</span>,
    },
    {
      key: 'progress', header: 'Shipped', width: '9rem',
      value: (r) => r.shippedPct,
      render: (r) => (
        <Tooltip label={`${num(r.cumShipped)} of ${num(r.order.orderQty)} shipped`}>
          <span className="block w-full">
            <Meter value={r.cumShipped} max={r.order.orderQty || 1} tone={r.shippedPct >= 1 ? 'ok' : 'brand'} />
            <span className="block text-2xs text-ink-3 mt-1 num">{pct(r.shippedPct, 0)}</span>
          </span>
        </Tooltip>
      ),
    },
    {
      key: 'wip', header: 'WIP', align: 'right', width: '6rem', derived: true, hideBelow: 'md',
      value: (r) => r.totalWip,
      render: (r) => (r.totalWip ? <span className={r.agedWip ? 'text-warn' : ''}>{num(r.totalWip)}</span> : <span className="text-ink-3/50">·</span>),
    },
    {
      key: 'exf', header: 'Ex-factory', align: 'right', width: '8rem',
      value: (r) => r.order.exFactoryDate,
      render: (r) => {
        const late = (r.daysToExFactory ?? 1) < 0 && r.cumShipped < r.order.orderQty
        return (
          <span className={late ? 'text-risk font-medium text-sm' : 'text-sm text-ink-2'}>
            {shortDate(r.order.exFactoryDate)}
            {r.daysToExFactory != null && (
              <span className="block text-2xs text-ink-3 num">
                {r.daysToExFactory >= 0 ? `${r.daysToExFactory}d left` : `${-r.daysToExFactory}d over`}
              </span>
            )}
          </span>
        )
      },
    },
    {
      key: 'price', header: 'Price / pc', align: 'right', width: '7rem', hideBelow: 'lg',
      value: (r) => r.order.sellingPrice ?? -1,
      render: (r) => r.order.sellingPrice != null
        ? <span className="text-sm">{money(r.order.sellingPrice, r.order.currency)}</span>
        : <Link to={`/costing/${encodeURIComponent(r.order.orderNo)}`} className="text-xs text-brand-600 hover:underline">set price</Link>,
    },
    {
      key: 'cost', header: 'Cost / pc', align: 'right', width: '7rem', derived: true,
      value: (r) => cost.byOrder.get(r.order.orderNo)?.planned.costPerShippedPc ?? -1,
      render: (r) => {
        const entry = cost.byOrder.get(r.order.orderNo)
        if (!entry || entry.planned.totalCost === 0) {
          return <Link to={`/costing/${encodeURIComponent(r.order.orderNo)}`} className="text-xs text-brand-600 hover:underline">cost it</Link>
        }
        const result = entry.actual ?? entry.planned
        return <span className="text-sm">{money(result.costPerShippedPc, result.currency)}</span>
      },
    },
    {
      key: 'margin', header: 'Margin', align: 'right', width: '6.5rem', derived: true,
      value: (r) => cost.byOrder.get(r.order.orderNo)?.planned.marginPct ?? -99,
      render: (r) => {
        const entry = cost.byOrder.get(r.order.orderNo)
        const result = entry?.actual ?? entry?.planned
        if (!result || result.sellingPrice == null || result.totalCost === 0) {
          return <span className="text-ink-3/50">—</span>
        }
        return (
          <Tooltip label={`${money(result.margin, result.currency)} across ${num(result.quantities.invoiced)} invoiced pcs`}>
            <Badge tone={result.margin < 0 ? 'risk' : (result.marginPct ?? 0) < 0.08 ? 'warn' : 'ok'}>
              {pct(result.marginPct ?? 0, 1)}
            </Badge>
          </Tooltip>
        )
      },
    },
    {
      key: 'setup', header: 'Setup', width: '13rem', derived: true, hideBelow: 'lg',
      value: (r) => r.setupCheck,
      render: (r) => r.setupCheck === 'OK'
        ? <Badge tone="ok">OK</Badge>
        : (
          <Tooltip label={r.setupIssues.join(' · ')}>
            <Badge tone="warn">{r.setupIssues.length} to fix</Badge>
          </Tooltip>
        ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Orders"
        subtitle="The master record. Everything else in the system hangs off these rows."
        actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New order</Button>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatTile label="Live orders" value={num(derived.orders.filter((o) => o.order.status === 'Active').length)} icon={<Shirt className="size-4" />} />
        <StatTile label="Committed" value={num(derived.totals.orderQty)} caption="pcs across live orders" />
        <StatTile
          label="Setup incomplete" value={num(needSetup.length)}
          tone={needSetup.length ? 'warn' : 'ok'} icon={<TriangleAlert className="size-4" />}
        />
        <StatTile
          label="Not costed" value={num(needCosting.length)}
          tone={needCosting.length ? 'warn' : 'ok'} to="/costing"
        />
      </div>

      {needSetup.length > 0 && (
        <Callout tone="warn" title={`${needSetup.length} live order${needSetup.length > 1 ? 's are' : ' is'} not fully set up`}>
          Until the route and size breakdown are in, the WIP, alerts and reconciliation for{' '}
          {needSetup.slice(0, 4).map((o) => o.order.orderNo).join(', ')}
          {needSetup.length > 4 ? ` and ${needSetup.length - 4} more` : ''} cannot be trusted.
        </Callout>
      )}

      <div className="mt-5">
        <DataGrid
          rows={rows}
          columns={columns}
          rowKey={(r) => r.order.orderNo}
          searchable
          searchPlaceholder="Search order, buyer or style…"
          onRowClick={(r) => navigate(`/orders/${encodeURIComponent(r.order.orderNo)}`)}
          rowTone={(r) => {
            if ((r.daysToExFactory ?? 1) < 0 && r.cumShipped < r.order.orderQty) return 'risk'
            if (r.setupCheck !== 'OK' && r.order.status === 'Active') return 'warn'
            return null
          }}
          toolbar={
            <Segmented
              size="sm"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'Active', label: 'Active' },
                { value: 'On Hold', label: 'On hold' },
                { value: 'Closed', label: 'Closed' },
                { value: 'all', label: 'All' },
              ]}
            />
          }
        />
      </div>

      <NewOrderModal open={creating} onClose={() => setCreating(false)} />
    </>
  )
}

/* ── New order ───────────────────────────────────────────────────────── */

function NewOrderModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const add = useStore((s) => s.add)
  const orders = useStore((s) => s.data.orders)
  const buyers = useStore((s) => s.data.buyers)
  const settings = useStore((s) => s.settings)
  const navigate = useNavigate()

  const buyerStats = useComboStats('buyers')
  const styleStats = useComboStats('styles')
  const teamStats = useComboStats('team')

  const [draft, setDraft] = useState(() => blankOrder())
  const [saving, setSaving] = useState(false)

  const duplicate = orders.some((o) => o.orderNo.toLowerCase() === draft.orderNo.trim().toLowerCase())
  const problem =
    !draft.orderNo.trim() ? 'An order number is required'
    : duplicate ? `${draft.orderNo} already exists`
    : !draft.buyer ? 'A buyer is required'
    : !draft.orderQty ? 'An order quantity is required'
    : null

  const buyer = buyers.find((b) => b.name === draft.buyer)

  const save = async () => {
    if (problem) return
    setSaving(true)
    try {
      await add('orders', {
        ...draft,
        orderNo: draft.orderNo.trim(),
        currency: buyer?.currency ?? settings.currency ?? 'INR',
      })
      onClose()
      setDraft(blankOrder())
      navigate(`/orders/${encodeURIComponent(draft.orderNo.trim())}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New order"
      subtitle="Only the essentials here. The route and the size breakdown come next, on the order's own page."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={!!problem}>
            Create and open
          </Button>
        </>
      }
    >
      <div className="grid sm:grid-cols-2 gap-4">
        <Field
          label="Order number"
          value={draft.orderNo}
          onChange={(e) => setDraft({ ...draft, orderNo: e.target.value })}
          placeholder="HR-017"
          error={duplicate ? 'That order number is already in use' : undefined}
          autoFocus
        />
        <SmartCombo
          label="Buyer"
          list="buyers"
          stats={buyerStats}
          value={draft.buyer}
          onChange={(buyerName) => setDraft({ ...draft, buyer: buyerName })}
        />
        <SmartCombo
          label="Style code"
          list="styles"
          stats={styleStats}
          value={draft.styleCode}
          onChange={(styleCode) => setDraft({ ...draft, styleCode })}
        />
        <Field
          label="Style description"
          value={draft.styleName}
          onChange={(e) => setDraft({ ...draft, styleName: e.target.value })}
          placeholder="GIRLS FULL SLEEVE"
        />
        <Field
          label="Order quantity"
          value={draft.orderQty || ''}
          inputMode="numeric"
          onChange={(e) => setDraft({ ...draft, orderQty: Number(e.target.value) || 0 })}
          suffix="pcs"
        />
        <Field
          label="Price quoted to the buyer"
          value={draft.sellingPrice ?? ''}
          inputMode="decimal"
          prefix="₹"
          hint="Optional now — you can set it on the costing"
          onChange={(e) => setDraft({ ...draft, sellingPrice: e.target.value === '' ? null : Number(e.target.value) })}
        />
        <Field
          label="Order date" type="date" value={draft.orderDate}
          onChange={(e) => setDraft({ ...draft, orderDate: e.target.value })}
        />
        <Field
          label="Ex-factory date" type="date" value={draft.exFactoryDate}
          onChange={(e) => setDraft({ ...draft, exFactoryDate: e.target.value })}
        />
        <Field
          label="SAM" value={draft.sam || ''} inputMode="decimal" suffix="min/pc"
          hint="Standard minutes per piece — drives efficiency"
          onChange={(e) => setDraft({ ...draft, sam: Number(e.target.value) || 0 })}
        />
        <Field
          label="Cutting buffer" value={(draft.bufferPct * 100) || ''} inputMode="decimal" suffix="%"
          hint="Extra cut against each size"
          onChange={(e) => setDraft({ ...draft, bufferPct: (Number(e.target.value) || 0) / 100 })}
        />
        <SmartCombo
          label="Merchandiser" list="team" stats={teamStats}
          value={draft.merchandiser}
          onChange={(merchandiser) => setDraft({ ...draft, merchandiser })}
        />
        <SmartCombo
          label="Planner" list="team" stats={teamStats}
          value={draft.planner}
          onChange={(planner) => setDraft({ ...draft, planner })}
        />
      </div>

      {buyer && !buyer.excessPctSet && (
        <Callout tone="warn" title={`${buyer.name} has no excess percentage set`}>
          Excess ships with the order and differs buyer to buyer. Set it on the buyers page so the costing
          knows how many pieces really leave the gate.
        </Callout>
      )}
    </Modal>
  )
}

function blankOrder(): Omit<Order, 'id'> {
  return {
    orderNo: '', buyer: '', styleCode: '', styleName: '', orderQty: 0,
    orderDate: today(), exFactoryDate: '', sewCompleteBy: '', sam: 0, bufferPct: 0.05,
    merchandiser: '', planner: '', status: 'Active', setGroup: '', setRole: '',
    fabricLeadDays: null, sellingPrice: null, currency: 'INR',
    excessPct: null, excessInvoiced: null, notes: '',
  }
}
