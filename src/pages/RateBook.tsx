/**
 * The rate book — the memory behind every costing.
 *
 * Each rate is filed under what actually makes it vary. A knitting rate belongs
 * to a fabric, a dyeing rate to a colour, a printing rate to a style and a
 * vendor. That is why two orders can share a knitting rate and still be costed
 * completely differently.
 */
import { useMemo, useState } from 'react'
import { BadgeIndianRupee, Plus } from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { DataGrid, type Column } from '../components/DataGrid'
import { SmartCombo } from '../components/SmartCombo'
import { StatTile } from '../components/StatTile'
import { Badge, Button, Card, Empty, Field, Modal, Segmented, Tooltip } from '../components/ui'
import { useStore } from '../lib/store'
import { KIND_LABEL, rateLabel } from '../lib/engine/costing'
import { num, shortDate } from '../lib/format'
import type { RateEntry } from '../lib/types'

const KINDS: RateEntry['kind'][] = [
  'yarn', 'knitting', 'dyeing', 'finishing', 'trim', 'jobwork', 'cmt', 'overhead',
]

/** What each kind of rate is really keyed on — shown so nobody misfiles one. */
const KEYED_BY: Record<RateEntry['kind'], string> = {
  yarn: 'the fabric',
  knitting: 'the fabric',
  dyeing: 'the colour',
  finishing: 'the fabric',
  fabricLanded: 'the fabric and colour',
  trim: 'the item',
  jobwork: 'the process, vendor and style',
  cmt: 'the operation and style',
  overhead: 'the cost head and buyer',
}

export default function RateBook() {
  const rates = useStore((s) => s.data.rateBook)
  const drop = useStore((s) => s.drop)
  const patch = useStore((s) => s.patch)
  const [kind, setKind] = useState<RateEntry['kind'] | 'all'>('all')
  const [adding, setAdding] = useState(false)

  const rows = useMemo(
    () => (kind === 'all' ? rates : rates.filter((r) => r.kind === kind)),
    [rates, kind],
  )

  const columns: Column<RateEntry>[] = [
    {
      key: 'kind', header: 'Kind', width: '9rem',
      value: (r) => KIND_LABEL[r.kind],
      render: (r) => <Badge tone={toneFor(r.kind)}>{KIND_LABEL[r.kind]}</Badge>,
    },
    {
      key: 'scope', header: 'Applies to', width: '18rem',
      value: (r) => Object.values(r.scope).filter(Boolean).join(' '),
      render: (r) => (
        <span className="flex flex-wrap items-center gap-1">
          {Object.entries(r.scope).filter(([, v]) => v).map(([dim, value]) => (
            <Tooltip key={dim} label={dim}>
              <span className="chip bg-ink/[0.05] text-ink-2">{value}</span>
            </Tooltip>
          ))}
          {Object.values(r.scope).filter(Boolean).length === 0 && <span className="text-ink-3">anything</span>}
        </span>
      ),
    },
    {
      key: 'rate', header: 'Rate', align: 'right', width: '8rem',
      value: (r) => r.rate,
      render: (r) => (
        <input
          defaultValue={r.rate}
          inputMode="decimal"
          onBlur={(e) => {
            const value = Number(e.target.value)
            if (Number.isFinite(value) && value !== r.rate) patch('rateBook', r.id, { rate: value })
          }}
          className="field field-sm num text-right w-24 border-transparent bg-transparent hover:border-line"
        />
      ),
    },
    {
      key: 'unit', header: 'Per', width: '5rem',
      value: (r) => r.unit,
      render: (r) => <span className="text-sm text-ink-3">{r.unit}</span>,
    },
    {
      key: 'uses', header: 'Used', align: 'right', width: '5.5rem', derived: true,
      value: (r) => r.uses,
      render: (r) => <span className="text-sm">{num(r.uses)}×</span>,
    },
    {
      key: 'last', header: 'Last used', width: '11rem', derived: true,
      value: (r) => r.lastUsedAt,
      render: (r) => (
        <span className="text-sm text-ink-2">
          {r.lastOrderNo || '—'}
          <span className="block text-2xs text-ink-3">{shortDate(r.lastUsedAt?.slice(0, 10))}</span>
        </span>
      ),
    },
  ]

  const byKind = useMemo(() => {
    const counts = new Map<string, number>()
    for (const rate of rates) counts.set(rate.kind, (counts.get(rate.kind) ?? 0) + 1)
    return counts
  }, [rates])

  return (
    <>
      <PageHeader
        title="Rate book"
        subtitle="Every rate the team has entered, filed under what makes it vary. New costings start pre-filled from here, so the same number is never typed twice."
        actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Add a rate</Button>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatTile label="Rates remembered" value={num(rates.length)} icon={<BadgeIndianRupee className="size-4" />} />
        <StatTile label="Dyeing rates" value={num(byKind.get('dyeing') ?? 0)} caption="one per colour" />
        <StatTile label="Job work rates" value={num(byKind.get('jobwork') ?? 0)} caption="per process, vendor and style" />
        <StatTile label="Times reused" value={num(rates.reduce((a, b) => a + Math.max(0, b.uses - 1), 0))} caption="entries saved from retyping" tone="ok" />
      </div>

      {rates.length === 0 ? (
        <Card>
          <Empty
            icon={<BadgeIndianRupee className="size-5" />}
            title="The rate book is empty"
            detail="It fills itself. Save a costing and every rate in it is remembered here, filed under the colour, fabric, style or vendor it belongs to — ready to pre-fill the next order."
          />
        </Card>
      ) : (
        <DataGrid
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          searchable
          searchPlaceholder="Search colour, fabric, vendor, style…"
          onDelete={(r) => drop('rateBook', r.id)}
          defaultSort={{ key: 'uses', direction: 'desc' }}
          toolbar={
            <Segmented
              size="sm"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'all', label: 'All' },
                ...KINDS.filter((k) => byKind.has(k)).map((k) => ({ value: k, label: KIND_LABEL[k] })),
              ]}
            />
          }
        />
      )}

      <p className="mt-3 text-xs text-ink-3 leading-relaxed max-w-3xl">
        A rate only matches an order when every dimension it is filed under agrees. A dyeing rate saved
        against PEACH ORANGE will never be offered for a TEAL order, and a printing rate quoted for one style
        will not silently follow another — which is exactly the point.
      </p>

      <AddRateModal open={adding} onClose={() => setAdding(false)} />
    </>
  )
}

function toneFor(kind: RateEntry['kind']) {
  if (kind === 'dyeing') return 'saffron' as const
  if (kind === 'knitting' || kind === 'yarn' || kind === 'finishing') return 'brand' as const
  if (kind === 'jobwork') return 'info' as const
  if (kind === 'cmt') return 'ok' as const
  return 'neutral' as const
}

function AddRateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const add = useStore((s) => s.add)
  const settings = useStore((s) => s.settings)
  const [kind, setKind] = useState<RateEntry['kind']>('dyeing')
  const [scope, setScope] = useState<RateEntry['scope']>({})
  const [rate, setRate] = useState('')
  const [saving, setSaving] = useState(false)

  const fields: { key: keyof RateEntry['scope']; label: string; list: string }[] =
    kind === 'dyeing' ? [
      { key: 'colour', label: 'Colour', list: 'colours' },
      { key: 'fabricType', label: 'Fabric (optional)', list: 'fabricTypes' },
    ]
    : kind === 'knitting' || kind === 'yarn' || kind === 'finishing' ? [
      { key: 'fabricType', label: 'Fabric type', list: 'fabricTypes' },
    ]
    : kind === 'trim' ? [
      { key: 'item', label: 'Trim item', list: 'trimItems' },
      { key: 'vendor', label: 'Supplier (optional)', list: 'suppliers' },
    ]
    : kind === 'jobwork' ? [
      { key: 'process', label: 'Process', list: 'jobWorkProcesses' },
      { key: 'vendor', label: 'Vendor', list: 'vendors' },
      { key: 'style', label: 'Style (optional)', list: 'styles' },
    ]
    : kind === 'cmt' ? [
      { key: 'process', label: 'Operation', list: 'cmtOperations' },
      { key: 'style', label: 'Style (optional)', list: 'styles' },
    ]
    : [
      { key: 'item', label: 'Cost head', list: 'overheadHeads' },
      { key: 'buyer', label: 'Buyer (optional)', list: 'buyers' },
    ]

  const unit: RateEntry['unit'] =
    ['yarn', 'knitting', 'dyeing', 'finishing', 'fabricLanded'].includes(kind) ? 'kg'
    : kind === 'trim' ? 'unit'
    : kind === 'overhead' ? 'order' : 'pc'

  const problem = !Number(rate) ? 'A rate is required'
    : !Object.values(scope).some(Boolean) ? `Say what this ${KIND_LABEL[kind].toLowerCase()} rate applies to`
    : null

  const save = async () => {
    if (problem) return
    setSaving(true)
    try {
      await add('rateBook', {
        kind, scope, unit, rate: Number(rate),
        currency: settings.currency ?? 'INR',
        label: rateLabel(kind, scope),
        uses: 0,
        lastUsedAt: new Date().toISOString(),
        lastOrderNo: '',
        note: '',
      })
      setScope({}); setRate('')
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a rate"
      subtitle="Rates normally arrive by themselves when a costing is saved. Add one here to seed the book before the first order."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={!!problem}>Remember this rate</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <span className="label">Kind of rate</span>
          <div className="flex flex-wrap gap-1.5">
            {KINDS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => { setKind(option); setScope({}) }}
                className={`chip h-7 px-2.5 ${kind === option ? 'bg-brand-500 text-white' : 'bg-ink/[0.05] text-ink-2 hover:bg-ink/[0.08]'}`}
              >
                {KIND_LABEL[option]}
              </button>
            ))}
          </div>
          <p className="mt-2 text-2xs text-ink-3">Filed under {KEYED_BY[kind]}.</p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          {fields.map((field) => (
            <SmartCombo
              key={field.key}
              label={field.label}
              list={field.list}
              value={scope[field.key] ?? ''}
              onChange={(value) => setScope((s) => ({ ...s, [field.key]: value }))}
            />
          ))}
          <Field
            label={`Rate per ${unit}`}
            prefix="₹"
            value={rate}
            inputMode="decimal"
            onChange={(e) => setRate(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  )
}
