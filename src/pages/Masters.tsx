/**
 * Masters — everything the app has been taught to remember.
 *
 * Values arrive here on their own: type a new colour into any field and it is
 * saved. This page is where they are reviewed, tidied and retired.
 */
import { useMemo, useState } from 'react'
import { Search, Sparkles, Trash2, X } from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { StatTile } from '../components/StatTile'
import { Badge, Button, Card, CardHeader, Empty, Field, Tooltip } from '../components/ui'
import { useComboStats } from '../hooks/useComboStats'
import { NONE, useStore } from '../lib/store'
import { num } from '../lib/format'

/** Lists worth showing, in the order somebody would look for them. */
const GROUPS: { title: string; lists: { key: string; label: string; hint: string }[] }[] = [
  {
    title: 'The order book',
    lists: [
      { key: 'buyers', label: 'Buyers', hint: 'Every buyer field reads from here' },
      { key: 'styles', label: 'Styles', hint: 'Printing rates are remembered per style' },
      { key: 'team', label: 'Merchandisers & planners', hint: 'Who owns an order' },
    ],
  },
  {
    title: 'What a garment is made of',
    lists: [
      { key: 'colours', label: 'Colours', hint: 'Dyeing rates are remembered per colour' },
      { key: 'sizes', label: 'Sizes', hint: 'Used across the size breakdown' },
      { key: 'fabricTypes', label: 'Fabric types', hint: 'Knitting rates are remembered per fabric' },
      { key: 'trimItems', label: 'Trim items', hint: 'Labels, tags, buttons, thread' },
      { key: 'trimUnits', label: 'Trim units', hint: 'How a trim is counted' },
      { key: 'suppliers', label: 'Suppliers', hint: 'Where trims come from' },
    ],
  },
  {
    title: 'How it gets made',
    lists: [
      { key: 'processes', label: 'Processes', hint: 'Everything a route can contain' },
      { key: 'jobWorkProcesses', label: 'Job work processes', hint: 'What goes outside the factory' },
      { key: 'vendors', label: 'Vendors', hint: 'Who does the outside work' },
      { key: 'lines', label: 'Sewing lines', hint: 'Where sewing is logged' },
      { key: 'cmtOperations', label: 'CMT operations', hint: 'Cutting, sewing, ironing, packing' },
      { key: 'inspectors', label: 'Inspectors & agencies', hint: 'Who signs off a shipment' },
    ],
  },
  {
    title: 'Paperwork and money',
    lists: [
      { key: 'approvalTypes', label: 'Approval types', hint: 'What the buyer owes you' },
      { key: 'overheadHeads', label: 'Other cost heads', hint: 'Sampling, lab, freight, documentation' },
      { key: 'delayReasons', label: 'Delay reasons', hint: 'Why an order slipped' },
      { key: 'currencies', label: 'Currencies', hint: 'What orders are priced in' },
    ],
  },
]

export default function Masters() {
  const masters = useStore((s) => s.masters)
  const [query, setQuery] = useState('')

  const total = useMemo(
    () => Object.values(masters).reduce((a, list) => a + list.length, 0),
    [masters],
  )

  const visibleGroups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return GROUPS
    return GROUPS
      .map((group) => ({
        ...group,
        lists: group.lists.filter((list) =>
          list.label.toLowerCase().includes(needle) ||
          (masters[list.key] ?? []).some((value) => value.toLowerCase().includes(needle))),
      }))
      .filter((group) => group.lists.length > 0)
  }, [query, masters])

  return (
    <>
      <PageHeader
        title="Masters"
        subtitle="Every value the app has been taught. Nothing here needs adding by hand — type a new colour or vendor into any field and it lands here automatically."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatTile label="Values remembered" value={num(total)} icon={<Sparkles className="size-4" />} />
        <StatTile label="Colours" value={num((masters.colours ?? []).length)} />
        <StatTile label="Vendors" value={num((masters.vendors ?? []).length)} />
        <StatTile label="Fabric types" value={num((masters.fabricTypes ?? []).length)} />
      </div>

      <div className="relative max-w-sm mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-ink-3" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a value or a list…"
          className="field pl-9"
        />
        {query && (
          <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink">
            <X className="size-3.5" />
          </button>
        )}
      </div>

      <div className="space-y-6">
        {visibleGroups.map((group) => (
          <section key={group.title}>
            <h2 className="text-[0.9375rem] font-semibold text-ink tracking-tight mb-3">{group.title}</h2>
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
              {group.lists.map((list) => (
                <MasterList key={list.key} listKey={list.key} label={list.label} hint={list.hint} filter={query} />
              ))}
            </div>
          </section>
        ))}
        {visibleGroups.length === 0 && (
          <Card><Empty title={`Nothing matches “${query}”`} /></Card>
        )}
      </div>
    </>
  )
}

function MasterList({
  listKey, label, hint, filter,
}: { listKey: string; label: string; hint: string; filter: string }) {
  const values = useStore((s) => s.masters[listKey] ?? NONE)
  const addMaster = useStore((s) => s.addMaster)
  const removeMaster = useStore((s) => s.removeMaster)
  const stats = useComboStats(listKey)
  const [adding, setAdding] = useState('')
  const [confirm, setConfirm] = useState<string | null>(null)

  const needle = filter.trim().toLowerCase()
  const shown = needle
    ? values.filter((v) => v.toLowerCase().includes(needle) || label.toLowerCase().includes(needle))
    : values

  const inUse = (value: string) => (stats?.[value]?.count ?? 0) > 0

  return (
    <Card className="flex flex-col">
      <CardHeader
        title={label}
        subtitle={hint}
        actions={<Badge tone="neutral">{values.length}</Badge>}
      />
      <div className="p-3 flex-1 min-h-0">
        {shown.length === 0 ? (
          <p className="text-xs text-ink-3 py-4 text-center">
            {values.length === 0 ? 'Nothing saved yet' : 'No match'}
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5 max-h-52 overflow-y-auto">
            {shown.map((value) => {
              const used = stats?.[value]
              return (
                <span
                  key={value}
                  className="group inline-flex items-center gap-1 rounded-md border border-line bg-raised/60 pl-2 pr-1 h-6 text-xs text-ink-2"
                >
                  {value}
                  {used?.count ? (
                    <Tooltip label={`Used on ${used.count} row${used.count > 1 ? 's' : ''}${used.lastOrderNo ? `, last on ${used.lastOrderNo}` : ''}`}>
                      <span className="text-2xs text-ink-3 num">{used.count}</span>
                    </Tooltip>
                  ) : null}
                  {confirm === value ? (
                    <button
                      onClick={() => { removeMaster(listKey, value); setConfirm(null) }}
                      className="text-risk px-1"
                      aria-label={`Confirm removing ${value}`}
                    >
                      remove?
                    </button>
                  ) : (
                    <Tooltip label={inUse(value) ? 'Still used by existing rows — removing it only hides it from dropdowns' : 'Remove'}>
                      <button
                        onClick={() => setConfirm(value)}
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-ink-3 hover:text-risk transition-opacity"
                        aria-label={`Remove ${value}`}
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </Tooltip>
                  )}
                </span>
              )
            })}
          </div>
        )}
      </div>
      <div className="p-3 pt-0 flex gap-2">
        <Field
          small
          placeholder="Add a value…"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && adding.trim()) { addMaster(listKey, adding); setAdding('') }
          }}
          className="flex-1"
        />
        <Button
          size="sm"
          disabled={!adding.trim()}
          onClick={() => { addMaster(listKey, adding); setAdding('') }}
        >
          Add
        </Button>
      </div>
    </Card>
  )
}
