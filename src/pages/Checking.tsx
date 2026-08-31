/**
 * Checking & finishing — quality, rework and the good pool.
 *
 * Checked must equal Pass + Alter + Reject. A row that does not tally is
 * flagged rather than quietly absorbed, because a rejected piece that never
 * gets recorded is a piece the costing will never charge anyone for.
 */
import { useMemo } from 'react'
import { CheckCheck } from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { LogTable, type DerivedColumn, type FieldDef } from '../components/LogTable'
import { Badge, Callout, Section } from '../components/ui'
import { StatTile } from '../components/StatTile'
import { useDerived, useStore } from '../lib/store'
import { num, pct, today } from '../lib/format'
import { colourField, dateField, orderField, sizeField } from './fields'
import type { CheckingRow } from '../lib/types'

const tallyOf = (row: Partial<CheckingRow>) =>
  (row.checkedQty ?? 0) - ((row.passQty ?? 0) + (row.alterQty ?? 0) + (row.rejectQty ?? 0))

export default function Checking() {
  const rows = useStore((s) => s.data.checking)
  const settings = useStore((s) => s.settings)
  const { derived } = useDerived()

  const fields: FieldDef<CheckingRow>[] = useMemo(() => [
    dateField<CheckingRow>(),
    orderField<CheckingRow>(),
    colourField<CheckingRow>(),
    sizeField<CheckingRow>(),
    { kind: 'combo', key: 'line', header: 'Line', width: '6.5rem', list: 'lines', hideBelow: 'lg' },
    { kind: 'number', key: 'checkedQty', header: 'Checked', width: '6rem', required: true },
    { kind: 'number', key: 'passQty', header: 'Pass', width: '5.5rem' },
    { kind: 'number', key: 'alterQty', header: 'Alter', width: '5.5rem' },
    { kind: 'number', key: 'rejectQty', header: 'Reject', width: '5.5rem' },
    { kind: 'number', key: 'recheckedOk', header: 'Re-checked OK', width: '6.5rem', note: 'alters now passing' },
    { kind: 'text', key: 'remarks', header: 'Defect / remarks', width: '11rem', hideBelow: 'lg' },
  ], [])

  const derivedColumns: DerivedColumn<CheckingRow>[] = [
    {
      key: 'tally', header: 'Tally', width: '9rem',
      render: (row) => {
        const gap = tallyOf(row)
        return gap === 0
          ? <Badge tone="ok">Balanced</Badge>
          : <Badge tone="risk">Out by {num(Math.abs(gap))}</Badge>
      },
    },
    {
      key: 'dhu', header: 'DHU', align: 'right', width: '5.5rem',
      render: (row) => {
        if (!row.checkedQty) return <span className="text-ink-3/50">·</span>
        const dhu = (row.alterQty + row.rejectQty) / row.checkedQty
        return <span className={dhu > 0.05 ? 'text-warn' : ''}>{pct(dhu, 1)}</span>
      },
    },
    {
      key: 'good', header: 'Net good', align: 'right', width: '6rem',
      render: (row) => num(row.passQty + row.recheckedOk),
    },
    {
      key: 'rework', header: 'In rework', align: 'right', width: '6rem',
      render: (row) => {
        const rework = Math.max(0, row.alterQty - row.recheckedOk)
        return rework > 0 ? <span className="text-warn">{num(rework)}</span> : <span className="text-ink-3/50">·</span>
      },
    },
  ]

  const checked = rows.reduce((a, b) => a + b.checkedQty, 0)
  const good = rows.reduce((a, b) => a + b.passQty + b.recheckedOk, 0)
  const rejected = rows.reduce((a, b) => a + b.rejectQty, 0)
  const defects = rows.reduce((a, b) => a + b.alterQty + b.rejectQty, 0)
  const dhu = checked > 0 ? defects / checked : null
  const outOfTally = rows.filter((row) => tallyOf(row) !== 0)

  const highDhuOrders = derived.orders.filter(
    (o) => o.dhuPct != null && o.dhuPct > settings.dhuThresholdPct,
  )

  return (
    <>
      <PageHeader
        title="Checking &amp; finishing"
        subtitle="Checked = Pass + Alter + Reject. Re-checked OK moves an altered piece back into the good pool without counting it twice."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatTile label="Checked" value={num(checked)} icon={<CheckCheck className="size-4" />} />
        <StatTile label="Net good" value={num(good)} tone="ok" meter={{ value: good, max: checked || 1 }} />
        <StatTile label="Rejected" value={num(rejected)} tone={rejected ? 'risk' : 'neutral'} caption="these still cost money to make" />
        <StatTile
          label="DHU" value={dhu != null ? pct(dhu, 1) : '—'}
          caption="defects per hundred units checked"
          tone={dhu == null ? 'neutral' : dhu > settings.dhuThresholdPct ? 'warn' : 'ok'}
        />
      </div>

      {outOfTally.length > 0 && (
        <Callout tone="risk" title={`${outOfTally.length} row${outOfTally.length > 1 ? 's do' : ' does'} not tally`}>
          Checked must equal Pass plus Alter plus Reject. Until these agree, the good pool and the
          reconciliation will both be wrong.
        </Callout>
      )}

      {highDhuOrders.length > 0 && (
        <Callout tone="warn" title="DHU above threshold">
          {highDhuOrders.map((o) => `${o.order.orderNo} (${pct(o.dhuPct ?? 0, 1)})`).join(', ')} — take the top
          defect back to the line before the next block.
        </Callout>
      )}

      <Section title="Checking log" className="mt-5">
        <LogTable<CheckingRow>
          collection="checking"
          rows={rows}
          fields={fields}
          derived={derivedColumns}
          validate={(draft) => {
            if (!draft.orderNo) return 'Order is required'
            if (!draft.colour) return 'Colour is required'
            if (!draft.size) return 'Size is required'
            if (!draft.checkedQty) return 'Checked qty is required'
            if (tallyOf(draft) !== 0) return 'Checked must equal Pass + Alter + Reject'
            return null
          }}
          blank={() => ({
            date: today(), orderNo: '', colour: '', size: '', line: '',
            checkedQty: 0, passQty: 0, alterQty: 0, rejectQty: 0, recheckedOk: 0, remarks: '',
          })}
          sortBy={(a, b) => (b.date ?? '').localeCompare(a.date ?? '')}
          rowTone={(row) => (tallyOf(row) !== 0 ? 'risk' : null)}
          emptyTitle="Nothing checked yet"
        />
      </Section>
    </>
  )
}
