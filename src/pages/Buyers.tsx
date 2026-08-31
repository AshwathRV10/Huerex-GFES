/**
 * Buyers — and the one figure the costing cannot work without: excess.
 *
 * Excess ships with the order and the percentage differs buyer to buyer. Set it
 * once here and every order for that buyer inherits it.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Users } from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { StatTile } from '../components/StatTile'
import {
  Badge, Button, Callout, Card, CardHeader, Empty, Field, Modal, Section, Toggle, Tooltip,
} from '../components/ui'
import { useCostSummary } from '../hooks/useCostSummary'
import { useDerived, useStore } from '../lib/store'
import { moneyShort, num, pct } from '../lib/format'
import type { Buyer } from '../lib/types'

export default function Buyers() {
  const buyers = useStore((s) => s.data.buyers)
  const orders = useStore((s) => s.data.orders)
  const patch = useStore((s) => s.patch)
  const add = useStore((s) => s.add)
  const { derived } = useDerived()
  const cost = useCostSummary()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  const summary = useMemo(() => {
    const map = new Map<string, {
      orders: number; live: number; qty: number; shipped: number; wip: number
      revenue: number; margin: number; costed: number
    }>()
    for (const order of orders) {
      const entry = map.get(order.buyer) ?? { orders: 0, live: 0, qty: 0, shipped: 0, wip: 0, revenue: 0, margin: 0, costed: 0 }
      const facts = derived.byOrderNo.get(order.orderNo)
      entry.orders += 1
      if (order.status === 'Active') entry.live += 1
      entry.qty += order.orderQty
      entry.shipped += facts?.cumShipped ?? 0
      entry.wip += facts?.totalWip ?? 0
      const costing = cost.byOrder.get(order.orderNo)
      if (costing) {
        entry.costed += 1
        entry.revenue += costing.planned.revenue
        entry.margin += costing.planned.margin
      }
      map.set(order.buyer, entry)
    }
    return map
  }, [orders, derived, cost])

  const unset = buyers.filter((b) => !b.excessPctSet)

  const set = <K extends keyof Buyer>(buyer: Buyer, key: K, value: Buyer[K]) =>
    patch('buyers', buyer.id, { [key]: value } as never)

  return (
    <>
      <PageHeader
        title="Buyers"
        subtitle="Excess ships with the order, so it is produced and it costs money. What varies is who pays for it — and that is a buyer-by-buyer agreement."
        actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Add a buyer</Button>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatTile label="Buyers" value={num(buyers.length)} icon={<Users className="size-4" />} />
        <StatTile label="Live orders" value={num(orders.filter((o) => o.status === 'Active').length)} />
        <StatTile
          label="Excess not set" value={num(unset.length)}
          tone={unset.length ? 'warn' : 'ok'}
          caption={unset.length ? 'costings are assuming zero excess' : 'every buyer has an agreed excess'}
        />
        <StatTile
          label="Free excess given away" value={moneyShort(cost.totals.excessGiveaway, cost.totals.currency)}
          tone={cost.totals.excessGiveaway > 0 ? 'warn' : 'neutral'}
        />
      </div>

      {unset.length > 0 && (
        <Callout tone="warn" title={`${unset.length} buyer${unset.length > 1 ? 's have' : ' has'} no excess percentage`}>
          Until it is set, every costing for {unset.map((b) => b.name).join(', ')} assumes nothing extra is
          shipped — which understates what the order really costs to make.
        </Callout>
      )}

      <Section title="The book" description="Set each buyer's excess once and every order inherits it." className="mt-5">
        {buyers.length === 0 ? (
          <Card><Empty title="No buyers yet" detail="Add one and it becomes available in every buyer field in the app." /></Card>
        ) : (
          <div className="grid lg:grid-cols-2 gap-4">
            {buyers.map((buyer) => {
              const stats = summary.get(buyer.name)
              return (
                <Card key={buyer.id}>
                  <CardHeader
                    title={buyer.name}
                    subtitle={stats
                      ? `${stats.live} live of ${stats.orders} orders · ${num(stats.qty)} pcs booked`
                      : 'no orders yet'}
                    actions={
                      buyer.excessPctSet
                        ? <Badge tone="ok">{pct(buyer.excessPct, 1)} excess</Badge>
                        : <Badge tone="warn">excess not set</Badge>
                    }
                  />
                  <div className="p-4 grid sm:grid-cols-2 gap-4">
                    <Field
                      label="Excess %"
                      suffix="%"
                      defaultValue={buyer.excessPctSet ? buyer.excessPct * 100 : ''}
                      inputMode="decimal"
                      placeholder="not set"
                      hint="Extra pieces shipped on top of the order"
                      onBlur={(e) => {
                        const text = e.target.value.trim()
                        if (text === '') return set(buyer, 'excessPctSet', false)
                        patch('buyers', buyer.id, {
                          excessPct: (Number(text) || 0) / 100,
                          excessPctSet: true,
                        })
                      }}
                    />
                    <Field
                      label="Currency"
                      defaultValue={buyer.currency}
                      onBlur={(e) => set(buyer, 'currency', e.target.value.toUpperCase())}
                    />
                    <div className="sm:col-span-2">
                      <Toggle
                        checked={buyer.excessInvoiced}
                        onChange={(value) => set(buyer, 'excessInvoiced', value)}
                        label="The buyer pays for the excess"
                        hint={buyer.excessInvoiced
                          ? 'Excess pieces are invoiced along with the order'
                          : 'Excess ships free — it comes straight out of the margin'}
                      />
                    </div>
                    <Field
                      label="Payment terms"
                      defaultValue={buyer.paymentTerms}
                      placeholder="e.g. 60 days from B/L"
                      onBlur={(e) => set(buyer, 'paymentTerms', e.target.value)}
                    />
                    <Field
                      label="Notes"
                      defaultValue={buyer.notes}
                      onBlur={(e) => set(buyer, 'notes', e.target.value)}
                    />
                  </div>
                  {stats && stats.costed > 0 && (
                    <div className="px-4 py-3 border-t border-line bg-raised/50 flex items-center justify-between gap-3 text-sm">
                      <span className="text-ink-3 text-xs">
                        {stats.costed} of {stats.orders} orders costed
                      </span>
                      <span className="flex items-center gap-4">
                        <Tooltip label="Order value across costed orders">
                          <span className="num text-ink-2">{moneyShort(stats.revenue, buyer.currency)}</span>
                        </Tooltip>
                        <Badge tone={stats.margin < 0 ? 'risk' : stats.revenue > 0 && stats.margin / stats.revenue < 0.08 ? 'warn' : 'ok'}>
                          {stats.revenue > 0 ? pct(stats.margin / stats.revenue, 1) : '—'} margin
                        </Badge>
                      </span>
                    </div>
                  )}
                  {stats && stats.orders > 0 && (
                    <div className="px-4 py-2 border-t border-line text-2xs text-ink-3 flex items-center gap-4">
                      <span>{num(stats.shipped)} shipped</span>
                      <span>{num(stats.wip)} in WIP</span>
                      <Link to="/orders" className="ml-auto text-brand-600 hover:underline">see orders</Link>
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
        )}
      </Section>

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add a buyer"
        width="sm"
        footer={
          <>
            <Button onClick={() => setAdding(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!name.trim()}
              onClick={async () => {
                await add('buyers', {
                  name: name.trim(), excessPct: 0, excessPctSet: false, excessInvoiced: true,
                  currency: 'INR', paymentTerms: '', notes: '',
                })
                setName('')
                setAdding(false)
              }}
            >
              Add
            </Button>
          </>
        }
      >
        <Field
          label="Buyer name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="BABY SHOP - VIGASH"
          autoFocus
          hint="Set the excess percentage right after — it changes what every garment costs."
        />
      </Modal>
    </>
  )
}
