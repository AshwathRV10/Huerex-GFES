/**
 * Settings — the handful of numbers that decide when an alert fires and what a
 * new costing starts from. Plus backup and restore, because the database is a
 * file and a copy of it is a full backup.
 */
import { useState } from 'react'
import { Cog, Download, Upload } from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { Badge, Button, Callout, Card, CardHeader, Field, Section } from '../components/ui'
import { api } from '../lib/api'
import { useStore } from '../lib/store'
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

      <Section
        title="Backup"
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
