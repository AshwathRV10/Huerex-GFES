/**
 * The costing workspace for one order.
 *
 * Built to be typed into as little as possible: fabric lines come from what was
 * actually cut, job work lines from the vendors the order really went to, and
 * every rate is pre-filled from the last time somebody entered one for the same
 * colour, fabric, style or vendor. What is left to type is the number nobody
 * has recorded yet.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, ChevronRight, Copy, Layers, Plus, Save, Scissors,
  Sparkles, Trash2, Truck, Wallet,
} from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { SmartCombo } from '../components/SmartCombo'
import { Stat } from '../components/StatTile'
import {
  Badge, Button, Callout, Card, CardHeader, Empty, Field, Meter, Modal,
  Segmented, Toggle, Tooltip,
} from '../components/ui'
import { useComboStats } from '../hooks/useComboStats'
import { useDerived, useStore } from '../lib/store'
import {
  computeActual, computeCosting, findRate, prefillCosting, type CostResult,
} from '../lib/engine/costing'
import { money, num, pct, symbolFor } from '../lib/format'
import type {
  CmtCostLine, Costing, FabricCostLine, JobWorkCostLine, OverheadCostLine, TrimCostLine,
} from '../lib/types'

const uid = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 9)}`

export default function CostingDetail() {
  const { orderNo = '' } = useParams()
  const decoded = decodeURIComponent(orderNo)
  const navigate = useNavigate()

  const orders = useStore((s) => s.data.orders)
  const buyers = useStore((s) => s.data.buyers)
  const costings = useStore((s) => s.data.costings)
  const state = useStore((s) => s.data)
  const settings = useStore((s) => s.settings)
  const saveCosting = useStore((s) => s.saveCosting)
  const patch = useStore((s) => s.patch)
  const { derived } = useDerived()

  const order = orders.find((o) => o.orderNo === decoded)
  const buyer = buyers.find((b) => b.name === order?.buyer)
  const facts = derived.byOrderNo.get(decoded)

  const stored = useMemo(
    () => costings
      .filter((c) => c.orderNo === decoded)
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0],
    [costings, decoded],
  )

  const [draft, setDraft] = useState<Costing | null>(null)
  const [provenance, setProvenance] = useState<Record<string, string>>({})
  const [view, setView] = useState<'plan' | 'actual'>('plan')
  const [saving, setSaving] = useState(false)
  const [copying, setCopying] = useState(false)

  // Load the stored costing, or build a fresh one out of what is already known.
  useEffect(() => {
    if (!order) return
    if (stored) { setDraft(structuredClone(stored)); setProvenance({}); return }
    const prefill = prefillCosting(order, state, facts, settings, buyer)
    setDraft(prefill.costing)
    setProvenance(prefill.provenance)
    // Building the starting point only depends on the order, not on live edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, stored?.id])

  const dirty = useMemo(() => {
    if (!draft) return false
    if (!stored) return true
    return JSON.stringify({ ...draft, updatedAt: '' }) !== JSON.stringify({ ...stored, updatedAt: '' })
  }, [draft, stored])

  const planned = useMemo(
    () => (draft && order ? computeCosting(draft, order, buyer, null) : null),
    [draft, order, buyer],
  )
  const actual = useMemo(
    () => (draft && order ? computeActual(draft, order, buyer, facts) : null),
    [draft, order, buyer, facts],
  )
  const shown = view === 'actual' && actual ? actual : planned

  const save = async () => {
    if (!draft) return
    setSaving(true)
    try {
      await saveCosting(draft)
      // Keep the order's headline price in step with the costing.
      if (order && draft.sellingPrice !== order.sellingPrice) {
        await patch('orders', order.id, { sellingPrice: draft.sellingPrice })
      }
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (dirty) save()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  if (!order) {
    return (
      <>
        <PageHeader title="Order not found" subtitle={`Nothing in the system is numbered ${decoded}.`} />
        <Button onClick={() => navigate('/costing')} icon={<ArrowLeft className="size-4" />}>Back to costing</Button>
      </>
    )
  }
  if (!draft || !planned || !shown) return null

  const update = (patchValue: Partial<Costing>) => setDraft({ ...draft, ...patchValue })
  const currency = draft.currency

  return (
    <>
      <PageHeader
        breadcrumb={
          <>
            <Link to="/costing" className="hover:text-ink transition-colors">Costing</Link>
            <ChevronRight className="size-3" />
            <Link to={`/orders/${encodeURIComponent(order.orderNo)}`} className="hover:text-ink transition-colors">
              {order.orderNo}
            </Link>
          </>
        }
        title={
          <span className="flex items-center gap-3 flex-wrap">
            {order.orderNo}
            <Badge tone={draft.status === 'Confirmed' ? 'ok' : draft.status === 'Quoted' ? 'info' : 'neutral'}>
              {draft.status}
            </Badge>
            {!stored && <Badge tone="brand" dot>new — not saved yet</Badge>}
            {dirty && stored && <Badge tone="warn" dot>unsaved changes</Badge>}
          </span>
        }
        subtitle={[order.buyer, order.styleCode, order.styleName].filter(Boolean).join(' · ')}
        actions={
          <>
            <Button icon={<Copy className="size-4" />} onClick={() => setCopying(true)}>Copy from…</Button>
            <Button
              variant="primary" loading={saving} disabled={!dirty}
              icon={<Save className="size-4" />} onClick={save}
            >
              {stored ? 'Save' : 'Save costing'}
            </Button>
          </>
        }
      />

      {!stored && Object.keys(provenance).length > 0 && (
        <Callout tone="info" title="Started from what the system already knows">
          Fabric lines came from what has been cut, job work from the vendors this order went to, and{' '}
          {Object.keys(provenance).length} rate{Object.keys(provenance).length > 1 ? 's were' : ' was'} pre-filled
          from the rate book. Check them, change what is wrong, and save.
        </Callout>
      )}

      <div className="grid xl:grid-cols-[1fr_21rem] gap-5 items-start mt-4">
        <div className="space-y-5 min-w-0">
          <Quantities draft={draft} update={update} result={planned} orderQty={order.orderQty} buyerName={order.buyer} buyerSet={buyer?.excessPctSet ?? false} />
          <FabricSection draft={draft} update={update} result={shown} provenance={provenance} />
          <TrimsSection draft={draft} update={update} result={shown} />
          <JobWorkSection draft={draft} update={update} result={shown} />
          <CmtSection draft={draft} update={update} result={shown} sam={order.sam} />
          <OverheadsSection draft={draft} update={update} result={shown} />
        </div>

        <div className="xl:sticky xl:top-[4.75rem] space-y-4">
          <ResultRail
            result={shown}
            planned={planned}
            actual={actual}
            view={view}
            onView={setView}
            currency={currency}
            cumCut={facts?.cumCut ?? 0}
          />
        </div>
      </div>

      <CopyFromModal
        open={copying}
        onClose={() => setCopying(false)}
        currentOrderNo={order.orderNo}
        onCopy={(source) => {
          setDraft({
            ...draft,
            fabric: source.fabric.map((l) => ({ ...l, id: uid('fab') })),
            trims: source.trims.map((l) => ({ ...l, id: uid('trm') })),
            jobwork: source.jobwork.map((l) => ({ ...l, id: uid('jw') })),
            cmt: source.cmt.map((l) => ({ ...l, id: uid('cmt') })),
            overheads: source.overheads.map((l) => ({ ...l, id: uid('ovh') })),
            rejectionPct: source.rejectionPct,
          })
          setCopying(false)
        }}
      />
    </>
  )
}

/* ── Quantities and the quote ────────────────────────────────────────── */

function Quantities({
  draft, update, result, orderQty, buyerName, buyerSet,
}: {
  draft: Costing
  update: (patch: Partial<Costing>) => void
  result: CostResult
  orderQty: number
  buyerName: string
  buyerSet: boolean
}) {
  const { quantities } = result
  const symbol = symbolFor(draft.currency)

  return (
    <Card>
      <CardHeader
        title="Quantities and the quote"
        subtitle="Excess ships with the order, so it is made and it costs money. Rejected pieces cost money too — both are grossed up here before a single rate is applied."
        icon={<Wallet className="size-4" />}
      />
      <div className="p-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Field
          label="Price quoted to the buyer"
          prefix={symbol}
          defaultValue={draft.sellingPrice ?? ''}
          inputMode="decimal"
          hint="per piece"
          onBlur={(e) => update({ sellingPrice: e.target.value === '' ? null : Number(e.target.value) })}
        />
        <Field
          label="Excess %"
          suffix="%"
          defaultValue={draft.excessPct != null ? draft.excessPct * 100 : ''}
          inputMode="decimal"
          placeholder={buyerSet ? `${(quantities.excessPct * 100).toFixed(1)} from ${buyerName}` : 'not set'}
          hint={draft.excessPct == null ? 'inherited from the buyer' : 'overriding the buyer'}
          onBlur={(e) => update({ excessPct: e.target.value === '' ? null : Number(e.target.value) / 100 })}
        />
        <Field
          label="Rejection allowance"
          suffix="%"
          defaultValue={draft.rejectionPct * 100}
          inputMode="decimal"
          hint="pieces expected to fail checking"
          onBlur={(e) => update({ rejectionPct: (Number(e.target.value) || 0) / 100 })}
        />
        <div className="flex flex-col justify-end gap-3 pb-1">
          <Toggle
            checked={quantities.excessInvoiced}
            onChange={(value) => update({ excessInvoiced: value })}
            label="Buyer pays for the excess"
            hint={quantities.excessInvoiced
              ? 'Excess pieces are invoiced'
              : 'Excess ships free — it comes out of the margin'}
          />
        </div>
      </div>

      {quantities.excessUnset && (
        <div className="px-4 pb-4">
          <Callout tone="warn" title={`No excess percentage recorded for ${buyerName}`}>
            Excess differs buyer to buyer and it changes the cost of every garment.{' '}
            <Link to="/buyers" className="underline">Set it once on the buyers page</Link> and every order for
            this buyer will use it.
          </Callout>
        </div>
      )}

      {/* The quantity ladder — how a booked order becomes pieces to make. */}
      <div className="px-4 pb-4">
        <div className="rounded-xl border border-line bg-raised/50 p-4">
          <p className="text-2xs font-semibold uppercase tracking-[0.07em] text-ink-3 mb-3">
            From what was booked to what has to be made
          </p>
          <div className="grid sm:grid-cols-4 gap-3">
            <Ladder label="Ordered" value={orderQty} caption="booked by the buyer" />
            <Ladder
              signed
              label="Excess" value={quantities.excessQty}
              caption={`${pct(quantities.excessPct, 1)}${quantities.excessInvoiced ? ' · invoiced' : ' · free'}`}
              tone={quantities.excessQty > 0 ? 'saffron' : undefined}
            />
            <Ladder
              signed
              label="Rejection allowance" value={quantities.rejectAllowance}
              caption={`${pct(quantities.rejectionPct, 1)} of what is made`}
              tone={quantities.rejectAllowance > 0 ? 'warn' : undefined}
            />
            <Ladder label="To produce" value={quantities.produced} caption="every rate below is charged on this" emphasis />
          </div>
          <div className="mt-3 pt-3 border-t border-line flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-ink-3">
            <span>Ships: <span className="num text-ink font-medium">{num(quantities.shipped)}</span> pcs</span>
            <span>Invoiced: <span className="num text-ink font-medium">{num(quantities.invoiced)}</span> pcs</span>
            {!quantities.excessInvoiced && quantities.excessQty > 0 && (
              <span className="text-saffron">
                {num(quantities.excessQty)} pcs ship without an invoice
              </span>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}

function Ladder({
  label, value, caption, tone, emphasis, signed,
}: {
  label: string; value: number; caption: string
  tone?: 'saffron' | 'warn'; emphasis?: boolean; signed?: boolean
}) {
  return (
    <div>
      <p className="text-2xs text-ink-3">{label}</p>
      <p className={`num tabular-nums mt-0.5 ${emphasis ? 'text-xl font-semibold text-ink' : 'text-lg'} ${
        tone === 'saffron' ? 'text-saffron' : tone === 'warn' ? 'text-warn' : 'text-ink'
      }`}>
        {signed && value > 0 ? '+' : ''}{num(value)}
      </p>
      <p className="text-2xs text-ink-3 mt-0.5 leading-snug">{caption}</p>
    </div>
  )
}

/* ── Shared line-table chrome ────────────────────────────────────────── */

function LineSection({
  title, subtitle, icon, total, currency, perPc, onAdd, addLabel, children, empty,
}: {
  title: string
  subtitle: string
  icon: React.ReactNode
  total: number
  currency: string
  perPc: number
  onAdd: () => void
  addLabel: string
  children: React.ReactNode
  empty?: React.ReactNode
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={title}
        subtitle={subtitle}
        icon={icon}
        actions={
          <span className="flex items-center gap-3">
            <span className="text-right">
              <span className="block text-sm font-semibold num text-ink">{money(perPc, currency)}</span>
              <span className="block text-2xs text-ink-3">a garment</span>
            </span>
            <span className="text-right hidden sm:block">
              <span className="block text-sm num text-ink-2">{money(total, currency, 0)}</span>
              <span className="block text-2xs text-ink-3">total</span>
            </span>
          </span>
        }
      />
      <div className="overflow-x-auto">{children}</div>
      {empty}
      <div className="px-3 py-2 border-t border-line bg-raised/40">
        <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={onAdd}>{addLabel}</Button>
      </div>
    </Card>
  )
}

const TH = 'text-2xs font-semibold uppercase tracking-[0.06em] text-ink-3 px-2 py-2 whitespace-nowrap'
const TD = 'px-2 py-1'

function RateInput({
  value, onChange, width = 'w-20', suffix, hint,
}: { value: number; onChange: (v: number) => void; width?: string; suffix?: string; hint?: string }) {
  const [draft, setDraft] = useState<string | null>(null)
  const field = (
    <input
      inputMode="decimal"
      value={draft ?? (value || '')}
      placeholder="0"
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => {
        if (draft === null) return
        const parsed = Number(draft.trim().replace(/,/g, ''))
        setDraft(null)
        onChange(Number.isFinite(parsed) ? parsed : 0)
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
      className={`field field-sm num text-right tabular-nums ${width} ${suffix ? 'pr-6' : ''}`}
    />
  )
  return (
    <span className="relative inline-flex items-center">
      {hint ? <Tooltip label={hint}>{field}</Tooltip> : field}
      {suffix && <span className="absolute right-2 text-2xs text-ink-3 pointer-events-none">{suffix}</span>}
    </span>
  )
}

function DeleteLine({ onClick }: { onClick: () => void }) {
  return (
    <Button
      size="sm" variant="quiet" aria-label="Remove line"
      className="opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-risk"
      icon={<Trash2 className="size-3.5" />}
      onClick={onClick}
    />
  )
}

/* ── Fabric ──────────────────────────────────────────────────────────── */

function FabricSection({
  draft, update, result, provenance,
}: {
  draft: Costing
  update: (patch: Partial<Costing>) => void
  result: CostResult
  provenance: Record<string, string>
}) {
  const rateBook = useStore((s) => s.data.rateBook)
  const colourStats = useComboStats('colours')
  const fabricStats = useComboStats('fabricTypes')
  const currency = draft.currency

  const setLine = (id: string, patchValue: Partial<FabricCostLine>) =>
    update({ fabric: draft.fabric.map((l) => (l.id === id ? { ...l, ...patchValue } : l)) })

  /**
   * Changing the fabric or the colour re-reads the rate book: knitting follows
   * the fabric, dyeing follows the colour. That is exactly why two orders can
   * share one rate and differ on the other.
   */
  const refit = (line: FabricCostLine, next: Partial<FabricCostLine>) => {
    const merged = { ...line, ...next }
    const byFabric = { fabricType: merged.fabricType }
    const byColour = { fabricType: merged.fabricType, colour: merged.colour }
    setLine(line.id, {
      ...next,
      yarnRate: findRate(rateBook, 'yarn', byFabric)?.rate ?? merged.yarnRate,
      knittingRate: findRate(rateBook, 'knitting', byFabric)?.rate ?? merged.knittingRate,
      dyeingRate: findRate(rateBook, 'dyeing', byColour)?.rate ?? merged.dyeingRate,
      finishingRate: findRate(rateBook, 'finishing', byFabric)?.rate ?? merged.finishingRate,
    })
  }

  const addLine = () => update({
    fabric: [...draft.fabric, {
      id: uid('fab'), fabricType: '', colour: '', netGramsPerPc: null, netKgOverride: null,
      wastagePct: 0.08, yarnRate: 0, knittingRate: 0, dyeingRate: 0, finishingRate: 0,
      otherRate: 0, landedRateOverride: null, remarks: '',
    }],
  })

  return (
    <LineSection
      title="Fabric"
      subtitle="Kilograms of fabric a garment takes, at a rupee-a-kilogram rate built from its parts. Knitting follows the fabric, dyeing follows the colour."
      icon={<Layers className="size-4" />}
      total={result.fabricCost}
      perPc={result.fabricCost / Math.max(1, result.quantities.produced)}
      currency={currency}
      onAdd={addLine}
      addLabel="Add a fabric"
      empty={draft.fabric.length === 0
        ? <Empty title="No fabric lines" detail="Add the fabric this garment is made from, or log a cutting entry and it will appear here automatically." />
        : undefined}
    >
      {draft.fabric.length > 0 && (
        <table className="w-full border-collapse min-w-[64rem]">
          <thead className="sticky-head">
            <tr>
              <th className={`${TH} text-left`}>Fabric</th>
              <th className={`${TH} text-left`}>Colour</th>
              <th className={`${TH} text-right`}>g / pc</th>
              <th className={`${TH} text-right`}>Wastage</th>
              <th className={`${TH} text-right`}>Yarn</th>
              <th className={`${TH} text-right`}>Knitting</th>
              <th className={`${TH} text-right`}>Dyeing</th>
              <th className={`${TH} text-right`}>Finishing</th>
              <th className={`${TH} text-right`}>Other</th>
              <th className={`${TH} text-right bg-ink/[0.025]`}>Landed / kg</th>
              <th className={`${TH} text-right bg-ink/[0.025]`}>Kg</th>
              <th className={`${TH} text-right bg-ink/[0.025]`}>Cost</th>
              <th className={`${TH} text-right bg-ink/[0.025]`}>/ pc</th>
              <th className="w-9" />
            </tr>
          </thead>
          <tbody>
            {result.fabric.map(({ line, landedRate, grossKg, cost, costPerPc }) => (
              <tr key={line.id} className="border-b border-line/70 last:border-0 group hover:bg-brand-500/[0.03]">
                <td className={`${TD} min-w-[10rem]`}>
                  <SmartCombo
                    small list="fabricTypes" stats={fabricStats} value={line.fabricType}
                    onChange={(fabricType) => refit(line, { fabricType })}
                    placeholder="Fabric"
                  />
                </td>
                <td className={`${TD} min-w-[9rem]`}>
                  <SmartCombo
                    small list="colours" stats={colourStats} value={line.colour}
                    onChange={(colour) => refit(line, { colour })}
                    placeholder="Colour"
                  />
                </td>
                <td className={`${TD} text-right`}>
                  <RateInput
                    width="w-16" value={line.netGramsPerPc ?? 0}
                    hint={line.remarks || undefined}
                    onChange={(v) => setLine(line.id, { netGramsPerPc: v || null })}
                  />
                </td>
                <td className={`${TD} text-right`}>
                  <RateInput
                    width="w-16" suffix="%" value={Math.round(line.wastagePct * 1000) / 10}
                    onChange={(v) => setLine(line.id, { wastagePct: v / 100 })}
                  />
                </td>
                <td className={`${TD} text-right`}>
                  <RateInput value={line.yarnRate} onChange={(v) => setLine(line.id, { yarnRate: v })}
                    hint={provenance[`${line.id}:yarn`]} />
                </td>
                <td className={`${TD} text-right`}>
                  <RateInput value={line.knittingRate} onChange={(v) => setLine(line.id, { knittingRate: v })}
                    hint={provenance[`${line.id}:knitting`] ?? 'Varies by fabric'} />
                </td>
                <td className={`${TD} text-right`}>
                  <RateInput value={line.dyeingRate} onChange={(v) => setLine(line.id, { dyeingRate: v })}
                    hint={provenance[`${line.id}:dyeing`] ?? 'Varies by colour'} />
                </td>
                <td className={`${TD} text-right`}>
                  <RateInput value={line.finishingRate} onChange={(v) => setLine(line.id, { finishingRate: v })}
                    hint={provenance[`${line.id}:finishing`]} />
                </td>
                <td className={`${TD} text-right`}>
                  <RateInput value={line.otherRate} onChange={(v) => setLine(line.id, { otherRate: v })} />
                </td>
                <td className={`${TD} text-right num bg-ink/[0.02] font-medium`}>
                  <Tooltip label={line.landedRateOverride != null ? 'Overridden — clear it to use the build-up' : 'Yarn + knitting + dyeing + finishing + other'}>
                    <span>{money(landedRate, currency)}</span>
                  </Tooltip>
                </td>
                <td className={`${TD} text-right num bg-ink/[0.02]`}>{num(grossKg, 1)}</td>
                <td className={`${TD} text-right num bg-ink/[0.02]`}>{money(cost, currency, 0)}</td>
                <td className={`${TD} text-right num bg-ink/[0.02] font-medium`}>{money(costPerPc, currency)}</td>
                <td className={TD}>
                  <DeleteLine onClick={() => update({ fabric: draft.fabric.filter((l) => l.id !== line.id) })} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-raised border-t border-line">
              <td className={`${TD} text-2xs text-ink-3`} colSpan={10}>
                {num(result.totalFabricKg, 1)} kg for {num(result.quantities.produced)} pcs ·{' '}
                {num(result.fabricKgPerPc * 1000, 0)} g a garment including wastage
              </td>
              <td className={`${TD} text-right num text-ink-2`}>{num(result.totalFabricKg, 1)}</td>
              <td className={`${TD} text-right num font-semibold`}>{money(result.fabricCost, currency, 0)}</td>
              <td className={`${TD} text-right num font-semibold`}>
                {money(result.fabricCost / Math.max(1, result.quantities.produced), currency)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      )}
    </LineSection>
  )
}

/* ── Trims ───────────────────────────────────────────────────────────── */

function TrimsSection({
  draft, update, result,
}: { draft: Costing; update: (patch: Partial<Costing>) => void; result: CostResult }) {
  const rateBook = useStore((s) => s.data.rateBook)
  const trimStats = useComboStats('trimItems')
  const currency = draft.currency

  const setLine = (id: string, patchValue: Partial<TrimCostLine>) =>
    update({ trims: draft.trims.map((l) => (l.id === id ? { ...l, ...patchValue } : l)) })

  return (
    <LineSection
      title="Trims"
      subtitle="How many of each trim go on a garment, and what one costs. Wastage covers breakage and short rolls."
      icon={<Scissors className="size-4" />}
      total={result.trimsCost}
      perPc={result.trimsCost / Math.max(1, result.quantities.produced)}
      currency={currency}
      onAdd={() => update({
        trims: [...draft.trims, {
          id: uid('trm'), trimItem: '', supplier: '', unit: 'pcs',
          qtyPerPc: 1, rate: 0, wastagePct: 0.03, remarks: '',
        }],
      })}
      addLabel="Add a trim"
      empty={draft.trims.length === 0
        ? <Empty title="No trims costed" detail="Labels, tags, buttons, elastic, thread, polybags, cartons — anything that goes on or around the garment." />
        : undefined}
    >
      {draft.trims.length > 0 && (
        <table className="w-full border-collapse min-w-[48rem]">
          <thead className="sticky-head">
            <tr>
              <th className={`${TH} text-left`}>Trim</th>
              <th className={`${TH} text-left`}>Supplier</th>
              <th className={`${TH} text-left`}>Unit</th>
              <th className={`${TH} text-right`}>Qty / pc</th>
              <th className={`${TH} text-right`}>Rate</th>
              <th className={`${TH} text-right`}>Wastage</th>
              <th className={`${TH} text-right bg-ink/[0.025]`}>Qty needed</th>
              <th className={`${TH} text-right bg-ink/[0.025]`}>Cost</th>
              <th className={`${TH} text-right bg-ink/[0.025]`}>/ pc</th>
              <th className="w-9" />
            </tr>
          </thead>
          <tbody>
            {result.trims.map(({ line, qtyNeeded, cost, costPerPc }) => (
              <tr key={line.id} className="border-b border-line/70 last:border-0 group hover:bg-brand-500/[0.03]">
                <td className={`${TD} min-w-[11rem]`}>
                  <SmartCombo
                    small list="trimItems" stats={trimStats} value={line.trimItem}
                    placeholder="Trim item"
                    onChange={(trimItem) => setLine(line.id, {
                      trimItem,
                      rate: findRate(rateBook, 'trim', { item: trimItem })?.rate ?? line.rate,
                    })}
                  />
                </td>
                <td className={`${TD} min-w-[9rem]`}>
                  <SmartCombo small list="suppliers" value={line.supplier} placeholder="Supplier"
                    onChange={(supplier) => setLine(line.id, { supplier })} />
                </td>
                <td className={`${TD} w-24`}>
                  <SmartCombo small list="trimUnits" value={line.unit} placeholder="Unit"
                    onChange={(unit) => setLine(line.id, { unit })} />
                </td>
                <td className={`${TD} text-right`}>
                  <RateInput width="w-16" value={line.qtyPerPc} onChange={(v) => setLine(line.id, { qtyPerPc: v })} />
                </td>
                <td className={`${TD} text-right`}>
                  <RateInput value={line.rate} onChange={(v) => setLine(line.id, { rate: v })} />
                </td>
                <td className={`${TD} text-right`}>
                  <RateInput width="w-16" suffix="%" value={Math.round(line.wastagePct * 1000) / 10}
                    onChange={(v) => setLine(line.id, { wastagePct: v / 100 })} />
                </td>
                <td className={`${TD} text-right num bg-ink/[0.02]`}>{num(qtyNeeded, 0)}</td>
                <td className={`${TD} text-right num bg-ink/[0.02]`}>{money(cost, currency, 0)}</td>
                <td className={`${TD} text-right num bg-ink/[0.02] font-medium`}>{money(costPerPc, currency)}</td>
                <td className={TD}>
                  <DeleteLine onClick={() => update({ trims: draft.trims.filter((l) => l.id !== line.id) })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </LineSection>
  )
}

/* ── Job work ────────────────────────────────────────────────────────── */

function JobWorkSection({
  draft, update, result,
}: { draft: Costing; update: (patch: Partial<Costing>) => void; result: CostResult }) {
  const rateBook = useStore((s) => s.data.rateBook)
  const vendorStats = useComboStats('vendors')
  const processStats = useComboStats('jobWorkProcesses')
  const currency = draft.currency

  const setLine = (id: string, patchValue: Partial<JobWorkCostLine>) =>
    update({ jobwork: draft.jobwork.map((l) => (l.id === id ? { ...l, ...patchValue } : l)) })

  const order = useStore((s) => s.data.orders.find((o) => o.orderNo === draft.orderNo))

  return (
    <LineSection
      title="Job work"
      subtitle="A rupee-a-piece rate for each outsourced process, per vendor. Printing changes style to style, so the rate remembers the style it was quoted for."
      icon={<Truck className="size-4" />}
      total={result.jobworkCost}
      perPc={result.jobworkCost / Math.max(1, result.quantities.produced)}
      currency={currency}
      onAdd={() => update({
        jobwork: [...draft.jobwork, {
          id: uid('jw'), process: '', vendor: '', ratePerPc: 0, coverage: 1, remarks: '',
        }],
      })}
      addLabel="Add a process"
      empty={draft.jobwork.length === 0
        ? <Empty title="No job work costed" detail="Printing, embroidery, washing, tie & dye — anything sent outside the factory." />
        : undefined}
    >
      {draft.jobwork.length > 0 && (
        <table className="w-full border-collapse min-w-[44rem]">
          <thead className="sticky-head">
            <tr>
              <th className={`${TH} text-left`}>Process</th>
              <th className={`${TH} text-left`}>Vendor</th>
              <th className={`${TH} text-right`}>Rate / pc</th>
              <th className={`${TH} text-right`}>Coverage</th>
              <th className={`${TH} text-left`}>Note</th>
              <th className={`${TH} text-right bg-ink/[0.025]`}>Pieces</th>
              <th className={`${TH} text-right bg-ink/[0.025]`}>Cost</th>
              <th className={`${TH} text-right bg-ink/[0.025]`}>/ pc</th>
              <th className="w-9" />
            </tr>
          </thead>
          <tbody>
            {result.jobwork.map(({ line, pieces, cost, costPerPc }) => (
              <tr key={line.id} className="border-b border-line/70 last:border-0 group hover:bg-brand-500/[0.03]">
                <td className={`${TD} min-w-[10rem]`}>
                  <SmartCombo
                    small list="jobWorkProcesses" stats={processStats} value={line.process}
                    placeholder="Process"
                    onChange={(process) => setLine(line.id, {
                      process,
                      ratePerPc: findRate(rateBook, 'jobwork', {
                        process, vendor: line.vendor, style: order?.styleCode,
                      })?.rate ?? line.ratePerPc,
                    })}
                  />
                </td>
                <td className={`${TD} min-w-[11rem]`}>
                  <SmartCombo
                    small list="vendors" stats={vendorStats} value={line.vendor}
                    placeholder="Vendor"
                    onChange={(vendor) => setLine(line.id, {
                      vendor,
                      ratePerPc: findRate(rateBook, 'jobwork', {
                        process: line.process, vendor, style: order?.styleCode,
                      })?.rate ?? line.ratePerPc,
                    })}
                  />
                </td>
                <td className={`${TD} text-right`}>
                  <RateInput value={line.ratePerPc} onChange={(v) => setLine(line.id, { ratePerPc: v })} />
                </td>
                <td className={`${TD} text-right`}>
                  <RateInput
                    width="w-16" suffix="%" value={Math.round(line.coverage * 1000) / 10}
                    hint="What share of the garments go through this process"
                    onChange={(v) => setLine(line.id, { coverage: v / 100 })}
                  />
                </td>
                <td className={`${TD} text-2xs text-ink-3 max-w-[10rem] truncate`}>{line.remarks}</td>
                <td className={`${TD} text-right num bg-ink/[0.02]`}>{num(pieces)}</td>
                <td className={`${TD} text-right num bg-ink/[0.02]`}>{money(cost, currency, 0)}</td>
                <td className={`${TD} text-right num bg-ink/[0.02] font-medium`}>{money(costPerPc, currency)}</td>
                <td className={TD}>
                  <DeleteLine onClick={() => update({ jobwork: draft.jobwork.filter((l) => l.id !== line.id) })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </LineSection>
  )
}

/* ── CMT ─────────────────────────────────────────────────────────────── */

function CmtSection({
  draft, update, result, sam,
}: { draft: Costing; update: (patch: Partial<Costing>) => void; result: CostResult; sam: number }) {
  const rateBook = useStore((s) => s.data.rateBook)
  const operationStats = useComboStats('cmtOperations')
  const currency = draft.currency

  const setLine = (id: string, patchValue: Partial<CmtCostLine>) =>
    update({ cmt: draft.cmt.map((l) => (l.id === id ? { ...l, ...patchValue } : l)) })

  return (
    <LineSection
      title="CMT — cut, make and trim"
      subtitle="Cutting, fusing, sewing, ironing, checking and packing. Charge a flat rate a piece, or standard minutes at a rate a minute."
      icon={<Scissors className="size-4" />}
      total={result.cmtCost}
      perPc={result.cmtCost / Math.max(1, result.quantities.produced)}
      currency={currency}
      onAdd={() => update({
        cmt: [...draft.cmt, {
          id: uid('cmt'), operation: '', basis: 'perPc', ratePerPc: 0,
          samMinutes: 0, costPerMinute: 0, remarks: '',
        }],
      })}
      addLabel="Add an operation"
      empty={draft.cmt.length === 0 ? <Empty title="No making costs" detail="Add the operations this garment goes through inside the factory." /> : undefined}
    >
      {draft.cmt.length > 0 && (
        <table className="w-full border-collapse min-w-[44rem]">
          <thead className="sticky-head">
            <tr>
              <th className={`${TH} text-left`}>Operation</th>
              <th className={`${TH} text-left`}>Basis</th>
              <th className={`${TH} text-right`}>Rate / pc</th>
              <th className={`${TH} text-right`}>SAM</th>
              <th className={`${TH} text-right`}>Cost / min</th>
              <th className={`${TH} text-right bg-ink/[0.025]`}>Effective / pc</th>
              <th className={`${TH} text-right bg-ink/[0.025]`}>Cost</th>
              <th className="w-9" />
            </tr>
          </thead>
          <tbody>
            {result.cmt.map(({ line, effectiveRate, cost }) => (
              <tr key={line.id} className="border-b border-line/70 last:border-0 group hover:bg-brand-500/[0.03]">
                <td className={`${TD} min-w-[11rem]`}>
                  <SmartCombo
                    small list="cmtOperations" stats={operationStats} value={line.operation}
                    placeholder="Operation"
                    onChange={(operation) => setLine(line.id, {
                      operation,
                      ratePerPc: findRate(rateBook, 'cmt', { process: operation })?.rate ?? line.ratePerPc,
                      samMinutes: operation === 'Sewing' && !line.samMinutes ? sam : line.samMinutes,
                    })}
                  />
                </td>
                <td className={`${TD} w-28`}>
                  <Segmented
                    size="sm"
                    value={line.basis}
                    onChange={(basis) => setLine(line.id, { basis })}
                    options={[{ value: 'perPc', label: '₹/pc' }, { value: 'sam', label: 'SAM' }]}
                  />
                </td>
                <td className={`${TD} text-right`}>
                  <RateInput value={line.ratePerPc} onChange={(v) => setLine(line.id, { ratePerPc: v })} />
                </td>
                <td className={`${TD} text-right`}>
                  <RateInput width="w-16" suffix="m" value={line.samMinutes}
                    onChange={(v) => setLine(line.id, { samMinutes: v })} />
                </td>
                <td className={`${TD} text-right`}>
                  <RateInput value={line.costPerMinute} onChange={(v) => setLine(line.id, { costPerMinute: v })} />
                </td>
                <td className={`${TD} text-right num bg-ink/[0.02] font-medium`}>{money(effectiveRate, currency)}</td>
                <td className={`${TD} text-right num bg-ink/[0.02]`}>{money(cost, currency, 0)}</td>
                <td className={TD}>
                  <DeleteLine onClick={() => update({ cmt: draft.cmt.filter((l) => l.id !== line.id) })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </LineSection>
  )
}

/* ── Other costs ─────────────────────────────────────────────────────── */

function OverheadsSection({
  draft, update, result,
}: { draft: Costing; update: (patch: Partial<Costing>) => void; result: CostResult }) {
  const headStats = useComboStats('overheadHeads')
  const currency = draft.currency

  const setLine = (id: string, patchValue: Partial<OverheadCostLine>) =>
    update({ overheads: draft.overheads.map((l) => (l.id === id ? { ...l, ...patchValue } : l)) })

  return (
    <LineSection
      title="Other costs"
      subtitle="Sampling, lab tests, documentation, transportation and anything else the order carries. A lump sum spreads itself across every piece."
      icon={<Wallet className="size-4" />}
      total={result.overheadCost}
      perPc={result.overheadCost / Math.max(1, result.quantities.produced)}
      currency={currency}
      onAdd={() => update({
        overheads: [...draft.overheads, { id: uid('ovh'), head: '', basis: 'lumpSum', amount: 0, remarks: '' }],
      })}
      addLabel="Add a cost"
      empty={draft.overheads.length === 0 ? <Empty title="No other costs" detail="Sampling, lab tests, documentation, freight, inspection fees, commission." /> : undefined}
    >
      {draft.overheads.length > 0 && (
        <table className="w-full border-collapse min-w-[40rem]">
          <thead className="sticky-head">
            <tr>
              <th className={`${TH} text-left`}>Cost head</th>
              <th className={`${TH} text-left`}>Charged as</th>
              <th className={`${TH} text-right`}>Amount</th>
              <th className={`${TH} text-left`}>Note</th>
              <th className={`${TH} text-right bg-ink/[0.025]`}>Cost</th>
              <th className={`${TH} text-right bg-ink/[0.025]`}>/ pc</th>
              <th className="w-9" />
            </tr>
          </thead>
          <tbody>
            {result.overheads.map(({ line, cost, costPerPc }) => (
              <tr key={line.id} className="border-b border-line/70 last:border-0 group hover:bg-brand-500/[0.03]">
                <td className={`${TD} min-w-[12rem]`}>
                  <SmartCombo
                    small list="overheadHeads" stats={headStats} value={line.head}
                    placeholder="Cost head" onChange={(head) => setLine(line.id, { head })}
                  />
                </td>
                <td className={`${TD} w-44`}>
                  <Segmented
                    size="sm"
                    value={line.basis}
                    onChange={(basis) => setLine(line.id, { basis })}
                    options={[
                      { value: 'lumpSum', label: 'Lump sum' },
                      { value: 'perPc', label: 'Per pc' },
                      { value: 'pctOfCost', label: '% of cost' },
                    ]}
                  />
                </td>
                <td className={`${TD} text-right`}>
                  <RateInput
                    width="w-24"
                    suffix={line.basis === 'pctOfCost' ? '%' : undefined}
                    value={line.basis === 'pctOfCost' ? Math.round(line.amount * 1000) / 10 : line.amount}
                    onChange={(v) => setLine(line.id, { amount: line.basis === 'pctOfCost' ? v / 100 : v })}
                  />
                </td>
                <td className={`${TD}`}>
                  <input
                    defaultValue={line.remarks}
                    onBlur={(e) => setLine(line.id, { remarks: e.target.value })}
                    placeholder="—"
                    className="field field-sm border-transparent bg-transparent hover:border-line"
                  />
                </td>
                <td className={`${TD} text-right num bg-ink/[0.02]`}>{money(cost, currency, 0)}</td>
                <td className={`${TD} text-right num bg-ink/[0.02] font-medium`}>{money(costPerPc, currency)}</td>
                <td className={TD}>
                  <DeleteLine onClick={() => update({ overheads: draft.overheads.filter((l) => l.id !== line.id) })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </LineSection>
  )
}

/* ── The answer ──────────────────────────────────────────────────────── */

const BUCKET_COLOUR: Record<string, string> = {
  fabric: 'bg-brand-500',
  trims: 'bg-info',
  jobwork: 'bg-saffron',
  cmt: 'bg-ok',
  overheads: 'bg-ink-3',
}

function ResultRail({
  result, planned, actual, view, onView, currency, cumCut,
}: {
  result: CostResult
  planned: CostResult
  actual: CostResult | null
  view: 'plan' | 'actual'
  onView: (view: 'plan' | 'actual') => void
  currency: string
  cumCut: number
}) {
  const verdictTone = {
    ok: 'border-ok/30 bg-ok/[0.06]',
    warn: 'border-warn/30 bg-warn/[0.07]',
    risk: 'border-risk/30 bg-risk/[0.06]',
    unknown: 'border-line bg-raised',
  }[result.verdict.tone]

  return (
    <>
      <Card className="overflow-hidden">
        <div className="px-4 pt-4 pb-3">
          <Segmented
            className="w-full [&>button]:flex-1"
            value={view}
            onChange={onView}
            options={[
              { value: 'plan', label: 'Planned' },
              { value: 'actual', label: actual ? 'Actual' : 'Actual —' },
            ]}
          />
          {view === 'actual' && !actual && (
            <p className="mt-2 text-2xs text-ink-3 leading-snug">
              Nothing has been cut yet, so the actual column has nothing to price. Showing the plan.
            </p>
          )}
          {view === 'actual' && actual && (
            <p className="mt-2 text-2xs text-ink-3 leading-snug">
              Priced on {num(cumCut)} pcs actually cut and what the fabric store really issued.
            </p>
          )}
        </div>

        <div className="px-4 pb-4">
          <p className="text-2xs font-semibold uppercase tracking-[0.07em] text-ink-3">Cost per garment</p>
          <p className="mt-1 text-[2.25rem] leading-none font-semibold num tracking-tight text-ink">
            {money(result.costPerShippedPc, currency)}
          </p>
          <p className="mt-1.5 text-xs text-ink-3 leading-snug">
            every piece that leaves the gate, excess included
          </p>
        </div>

        <div className="px-4 pb-4 space-y-0.5">
          {result.buckets.map((bucket) => (
            <div key={bucket.key}>
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="flex items-center gap-1.5 text-ink-2">
                  <span className={`size-2 rounded-[3px] ${BUCKET_COLOUR[bucket.key]}`} />
                  {bucket.label}
                </span>
                <span className="num tabular-nums text-ink">
                  {money(bucket.costPerPc, currency)}
                  <span className="text-ink-3 ml-1.5 text-2xs">{pct(bucket.sharePct, 0)}</span>
                </span>
              </div>
              <Meter
                value={bucket.cost} max={Math.max(result.totalCost, 1)} height="h-1"
                className="mt-1 mb-1.5"
                tone={bucket.key === 'fabric' ? 'brand' : bucket.key === 'jobwork' ? 'saffron' : bucket.key === 'cmt' ? 'ok' : bucket.key === 'trims' ? 'info' : 'neutral'}
              />
            </div>
          ))}
        </div>

        <div className="px-4 py-3 border-t border-line bg-raised/50">
          <Stat label="Total cost" value={money(result.totalCost, currency, 0)} emphasis />
          <Stat label="Order value" value={money(result.revenue, currency, 0)} />
          <Stat
            label="Margin" value={money(result.margin, currency, 0)} emphasis
            tone={result.margin < 0 ? 'risk' : 'ok'}
          />
          <Stat
            label="Margin %" value={result.marginPct != null ? pct(result.marginPct, 1) : '—'}
            tone={result.margin < 0 ? 'risk' : (result.marginPct ?? 1) < 0.08 ? 'warn' : 'ok'}
          />
        </div>

        <div className={`px-4 py-3 border-t ${verdictTone}`}>
          <p className="text-sm font-semibold text-ink">{result.verdict.label}</p>
          <p className="text-xs text-ink-2 mt-0.5 leading-snug">{result.verdict.detail}</p>
        </div>
      </Card>

      <Card className="p-4">
        <p className="text-2xs font-semibold uppercase tracking-[0.07em] text-ink-3 mb-2">The detail</p>
        <Stat label="Quoted price" value={result.sellingPrice != null ? money(result.sellingPrice, currency) : '—'} />
        <Stat
          label="Break-even price" value={money(result.breakEvenPrice, currency)}
          tone={result.sellingPrice != null && result.breakEvenPrice > result.sellingPrice ? 'risk' : 'neutral'}
          hint="Cost spread over the pieces the buyer pays for"
        />
        <Stat
          label="Contribution a piece"
          value={result.contributionPerPc != null ? money(result.contributionPerPc, currency) : '—'}
          tone={(result.contributionPerPc ?? 0) < 0 ? 'risk' : 'ok'}
        />
        <div className="mt-2 pt-2 border-t border-line">
          <Stat label="Fabric a garment" value={`${num(result.fabricKgPerPc * 1000, 0)} g`} />
          <Stat label="Pieces to produce" value={num(result.quantities.produced)} />
          <Stat label="Pieces shipped" value={num(result.quantities.shipped)} />
          <Stat label="Pieces invoiced" value={num(result.quantities.invoiced)} />
        </div>
        {result.excessGiveaway > 0 && (
          <div className="mt-2 pt-2 border-t border-line">
            <Stat
              label="Free excess costs you" value={money(result.excessGiveaway, currency, 0)}
              tone="warn"
              hint="Excess pieces that ship without an invoice"
            />
            {result.excessGiveawayMarginPoints != null && (
              <p className="text-2xs text-ink-3 mt-1 leading-snug">
                That is {pct(result.excessGiveawayMarginPoints, 1)} of the order value given away.
              </p>
            )}
          </div>
        )}
        {result.rejectionCost > 0 && (
          <Stat
            label="Rejection allowance costs" value={money(result.rejectionCost, currency, 0)}
            tone="warn" hint="Pieces made that are never sold"
          />
        )}
      </Card>

      {actual && (
        <Card className="p-4">
          <p className="text-2xs font-semibold uppercase tracking-[0.07em] text-ink-3 mb-2 flex items-center gap-1.5">
            <Sparkles className="size-3 text-saffron" /> Plan against reality
          </p>
          <Compare label="Cost a garment" plan={planned.costPerShippedPc} real={actual.costPerShippedPc} currency={currency} lowerIsBetter />
          <Compare label="Fabric a garment" plan={planned.fabricKgPerPc * 1000} real={actual.fabricKgPerPc * 1000} unit=" g" lowerIsBetter />
          <Compare label="Total cost" plan={planned.totalCost} real={actual.totalCost} currency={currency} lowerIsBetter decimals={0} />
          <Compare label="Margin" plan={planned.margin} real={actual.margin} currency={currency} decimals={0} />
          <p className="text-2xs text-ink-3 mt-2 leading-relaxed">
            The actual column re-prices this costing on the pieces really cut and the kilograms really issued.
            A gap here is either a rate that has moved or a floor that is using more than it planned to.
          </p>
        </Card>
      )}
    </>
  )
}

function Compare({
  label, plan, real, currency, unit = '', lowerIsBetter, decimals = 2,
}: {
  label: string; plan: number; real: number; currency?: string
  unit?: string; lowerIsBetter?: boolean; decimals?: number
}) {
  const delta = real - plan
  const worse = lowerIsBetter ? delta > 0 : delta < 0
  const format = (value: number) =>
    currency ? money(value, currency, decimals) : `${num(value, decimals)}${unit}`
  return (
    <div className="flex items-baseline justify-between gap-2 py-1 text-xs">
      <span className="text-ink-3">{label}</span>
      <span className="flex items-baseline gap-2 num tabular-nums">
        <span className="text-ink-3">{format(plan)}</span>
        <span className="text-ink-3/60">→</span>
        <span className="text-ink font-medium">{format(real)}</span>
        {Math.abs(delta) > 0.005 && (
          <span className={worse ? 'text-risk' : 'text-ok'}>
            {delta > 0 ? '+' : '−'}{format(Math.abs(delta)).replace('−', '')}
          </span>
        )}
      </span>
    </div>
  )
}

/* ── Copy from another order ─────────────────────────────────────────── */

function CopyFromModal({
  open, onClose, currentOrderNo, onCopy,
}: {
  open: boolean
  onClose: () => void
  currentOrderNo: string
  onCopy: (source: Costing) => void
}) {
  const costings = useStore((s) => s.data.costings)
  const orders = useStore((s) => s.data.orders)
  const [query, setQuery] = useState('')

  const options = useMemo(() => {
    const byOrder = new Map<string, Costing>()
    for (const costing of [...costings].sort((a, b) => (a.updatedAt ?? '').localeCompare(b.updatedAt ?? ''))) {
      if (costing.orderNo !== currentOrderNo) byOrder.set(costing.orderNo, costing)
    }
    const needle = query.trim().toLowerCase()
    return [...byOrder.values()]
      .map((costing) => ({ costing, order: orders.find((o) => o.orderNo === costing.orderNo) }))
      .filter(({ order, costing }) =>
        !needle ||
        costing.orderNo.toLowerCase().includes(needle) ||
        (order?.buyer ?? '').toLowerCase().includes(needle) ||
        (order?.styleCode ?? '').toLowerCase().includes(needle))
      .sort((a, b) => (b.costing.updatedAt ?? '').localeCompare(a.costing.updatedAt ?? ''))
  }, [costings, orders, currentOrderNo, query])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Copy a costing"
      subtitle="Takes the lines and the rates from another order. Quantities, price and excess stay as they are on this one — dyeing and printing rates should still be checked against this order's colours and style."
      footer={<Button onClick={onClose}>Cancel</Button>}
    >
      <Field
        placeholder="Search order, buyer or style…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      <div className="mt-3 max-h-80 overflow-y-auto -mx-1 px-1">
        {options.length === 0 ? (
          <Empty
            icon={<Copy className="size-5" />}
            title="No other costings yet"
            detail="Once another order has been costed you can start from it instead of a blank sheet."
          />
        ) : (
          <div className="space-y-1">
            {options.map(({ costing, order }) => (
              <button
                key={costing.id}
                type="button"
                onClick={() => onCopy(costing)}
                className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left border border-line
                           hover:border-brand-500/50 hover:bg-brand-500/[0.05] transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{costing.orderNo}</p>
                  <p className="text-2xs text-ink-3 truncate">
                    {[order?.buyer, order?.styleCode].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <span className="text-2xs text-ink-3 shrink-0 num">
                  {costing.fabric.length}F · {costing.trims.length}T · {costing.jobwork.length}J · {costing.cmt.length}C
                </span>
                <ChevronRight className="size-3.5 text-ink-3 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
