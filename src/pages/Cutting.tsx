/**
 * Cutting — where every garment enters the system.
 *
 * The piece weight typed here is what later tells the costing engine how many
 * kilograms of fabric a garment really takes, so it is worth a few seconds.
 */
import { useMemo } from 'react'
import { Scissors } from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { LogTable, type DerivedColumn, type FieldDef } from '../components/LogTable'
import { Badge, Card, Section } from '../components/ui'
import { StatTile } from '../components/StatTile'
import { useDerived, useStore } from '../lib/store'
import { kg, num, today } from '../lib/format'
import { colourField, dateField, fabricTypesOf, orderField, requireFields, sizeField } from './fields'
import type { CuttingRow } from '../lib/types'

export default function Cutting() {
  const rows = useStore((s) => s.data.cutting)
  const { derived } = useDerived()

  const fields: FieldDef<CuttingRow>[] = useMemo(() => [
    dateField<CuttingRow>(),
    orderField<CuttingRow>(),
    colourField<CuttingRow>(),
    sizeField<CuttingRow>(),
    {
      kind: 'combo', key: 'fabricType', header: 'Fabric', width: '9.5rem', list: 'fabricTypes',
      suggest: (draft) => fabricTypesOf(draft.orderNo), hideBelow: 'md',
    },
    { kind: 'text', key: 'lotNo', header: 'Lot / bundle', width: '7rem', hideBelow: 'lg' },
    { kind: 'number', key: 'cutQty', header: 'Cut qty', width: '6rem', required: true },
    {
      kind: 'toggle', key: 'countsAsGarment', header: 'Garment?', width: '5.5rem',
      note: 'No for a re-cut panel',
    },
    { kind: 'number', key: 'pcWtG', header: 'Pc wt', width: '5.5rem', decimals: 1, suffix: 'g', note: 'drives fabric cost' },
    { kind: 'number', key: 'gsm', header: 'GSM', width: '5rem', hideBelow: 'lg' },
    { kind: 'text', key: 'remarks', header: 'Remarks', width: '10rem', hideBelow: 'lg' },
  ], [])

  const cellFacts = useMemo(() => {
    const map = new Map<string, { planned: number; cum: number; balance: number }>()
    for (const cell of derived.cells) {
      map.set(`${cell.orderNo} ${cell.colour} ${cell.size}`, {
        planned: cell.plannedCut, cum: cell.cumCut, balance: cell.balToCut,
      })
    }
    return map
  }, [derived])

  const derivedColumns: DerivedColumn<CuttingRow>[] = [
    {
      key: 'fabricUsed', header: 'Fabric used', align: 'right', width: '7rem',
      render: (row) => row.pcWtG ? kg((row.cutQty * row.pcWtG) / 1000) : <span className="text-ink-3/50">·</span>,
    },
    {
      key: 'plan', header: 'Planned', align: 'right', width: '6rem', hideBelow: 'lg',
      render: (row) => num(cellFacts.get(`${row.orderNo} ${row.colour} ${row.size}`)?.planned),
    },
    {
      key: 'cum', header: 'Cum cut', align: 'right', width: '6rem',
      render: (row) => num(cellFacts.get(`${row.orderNo} ${row.colour} ${row.size}`)?.cum),
    },
    {
      key: 'status', header: 'Status', width: '10rem',
      render: (row) => {
        const facts = cellFacts.get(`${row.orderNo} ${row.colour} ${row.size}`)
        if (!facts) return <Badge tone="risk">Not in the size breakdown</Badge>
        if (facts.cum > facts.planned) return <Badge tone="warn">Over by {num(facts.cum - facts.planned)}</Badge>
        if (facts.balance === 0) return <Badge tone="ok">Complete</Badge>
        return <Badge tone="neutral">{num(facts.balance)} to cut</Badge>
      },
    },
  ]

  const totalCut = rows.filter((r) => r.countsAsGarment).reduce((a, b) => a + b.cutQty, 0)
  const totalKg = rows.reduce((a, b) => a + (b.pcWtG ? (b.cutQty * b.pcWtG) / 1000 : 0), 0)
  const missingWeight = rows.filter((r) => !r.pcWtG).length

  return (
    <>
      <PageHeader
        title="Cutting"
        subtitle="Every garment enters the system here. Mark Garment? as No for a re-cut panel or a swatch that must not be counted twice."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatTile label="Pieces cut" value={num(totalCut)} caption="counted as garments" icon={<Scissors className="size-4" />} />
        <StatTile label="Fabric consumed" value={kg(totalKg, 1)} caption="from the piece weights entered" />
        <StatTile label="Entries" value={num(rows.length)} caption="cutting rows logged" />
        <StatTile
          label="No piece weight" value={num(missingWeight)}
          caption={missingWeight ? 'these rows cannot cost their fabric' : 'every row can cost its fabric'}
          tone={missingWeight ? 'warn' : 'ok'}
        />
      </div>

      <Section title="Cutting log" description="One row per bundle. Newest first.">
        <LogTable<CuttingRow>
          collection="cutting"
          rows={rows}
          fields={fields}
          derived={derivedColumns}
          validate={requireFields<CuttingRow>(fields)}
          blank={() => ({
            date: today(), orderNo: '', colour: '', size: '', fabricType: '',
            countsAsGarment: true, lotNo: '', cutQty: 0, gsm: null, areaPerPc: null,
            pcWtG: null, remarks: '',
          })}
          sortBy={(a, b) => (b.date ?? '').localeCompare(a.date ?? '')}
          rowTone={(row) => {
            const facts = cellFacts.get(`${row.orderNo} ${row.colour} ${row.size}`)
            if (!facts) return 'risk'
            return facts.cum > facts.planned ? 'warn' : null
          }}
          emptyTitle="Nothing cut yet"
        />
      </Section>

      {missingWeight > 0 && (
        <Card className="mt-4 p-4 text-sm text-ink-2 leading-relaxed">
          <span className="font-medium text-ink">Why the piece weight matters. </span>
          Fabric is bought by the kilogram and garments are sold by the piece. The weight recorded here is
          the bridge between the two, and it is what pre-fills the fabric consumption on a new costing — so
          nobody has to estimate it twice.
        </Card>
      )}
    </>
  )
}
