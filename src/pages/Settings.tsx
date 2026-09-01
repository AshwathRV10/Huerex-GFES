/**
 * Settings — the handful of numbers that decide when an alert fires and what a
 * new costing starts from. Plus backup and restore, because the database is a
 * file and a copy of it is a full backup.
 */
import { useEffect, useState } from 'react'
import {
  Cog, Download, HardDriveDownload, ShieldCheck, TriangleAlert, Upload,
} from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import {
  Badge, Button, Callout, Card, CardHeader, Field, Section, Toggle,
} from '../components/ui'
import { api, type BackupSchedule, type BackupSettings } from '../lib/api'
import { useStore } from '../lib/store'
import type { Company } from '../lib/types'
import type { ProcessTypes } from '../lib/engine/production'
import type { Settings } from '../lib/types'

export default function SettingsPage() {
  const settings = useStore((s) => s.settings)
  const saveSettings = useStore((s) => s.saveSettings)
  const processTypes = useStore((s) => s.processTypes)
  const saveProcessTypes = useStore((s) => s.saveProcessTypes)
  const masters = useStore((s) => s.masters)
  const notify = useStore((s) => s.notify)
  const load = useStore((s) => s.load)
  const [restoring, setRestoring] = useState(false)

  const setNumber = (key: keyof Settings) => (value: string) => {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) saveSettings({ [key]: parsed } as Partial<Settings>)
  }
  const setPercent = (key: keyof Settings) => (value: string) => {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) saveSettings({ [key]: parsed / 100 } as Partial<Settings>)
  }

  const allProcesses = [...new Set([...(masters.processes ?? []), ...Object.keys(processTypes)])].sort()

  const toggleProcess = (process: string) => {
    const next: ProcessTypes = {
      ...processTypes,
      [process]: (processTypes[process] ?? 'In-house') === 'In-house' ? 'Outsourced' : 'In-house',
    }
    saveProcessTypes(next)
  }

  const restore = async (file: File) => {
    setRestoring(true)
    try {
      const text = await file.text()
      await api.restore(JSON.parse(text))
      await load()
      notify('ok', 'Backup restored', 'Every sheet has been replaced with the file you chose')
    } catch (error) {
      notify('risk', 'Could not restore that file', error instanceof Error ? error.message : String(error))
    } finally {
      setRestoring(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="A small number of figures decide when the system starts asking for your attention, and what a new costing assumes before anyone types a rate."
      />

      <div className="grid lg:grid-cols-2 gap-5 items-start">
        <Card>
          <CardHeader title="When alerts fire" subtitle="Change only the number — the checks themselves are fixed." icon={<Cog className="size-4" />} />
          <div className="p-4 grid sm:grid-cols-2 gap-4">
            <Field
              label="Default fabric lead" suffix="days" defaultValue={settings.defaultFabricLeadDays}
              hint="Used when an order does not state its own"
              onBlur={(e) => setNumber('defaultFabricLeadDays')(e.target.value)}
            />
            <Field
              label="Fabric due-soon window" suffix="days" defaultValue={settings.fabricDueSoonWindowDays}
              hint="How early the fabric alert opens"
              onBlur={(e) => setNumber('fabricDueSoonWindowDays')(e.target.value)}
            />
            <Field
              label="Recut lead" suffix="days" defaultValue={settings.recutLeadDays}
              hint="Decision-by is ex-factory minus this"
              onBlur={(e) => setNumber('recutLeadDays')(e.target.value)}
            />
            <Field
              label="Recut notice window" suffix="days" defaultValue={settings.recutDueNoticeWindowDays}
              hint="How early the recut alert opens"
              onBlur={(e) => setNumber('recutDueNoticeWindowDays')(e.target.value)}
            />
            <Field
              label="Aged WIP after" suffix="days" defaultValue={settings.agedWipDays}
              hint="A pile that has not moved for this long is flagged"
              onBlur={(e) => setNumber('agedWipDays')(e.target.value)}
            />
            <Field
              label="Job work watch after" suffix="days" defaultValue={settings.jobWorkWatchDays}
              hint="Pieces at a vendor for this long become high severity"
              onBlur={(e) => setNumber('jobWorkWatchDays')(e.target.value)}
            />
            <Field
              label="Fabric wastage threshold" suffix="%" defaultValue={settings.fabricWastageThresholdPct * 100}
              hint="Above this, unaccounted fabric is flagged"
              onBlur={(e) => setPercent('fabricWastageThresholdPct')(e.target.value)}
            />
            <Field
              label="DHU threshold" suffix="%" defaultValue={settings.dhuThresholdPct * 100}
              hint="Above this, quality is flagged"
              onBlur={(e) => setPercent('dhuThresholdPct')(e.target.value)}
            />
          </div>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader
              title="What a new costing starts from"
              subtitle="Only the starting point — every costing can be changed line by line."
            />
            <div className="p-4 grid sm:grid-cols-2 gap-4">
              <Field
                label="Currency" defaultValue={settings.currency}
                onBlur={(e) => saveSettings({ currency: e.target.value.toUpperCase() })}
              />
              <Field
                label="Rejection allowance" suffix="%" defaultValue={settings.defaultRejectionPct * 100}
                hint="Pieces expected to fail checking"
                onBlur={(e) => setPercent('defaultRejectionPct')(e.target.value)}
              />
              <Field
                label="Fabric wastage" suffix="%" defaultValue={settings.defaultFabricWastagePct * 100}
                hint="Cutting loss and end bits"
                onBlur={(e) => setPercent('defaultFabricWastagePct')(e.target.value)}
              />
              <Field
                label="Trim wastage" suffix="%" defaultValue={settings.defaultTrimWastagePct * 100}
                hint="Breakage and short rolls"
                onBlur={(e) => setPercent('defaultTrimWastagePct')(e.target.value)}
              />
            </div>
            <Callout tone="info" title="Excess is not set here">
              <span>
                Excess differs buyer to buyer, so it lives on the buyer, not in a global default. An order can
                still override its buyer's figure on its own costing.
              </span>
            </Callout>
          </Card>

          <Card>
            <CardHeader
              title="In-house or outsourced"
              subtitle="Which processes go to a vendor. Outsourced steps are logged on the Job work page; in-house steps have their own."
            />
            <div className="p-4 flex flex-wrap gap-1.5">
              {allProcesses.map((process) => {
                const outsourced = (processTypes[process] ?? 'In-house') === 'Outsourced'
                return (
                  <button key={process} type="button" onClick={() => toggleProcess(process)}>
                    <Badge tone={outsourced ? 'saffron' : 'neutral'} className="h-7 px-2.5 cursor-pointer hover:opacity-80">
                      {process}
                      <span className="opacity-60 ml-1">{outsourced ? 'vendor' : 'in-house'}</span>
                    </Badge>
                  </button>
                )
              })}
            </div>
          </Card>
        </div>
      </div>

      <YourFactory />

      <AutomaticBackup />

      <Section
        title="Backup by hand"
        description="The whole database is one file. A copy of it is a complete backup, and it can be restored on any machine."
        className="mt-6"
      >
        <Card className="p-4 flex flex-wrap items-center gap-3">
          <a href={api.backupUrl} download>
            <Button icon={<Download className="size-4" />}>Download a backup</Button>
          </a>
          <label
            className="inline-flex items-center justify-center h-9 px-3.5 gap-2 rounded-lg font-medium cursor-pointer
                       bg-surface text-ink border border-line transition-all
                       hover:border-line-strong hover:bg-raised active:scale-[.985]"
          >
            <input
              type="file"
              accept="application/json"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) restore(file)
                e.target.value = ''
              }}
            />
            {restoring
              ? <span className="size-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
              : <Upload className="size-4" />}
            Restore from a backup
          </label>
          <p className="text-xs text-ink-3 flex-1 min-w-[16rem] leading-relaxed">
            Restoring replaces everything — every order, every transaction, every rate. Take a backup first.
          </p>
        </Card>
      </Section>
    </>
  )
}

/* ── Automatic backup ─────────────────────────────────────────────────── */

const pad = (n: number) => String(n).padStart(2, '0')

/** "3 hours ago", and plainly when it is long enough ago to matter. */
function howLongAgo(iso: string): { text: string; stale: boolean } {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 60) return { text: minutes <= 1 ? 'just now' : `${minutes} minutes ago`, stale: false }
  const hours = Math.round(minutes / 60)
  if (hours < 24) return { text: `${hours} hour${hours === 1 ? '' : 's'} ago`, stale: false }
  const days = Math.round(hours / 24)
  return { text: `${days} day${days === 1 ? '' : 's'} ago`, stale: days >= 2 }
}

const readableSize = (bytes: number) =>
  bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`

function AutomaticBackup() {
  const notify = useStore((s) => s.notify)
  const [schedule, setSchedule] = useState<BackupSchedule | null>(null)
  const [folder, setFolder] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = async () => {
    try {
      const next = await api.backupSchedule()
      setSchedule(next)
      setFolder(next.settings.folder)
    } catch (error) {
      notify('risk', 'Could not read the backup settings', error instanceof Error ? error.message : undefined)
    }
  }

  useEffect(() => { refresh() }, [])

  const save = async (patch: Partial<BackupSettings>) => {
    try {
      const next = await api.saveBackupSchedule(patch)
      setSchedule(next)
      setFolder(next.settings.folder)
    } catch (error) {
      notify('risk', 'Could not save that', error instanceof Error ? error.message : undefined)
      refresh()
    }
  }

  const runNow = async () => {
    setBusy(true)
    try {
      await api.runBackup()
      await refresh()
      notify('ok', 'Backup written', 'A copy of the whole database is in the backup folder.')
    } catch (error) {
      await refresh()
      notify('risk', 'The backup failed', error instanceof Error ? error.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  if (!schedule) return null
  const { settings, status } = schedule
  const last = status.lastAt ? howLongAgo(status.lastAt) : null
  // A backup that failed, or has not run in two days, is the whole reason this
  // panel exists — so it says so rather than showing a tidy green tick.
  const wrong = !!status.lastError || (settings.enabled && (!status.lastAt || last?.stale))

  return (
    <Section
      title="Automatic backup"
      description="A dated copy of the database, written every day without anybody having to remember."
      className="mt-6"
      actions={
        <Button
          icon={<HardDriveDownload className="size-4" />}
          loading={busy}
          onClick={runNow}
        >
          Back up now
        </Button>
      }
    >
      <Card className="p-4 space-y-4">
        <div className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 ${
          wrong ? 'border-warn/30 bg-warn/[0.06]' : 'border-ok/25 bg-ok/[0.05]'
        }`}>
          {wrong
            ? <TriangleAlert className="size-4 text-warn shrink-0 mt-0.5" />
            : <ShieldCheck className="size-4 text-ok shrink-0 mt-0.5" />}
          <div className="min-w-0 flex-1">
            {status.lastError ? (
              <>
                <p className="text-sm font-semibold text-ink">The last backup did not work</p>
                <p className="text-sm text-ink-2 mt-1 leading-relaxed break-words">{status.lastError}</p>
                <p className="text-xs text-ink-3 mt-1.5">
                  Until this is fixed there is no fresh copy of your data. Check the folder below still
                  exists and that the drive or share it is on is connected.
                </p>
              </>
            ) : !settings.enabled ? (
              <>
                <p className="text-sm font-semibold text-ink">Automatic backup is off</p>
                <p className="text-xs text-ink-3 mt-1 leading-relaxed">
                  Nothing is being copied. If this machine's disk fails, everything entered since the
                  last manual backup is gone.
                </p>
              </>
            ) : status.lastAt ? (
              <>
                <p className="text-sm font-semibold text-ink">
                  Last backup {last!.text}
                  {last!.stale && ' — longer ago than it should be'}
                </p>
                <p className="text-xs text-ink-3 mt-1 leading-relaxed break-all">
                  {status.lastBytes ? `${readableSize(status.lastBytes)} · ` : ''}
                  {status.lastPath}
                  {status.lastReason ? ` · ${status.lastReason}` : ''}
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-ink">No backup has run yet</p>
                <p className="text-xs text-ink-3 mt-1 leading-relaxed">
                  The first one will run at {pad(settings.hour)}:{pad(settings.minute)}. Use
                  <strong className="font-medium"> Back up now</strong> to check the folder works before then.
                </p>
              </>
            )}
          </div>
        </div>

        <Toggle
          checked={settings.enabled}
          onChange={(v) => save({ enabled: v })}
          label="Back up every day"
          hint="Runs on this machine, whether or not anybody is signed in"
        />

        <div className="grid sm:grid-cols-[1fr_auto_auto] gap-3 items-end">
          <Field
            label="Backup folder"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            onBlur={() => folder !== settings.folder && save({ folder })}
            hint="A second drive, a network share or a synced folder is worth far more than another folder on this disk"
          />
          <Field
            label="Time"
            type="time"
            value={`${pad(settings.hour)}:${pad(settings.minute)}`}
            onChange={(e) => {
              const [h, m] = e.target.value.split(':').map(Number)
              if (Number.isFinite(h) && Number.isFinite(m)) save({ hour: h, minute: m })
            }}
            hint="After the factory day"
          />
          <Field
            label="Keep"
            type="number"
            value={String(settings.keep)}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (Number.isFinite(n) && n >= 1) save({ keep: n })
            }}
            hint="copies"
          />
        </div>

        <Callout tone="info" title="What is in the file, and what is not">
          Every order, rate, costing and price, in plain text — treat the folder like the costing sheet
          it is. Passwords are not in it: they are stored as hashes and those are excluded, so a restore
          keeps the accounts that already exist rather than bringing old ones back.
        </Callout>
      </Card>
    </Section>
  )
}

/* ── The letterhead on printed documents ──────────────────────────────── */

const EMPTY_COMPANY: Company = {
  name: '', addressLines: '', gstin: '', phone: '', email: '',
  challanNote: 'Goods sent for job work and to be returned.',
}

function YourFactory() {
  const settings = useStore((s) => s.settings)
  const saveSettings = useStore((s) => s.saveSettings)
  const company: Company = { ...EMPTY_COMPANY, ...(settings.company ?? {}) }
  const [draft, setDraft] = useState<Company>(company)

  // Follow the stored values when they change under us — a colleague editing
  // them, or the first load arriving after this rendered.
  useEffect(() => { setDraft({ ...EMPTY_COMPANY, ...(settings.company ?? {}) }) }, [settings.company])

  const commit = (patch: Partial<Company>) => {
    const next = { ...draft, ...patch }
    setDraft(next)
    if (JSON.stringify(next) !== JSON.stringify(company)) saveSettings({ company: next })
  }

  return (
    <Section
      title="Your factory"
      description="Printed on the top of every challan and cost sheet. Nothing here is filled in for you — a challan carrying a made-up name or GSTIN would be worse than a blank one."
      className="mt-6"
    >
      <Card className="p-4 space-y-4">
        {!company.name.trim() && (
          <Callout tone="warn" title="Documents will print without a letterhead">
            Until the name is filled in, a challan handed to a vendor has nothing on it saying who sent it.
          </Callout>
        )}

        <div className="grid sm:grid-cols-2 gap-3">
          <Field
            label="Factory name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            onBlur={() => commit({})}
            placeholder="As it should appear on a challan"
          />
          <Field
            label="GSTIN"
            value={draft.gstin}
            onChange={(e) => setDraft({ ...draft, gstin: e.target.value.toUpperCase() })}
            onBlur={() => commit({})}
            hint="Left blank if you would rather not print it"
          />
        </div>

        <label className="block">
          <span className="block text-2xs font-semibold uppercase tracking-[0.07em] text-ink-3 mb-1.5">
            Address
          </span>
          <textarea
            value={draft.addressLines}
            onChange={(e) => setDraft({ ...draft, addressLines: e.target.value })}
            onBlur={() => commit({})}
            rows={3}
            placeholder={'Street\nCity, State  PIN'}
            className="field w-full resize-y leading-relaxed"
          />
          <span className="block text-2xs text-ink-3 mt-1">One line per line, as you want it printed</span>
        </label>

        <div className="grid sm:grid-cols-2 gap-3">
          <Field
            label="Phone" value={draft.phone}
            onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
            onBlur={() => commit({})}
          />
          <Field
            label="Email" value={draft.email}
            onChange={(e) => setDraft({ ...draft, email: e.target.value })}
            onBlur={() => commit({})}
          />
        </div>

        <label className="block">
          <span className="block text-2xs font-semibold uppercase tracking-[0.07em] text-ink-3 mb-1.5">
            Note at the foot of a challan
          </span>
          <textarea
            value={draft.challanNote}
            onChange={(e) => setDraft({ ...draft, challanNote: e.target.value })}
            onBlur={() => commit({})}
            rows={2}
            className="field w-full resize-y leading-relaxed"
          />
          <span className="block text-2xs text-ink-3 mt-1">
            Your own wording. How goods sent for job work should be described is yours to state, so nothing
            about it is assumed here.
          </span>
        </label>
      </Card>
    </Section>
  )
}
