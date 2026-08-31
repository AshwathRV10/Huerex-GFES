/**
 * Approval control — what the buyer still owes you, and the waivers management
 * has signed off on.
 */
import { useMemo } from 'react'
import { Banknote, ShieldCheck } from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { LogTable, type DerivedColumn, type FieldDef } from '../components/LogTable'
import { Badge, Callout, Section } from '../components/ui'
import { StatTile } from '../components/StatTile'
import { useStore } from '../lib/store'
import { daysBetween, num, today } from '../lib/format'
import { orderField, requireFields } from './fields'
import { ALERT_TYPES } from '../lib/engine/alerts'
import type { ApprovalRow, WaiverRow } from '../lib/types'

export default function Approvals() {
  const approvals = useStore((s) => s.data.approvals)
  const waivers = useStore((s) => s.data.waivers)

  const approvalFields: FieldDef<ApprovalRow>[] = useMemo(() => [
    orderField<ApprovalRow>(),
    { kind: 'combo', key: 'approvalType', header: 'Approval', width: '10rem', required: true, list: 'approvalTypes' },
    { kind: 'toggle', key: 'required', header: 'Required?', width: '6rem' },
    {
      kind: 'select', key: 'status', header: 'Status', width: '7.5rem', required: true,
      options: [
        { value: 'Pending', label: 'Pending' },
        { value: 'Approved', label: 'Approved' },
        { value: 'Rejected', label: 'Rejected' },
        { value: 'Not Required', label: 'Not required' },
      ],
    },
    { kind: 'date', key: 'sentDate', header: 'Sent', width: '8.5rem' },
    { kind: 'date', key: 'decisionDate', header: 'Decision', width: '8.5rem' },
    { kind: 'toggle', key: 'blocksProduction', header: 'Blocks production?', width: '7.5rem' },
    { kind: 'text', key: 'remarks', header: 'Remarks', width: '10rem', hideBelow: 'lg' },
  ], [])

  const approvalColumns: DerivedColumn<ApprovalRow>[] = [
    {
      key: 'pending', header: 'Days pending', align: 'right', width: '7rem',
      render: (row) => {
        if (row.status !== 'Pending' || !row.sentDate) return <span className="text-ink-3/50">·</span>
        const days = daysBetween(row.sentDate, today()) ?? 0
        return <span className={days > 7 ? 'text-warn font-medium' : ''}>{days}</span>
      },
    },
    {
      key: 'turnaround', header: 'Turnaround', align: 'right', width: '7rem',
      render: (row) => {
        if (!row.sentDate || !row.decisionDate) return <span className="text-ink-3/50">·</span>
        return num(daysBetween(row.sentDate, row.decisionDate))
      },
    },
    {
      key: 'status', header: 'Verdict', width: '11rem',
      render: (row) => {
        if (!row.required) return <Badge tone="neutral">Not required</Badge>
        if (row.status === 'Approved') return <Badge tone="ok">Approved</Badge>
        if (row.status === 'Rejected') return <Badge tone="risk">Rejected</Badge>
        return row.blocksProduction
          ? <Badge tone="risk">Blocking production</Badge>
          : <Badge tone="warn">Waiting on the buyer</Badge>
      },
    },
  ]

  const waiverFields: FieldDef<WaiverRow>[] = useMemo(() => [
    orderField<WaiverRow>(),
    {
      kind: 'combo', key: 'alertType', header: 'Alert type', width: '11rem', required: true,
      options: ['ALL', ...ALERT_TYPES], allowCreate: false,
    },
    { kind: 'toggle', key: 'approved', header: 'Accepted?', width: '6.5rem' },
    { kind: 'combo', key: 'approvedBy', header: 'Accepted by', width: '9rem', list: 'team' },
    { kind: 'date', key: 'approvalDate', header: 'Accepted on', width: '8.5rem' },
    { kind: 'date', key: 'validUntil', header: 'Valid until', width: '8.5rem', required: true },
    { kind: 'text', key: 'reason', header: 'Reason', width: '14rem' },
  ], [])

  const waiverColumns: DerivedColumn<WaiverRow>[] = [
    {
      key: 'state', header: 'State', width: '11rem',
      render: (row) => {
        if (!row.approved) return <Badge tone="neutral">Not accepted</Badge>
        if (row.validUntil && row.validUntil < today()) return <Badge tone="warn">Lapsed — alert is live again</Badge>
        return <Badge tone="info">Suppressed until {row.validUntil || 'further notice'}</Badge>
      },
    },
  ]

  const pending = approvals.filter((a) => a.required && a.status === 'Pending')
  const blocking = pending.filter((a) => a.blocksProduction)
  const liveWaivers = waivers.filter((w) => w.approved && (!w.validUntil || w.validUntil >= today()))

  return (
    <>
      <PageHeader
        title="Approvals"
        subtitle="Days pending stops counting the day the buyer decides. A waiver silences an alert until the date management set — it is suppressed, never deleted."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatTile label="Pending" value={num(pending.length)} tone={pending.length ? 'warn' : 'ok'} icon={<Banknote className="size-4" />} />
        <StatTile
          label="Blocking production" value={num(blocking.length)}
          tone={blocking.length ? 'risk' : 'ok'}
          caption={blocking.length ? blocking.map((a) => a.orderNo).join(', ') : 'nothing is held up'}
        />
        <StatTile label="Approved" value={num(approvals.filter((a) => a.status === 'Approved').length)} tone="ok" />
        <StatTile
          label="Live waivers" value={num(liveWaivers.length)} tone={liveWaivers.length ? 'info' : 'neutral'}
          icon={<ShieldCheck className="size-4" />} caption="alerts management has accepted"
        />
      </div>

      {blocking.length > 0 && (
        <Callout tone="risk" title="Production cannot start without these">
          {blocking.map((a) => `${a.orderNo} · ${a.approvalType}`).join(' · ')}
        </Callout>
      )}

      <Section title="Buyer approvals" description="Lab dips, fit approvals, strike-offs, PP samples — everything the buyer owes you." className="mt-5">
        <LogTable<ApprovalRow>
          collection="approvals"
          rows={approvals}
          fields={approvalFields}
          derived={approvalColumns}
          validate={requireFields<ApprovalRow>(approvalFields)}
          blank={() => ({
            orderNo: '', approvalType: '', required: true, status: 'Pending',
            sentDate: today(), decisionDate: '', blocksProduction: false, remarks: '',
          })}
          sortBy={(a, b) => (b.sentDate ?? '').localeCompare(a.sentDate ?? '')}
          rowTone={(row) => (row.required && row.status === 'Pending' && row.blocksProduction ? 'risk' : null)}
          maxHeight="max-h-[26rem]"
          emptyTitle="No approvals tracked"
        />
      </Section>

      <Section
        title="Management waivers"
        description="Accept a delay and the alert stops firing until the date you set. The dashboard still counts it."
        className="mt-6"
      >
        <LogTable<WaiverRow>
          collection="waivers"
          rows={waivers}
          fields={waiverFields}
          derived={waiverColumns}
          validate={requireFields<WaiverRow>(waiverFields)}
          blank={() => ({
            orderNo: '', alertType: '', approved: true, approvedBy: '',
            approvalDate: today(), validUntil: '', reason: '',
          })}
          sortBy={(a, b) => (b.approvalDate ?? '').localeCompare(a.approvalDate ?? '')}
          maxHeight="max-h-[26rem]"
          emptyTitle="No waivers"
          emptyDetail="When management accepts a delay, record it here and the alert stops firing until the date you set."
        />
      </Section>
    </>
  )
}
