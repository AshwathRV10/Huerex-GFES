/**
 * The costing sheet.
 *
 * Every rate, every cost head, the cost of one garment and how that sits
 * against the price quoted. It is the most commercially sensitive page in the
 * system, so the route is behind `costing.export` — a permission the server
 * checks too, because a document that leaves the building on paper is exactly
 * the thing a role is meant to control.
 *
 * Two figures are shown side by side and are deliberately not the same number:
 * the cost of a garment that leaves the gate, and the cost spread over the
 * pieces the buyer actually pays for. Where the buyer takes the excess free,
 * those differ, and the gap is what the free pieces cost — stated in rupees
 * rather than buried.
 */
import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { PrintDocument, Detail, Signatures } from '../components/PrintDocument'
import { RequirePermission } from '../components/Gate'
import { api } from '../lib/api'
import { useDerived, useStore } from '../lib/store'
import { computeActual, computeCosting } from '../lib/engine/costing'
import { money, num, pct } from '../lib/format'

const asDate = (iso: string) => {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return d && m && y ? `${d}-${m}-${y}` : iso
}

export default function PrintCosting() {
  return (
    <RequirePermission permission="costing.export" what="Printing a costing sheet">
      <Sheet />
    </RequirePermission>
  )
}

function Sheet() {
  const { orderNo = '' } = useParams()
  const decoded = decodeURIComponent(orderNo)
  const [params] = useSearchParams()
  const view = params.get('view') === 'actual' ? 'actual' : 'plan'

  const orders = useStore((s) => s.data.orders)
  const buyers = useStore((s) => s.data.buyers)
  const costings = useStore((s) => s.data.costings)
  const { derived } = useDerived()

  const order = orders.find((o) => o.orderNo === decoded)
  const buyer = buyers.find((b) => b.name === order?.buyer)
  const facts = derived.byOrderNo.get(decoded)

  const costing = useMemo(
    () => costings
      .filter((c) => c.orderNo === decoded)
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0],
    [costings, decoded],
  )

  const result = useMemo(() => {
    if (!costing || !order) return null
    return view === 'actual'
      ? computeActual(costing, order, buyer, facts)
      : computeCosting(costing, order, buyer, null)
  }, [costing, order, buyer, facts, view])

  // The server checks the permission again and writes the audit entry. If it
  // refuses, the sheet says so rather than printing something the role is not
  // allowed to take out of the building.
  const [refused, setRefused] = useState<string | null>(null)
  useEffect(() => {
    if (!costing) return
    api.recordCostingExport(decoded).catch((error) => {
      setRefused(error instanceof Error ? error.message : 'The server refused this export')
    })
  }, [costing, decoded])

  if (!order || !costing || !result) {
    return (
      <PrintDocument
        title="No costing" documentType="Cost sheet"
        backTo={`/costing/${encodeURIComponent(decoded)}`} backLabel="Back to costing"
      >
        <p className="text-[12px]">
          {order ? `${decoded} has not been costed yet.` : `Nothing is numbered ${decoded}.`}
        </p>
      </PrintDocument>
    )
  }

  if (refused) {
    return (
      <PrintDocument
        title="Export refused" documentType="Cost sheet"
        backTo={`/costing/${encodeURIComponent(decoded)}`} backLabel="Back to costing"
      >
        <p className="text-[12px]">{refused}</p>
      </PrintDocument>
    )
  }

  const c = result.currency
  const q = result.quantities
  const unpriced = result.sellingPrice == null

  return (
    <PrintDocument
      title={`Cost sheet · ${order.orderNo}`}
      documentType={view === 'actual' ? 'Cost sheet · actual' : 'Cost sheet'}
      backTo={`/costing/${encodeURIComponent(decoded)}`}
      backLabel="Back to costing"
      warn={unpriced ? (
        <p className="text-xs text-ink-2 rounded-lg border border-warn/30 bg-warn/[0.07] px-3 py-2">
          No selling price is quoted on this costing, so the sheet shows costs without a margin.
        </p>
      ) : undefined}
    >
      {/* What this costs out. */}
      <section className="grid grid-cols-4 gap-x-5 gap-y-2.5 mb-4 keep-together">
        <Detail label="Order" value={<span className="font-semibold">{order.orderNo}</span>} />
        <Detail label="Buyer" value={order.buyer} />
        <Detail label="Style" value={order.styleCode} />
        <Detail label="Description" value={order.styleName} />
        <Detail label="Costing" value={costing.name || 'Costing'} />
        <Detail label="Status" value={costing.status} />
        <Detail label="Dated" value={asDate((costing.updatedAt || '').slice(0, 10))} />
        <Detail label="Ex-factory" value={asDate(order.exFactoryDate)} />
      </section>

      {/* The quantities the whole arithmetic rests on. Two columns rather than
          six rows: the same figures and the same explanations in half the
          height, which is most of what keeps a modest costing to one sheet. */}
      <Block title="Quantities">
        <div className="grid grid-cols-2 gap-x-8">
          <table className="w-full text-[11.5px]">
            <tbody>
              <QtyRow label="Ordered" value={num(q.ordered)} note="what the buyer asked for" />
              <QtyRow
                label="Excess" value={num(q.excessQty)}
                note={`${pct(q.excessPct)} · ${q.excessInvoiced ? 'invoiced' : 'free'}`}
              />
              <QtyRow label="Shipped" value={num(q.shipped)} note="leaves the gate" strong />
            </tbody>
          </table>
          <table className="w-full text-[11.5px]">
            <tbody>
              <QtyRow
                label="Reject allowance" value={num(q.rejectAllowance)}
                note={`${pct(q.rejectionPct)} — still costs`}
              />
              <QtyRow label="Produced" value={num(q.produced)} note="what must be made" strong />
              <QtyRow label="Invoiced" value={num(q.invoiced)} note="what the buyer pays for" strong />
            </tbody>
          </table>
        </div>
      </Block>

      {/* Every head, with its rate, so the sheet can be argued with. */}
      <Block title="Cost build-up">
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="border-y border-black/70">
              <th className="text-left font-semibold py-1.5 pr-2">Head</th>
              <th className="text-left font-semibold py-1.5 pr-2">Basis</th>
              <th className="text-right font-semibold py-1.5 px-2 w-24">Rate</th>
              <th className="text-right font-semibold py-1.5 px-2 w-24">Per pc</th>
              <th className="text-right font-semibold py-1.5 pl-2 w-28">Amount</th>
            </tr>
          </thead>
          <tbody>
            {/* Each result carries the line it came from, so the sheet reads the
                rates the engine actually used rather than looking them up again. */}
            {result.fabric.map((r, i) => (
              <Line
                key={r.line.id} head={i === 0 ? 'Fabric' : ''}
                what={`${r.line.fabricType} ${r.line.colour}`.trim()}
                basis={`${num(r.grossKg, 2)} kg incl. ${pct(r.line.wastagePct)} wastage`}
                rate={`${money(r.landedRate, c)}/kg`}
                perPc={r.costPerPc} amount={r.cost} currency={c}
              />
            ))}
            {result.trims.map((r, i) => (
              <Line
                key={r.line.id} head={i === 0 ? 'Trims' : ''}
                what={`${r.line.trimItem}${r.line.supplier ? ` · ${r.line.supplier}` : ''}`}
                basis={`${num(r.line.qtyPerPc, 2)} per pc${r.line.wastagePct ? ` incl. ${pct(r.line.wastagePct)}` : ''}`}
                rate={money(r.line.rate, c)}
                perPc={r.costPerPc} amount={r.cost} currency={c}
              />
            ))}
            {result.jobwork.map((r, i) => (
              <Line
                key={r.line.id} head={i === 0 ? 'Job work' : ''}
                what={`${r.line.process}${r.line.vendor ? ` · ${r.line.vendor}` : ''}`}
                basis={`${num(r.pieces)} pieces${r.line.coverage < 1 ? ` · ${pct(r.line.coverage)}` : ''}`}
                rate={`${money(r.line.ratePerPc, c)}/pc`}
                perPc={r.costPerPc} amount={r.cost} currency={c}
              />
            ))}
            {result.cmt.map((r, i) => (
              <Line
                key={r.line.id} head={i === 0 ? 'CMT' : ''}
                what={r.line.operation}
                basis={r.line.basis === 'sam'
                  ? `${num(r.line.samMinutes, 2)} min × ${money(r.line.costPerMinute, c)}`
                  : 'per piece'}
                rate={`${money(r.effectiveRate, c)}/pc`}
                perPc={r.costPerPc} amount={r.cost} currency={c}
              />
            ))}
            {result.overheads.map((r, i) => (
              <Line
                key={r.line.id} head={i === 0 ? 'Other' : ''}
                what={r.line.head}
                basis={{
                  lumpSum: 'for the order', perPc: 'per piece', pctOfCost: 'of cost',
                }[r.line.basis]}
                rate={r.line.basis === 'pctOfCost'
                  ? pct(r.line.amount / 100)
                  : money(r.line.amount, c)}
                perPc={r.costPerPc} amount={r.cost} currency={c}
              />
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-black/70">
              <td colSpan={3} className="py-2 pr-2 font-semibold">Total cost</td>
              <td className="py-2 px-2 text-right font-semibold tabular-nums">
                {money(result.costPerShippedPc, c)}
              </td>
              <td className="py-2 pl-2 text-right font-bold tabular-nums">{money(result.totalCost, c)}</td>
            </tr>
          </tfoot>
        </table>
      </Block>

      {/* The answer the sheet exists to give. */}
      {/* The conclusion, the notes and the signatures travel together. When the
          build-up is long enough to push past one page this is what carries
          over, which is the right half to break before — a second sheet that
          states the answer and is signed, rather than four stray rows. */}
      <div className="keep-together">
      <Block title="Against the quote">
        <div className="grid grid-cols-4 gap-4 keep-together">
          <Figure label="Cost per garment shipped" value={money(result.costPerShippedPc, c)} strong />
          <Figure label="Break-even price" value={money(result.breakEvenPrice, c)} />
          <Figure label="Quoted to buyer" value={unpriced ? 'not quoted' : money(result.sellingPrice!, c)} />
          <Figure
            label="Margin"
            value={unpriced ? '—' : `${money(result.margin, c)}${result.marginPct != null ? `  ·  ${pct(result.marginPct)}` : ''}`}
            strong
          />
        </div>

        <table className="w-full text-[11px] mt-3">
          <tbody>
            <QtyRow label="Revenue" value={money(result.revenue, c)} note={`on ${num(q.invoiced)} invoiced pieces`} />
            <QtyRow label="Total cost" value={money(result.totalCost, c)} note={`to make ${num(q.produced)} pieces`} />
            {!q.excessInvoiced && q.excessQty > 0 && (
              <QtyRow
                label="Free excess given away" value={money(result.excessGiveaway, c)}
                note={`${num(q.excessQty)} pieces the buyer does not pay for${
                  result.excessGiveawayMarginPoints != null
                    ? ` — ${pct(result.excessGiveawayMarginPoints)} of margin` : ''}`}
              />
            )}
            <QtyRow
              label="Rejection allowance" value={money(result.rejectionCost, c)}
              note={`${num(q.rejectAllowance)} pieces expected to fail`}
            />
          </tbody>
        </table>
      </Block>

      {costing.notes.trim() && (
        <Block title="Notes">
          <p className="text-[11px] leading-relaxed whitespace-pre-wrap">{costing.notes}</p>
        </Block>
      )}

      <Signatures left="Costed by" right="Approved by" />
      </div>
    </PrintDocument>
  )
}

/* ── Small pieces ─────────────────────────────────────────────────────── */

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-3.5">
      <h2 className="text-[10px] font-bold uppercase tracking-[0.12em] text-black/60 mb-1.5">{title}</h2>
      {children}
    </section>
  )
}

function QtyRow({ label, value, note, strong }: {
  label: string; value: string; note?: string; strong?: boolean
}) {
  return (
    <tr className="border-b border-black/10">
      <td className={`py-1 pr-3 ${strong ? 'font-semibold' : ''}`}>{label}</td>
      <td className={`py-1 px-3 text-right tabular-nums w-20 ${strong ? 'font-semibold' : ''}`}>{value}</td>
      <td className="py-1 pl-3 text-black/55 text-[10.5px]">{note}</td>
    </tr>
  )
}

function Line({ head, what, basis, rate, perPc, amount, currency }: {
  head: string; what: string; basis: string; rate: string
  perPc: number; amount: number; currency: string
}) {
  return (
    <tr className="border-b border-black/10">
      <td className="py-1 pr-2 align-top">
        {head && <span className="font-semibold">{head}</span>}
        {what && <span className={head ? 'text-black/70' : ''}>{head ? ' · ' : ''}{what}</span>}
      </td>
      <td className="py-1.5 pr-2 text-black/60 align-top">{basis}</td>
      <td className="py-1 px-2 text-right tabular-nums align-top">{rate}</td>
      <td className="py-1 px-2 text-right tabular-nums align-top">{money(perPc, currency)}</td>
      <td className="py-1 pl-2 text-right tabular-nums align-top">{money(amount, currency)}</td>
    </tr>
  )
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`border border-black/25 rounded px-2.5 py-2 ${strong ? 'bg-black/[0.04]' : ''}`}>
      <p className="text-[9px] uppercase tracking-[0.09em] text-black/55 leading-none mb-1.5">{label}</p>
      <p className={`tabular-nums leading-none ${strong ? 'text-[15px] font-bold' : 'text-[13px] font-semibold'}`}>
        {value}
      </p>
    </div>
  )
}
