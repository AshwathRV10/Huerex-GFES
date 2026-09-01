/**
 * The audit log.
 *
 * Who changed what, when, and what the value was before. A costing rate or a
 * buyer price that moves overnight is exactly the kind of thing somebody
 * eventually needs to trace, so the before/after is shown inline rather than
 * hidden behind an expander.
 */
import { useEffect, useMemo, useState } from 'react'
import { History, Lock, RefreshCw, ShieldAlert } from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { StatTile } from '../components/StatTile'
import { Badge, Button, Card, Empty, Segmented, Tooltip } from '../components/ui'
import { RequirePermission } from '../components/Gate'
import { api, type AuditEntry } from '../lib/api'
import { useStore } from '../lib/store'

export default function AuditLogPage() {
  return (
    <RequirePermission permission="audit.view" what="The audit log">
      <AuditInner />
    </RequirePermission>
  )
}

const ACTION_TONE: Record<string, 'ok' | 'warn' | 'risk' | 'info' | 'neutral' | 'saffron'> = {
  login: 'ok',
  logout: 'neutral',
  'login.failed': 'risk',
  'access.denied': 'risk',
  create: 'ok',
  update: 'info',
  delete: 'risk',
  'user.create': 'saffron',
  'user.update': 'saffron',
  'user.password': 'saffron',
  'user.deactivate': 'risk',
  'role.create': 'saffron',
  'role.update': 'saffron',
  'role.delete': 'risk',
  'backup.download': 'saffron',
  'backup.restore': 'risk',
  'data.reset': 'risk',
  'settings.update': 'info',
  'masters.update': 'neutral',
}

type Filter = 'all' | 'sensitive' | 'security'

function AuditInner() {
  const notify = useStore((s) => s.notify)
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')

  const refresh = async () => {
    setLoading(true)
    try {
      setEntries(await api.audit({ limit: 1000 }))
    } catch (error) {
      notify('risk', 'Could not load the audit log', error instanceof Error ? error.message : undefined)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  const shown = useMemo(() => {
    let list = entries
    if (filter === 'sensitive') list = list.filter((e) => e.sensitive)
    if (filter === 'security') {
      list = list.filter((e) =>
        e.action === 'access.denied' || e.action === 'login.failed' ||
        e.action.startsWith('user.') || e.action.startsWith('role.'))
    }
    const needle = query.trim().toLowerCase()
    if (needle) {
      list = list.filter((e) =>
        `${e.userName} ${e.action} ${e.target} ${e.summary} ${e.recordId ?? ''}`.toLowerCase().includes(needle))
    }
    return list
  }, [entries, filter, query])

  const denied = entries.filter((e) => e.action === 'access.denied').length
  const failedLogins = entries.filter((e) => e.action === 'login.failed').length
  const sensitive = entries.filter((e) => e.sensitive).length

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Append-only. Nothing in the application deletes from it, and it records the value before a change as well as after."
        actions={
          <Button icon={<RefreshCw className="size-4" />} onClick={refresh} loading={loading}>Refresh</Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatTile label="Entries" value={String(entries.length)} icon={<History className="size-4" />} />
        <StatTile label="Commercial actions" value={String(sensitive)} caption="touched rates, prices or access" tone={sensitive ? 'saffron' : 'neutral'} />
        <StatTile
          label="Refused attempts" value={String(denied)}
          caption={denied ? 'somebody asked for something their role forbids' : 'nobody has hit a wall'}
          tone={denied ? 'warn' : 'ok'} icon={<ShieldAlert className="size-4" />}
        />
        <StatTile
          label="Failed sign-ins" value={String(failedLogins)}
          tone={failedLogins > 5 ? 'risk' : failedLogins ? 'warn' : 'ok'}
        />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-line bg-raised/60">
          <Segmented
            size="sm" value={filter} onChange={setFilter}
            options={[
              { value: 'all', label: 'Everything' },
              { value: 'sensitive', label: 'Commercial' },
              { value: 'security', label: 'Access & accounts' },
            ]}
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search person, action or record…"
            className="field field-sm max-w-xs"
          />
          <span className="ml-auto text-2xs text-ink-3 num">{shown.length} shown</span>
        </div>

        {shown.length === 0 ? (
          <Empty
            icon={<History className="size-5" />}
            title={entries.length ? 'Nothing matches that filter' : 'The log is empty'}
            detail={entries.length ? undefined : 'It fills as soon as anybody signs in or changes something.'}
          />
        ) : (
          <div className="divide-y divide-line max-h-[calc(100vh-24rem)] overflow-y-auto">
            {shown.map((entry) => <Row key={entry.id} entry={entry} />)}
          </div>
        )}
      </Card>
    </>
  )
}

function Row({ entry }: { entry: AuditEntry }) {
  const hasDiff = entry.before !== null || entry.after !== null
  const [open, setOpen] = useState(false)

  return (
    <div className="px-4 py-2.5 hover:bg-ink/[0.02] transition-colors">
      <div className="flex items-start gap-3">
        <span className="shrink-0 pt-0.5">
          <Badge tone={ACTION_TONE[entry.action] ?? 'neutral'}>{entry.action}</Badge>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-ink leading-snug">{entry.summary}</p>
          <p className="text-2xs text-ink-3 mt-0.5 flex items-center gap-2 flex-wrap">
            <span className="font-medium text-ink-2">{entry.userName}</span>
            <span>{entry.roleName}</span>
            <span>·</span>
            <span className="num">{new Date(entry.at).toLocaleString('en-GB')}</span>
            <span>·</span>
            <span className="num">{entry.target}</span>
            {entry.ip && entry.ip !== 'unknown' && (
              <Tooltip label="Where the request came from"><span className="num">{entry.ip}</span></Tooltip>
            )}
            {entry.sensitive && <Lock className="size-3 text-saffron" />}
          </p>

          {hasDiff && open && (
            <div className="mt-2 grid sm:grid-cols-2 gap-2">
              <Snapshot label="Before" value={entry.before} tone="risk" />
              <Snapshot label="After" value={entry.after} tone="ok" />
            </div>
          )}
        </div>
        {hasDiff && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 text-2xs text-brand-600 hover:underline pt-0.5"
          >
            {open ? 'hide' : 'what changed'}
          </button>
        )}
      </div>
    </div>
  )
}

function Snapshot({ label, value, tone }: { label: string; value: unknown; tone: 'risk' | 'ok' }) {
  const empty = value === null || value === undefined ||
    (typeof value === 'object' && Object.keys(value as object).length === 0)
  return (
    <div className={`rounded-lg border px-2.5 py-2 ${
      tone === 'risk' ? 'border-risk/25 bg-risk/[0.04]' : 'border-ok/25 bg-ok/[0.04]'
    }`}>
      <p className="text-2xs font-semibold uppercase tracking-[0.07em] text-ink-3 mb-1">{label}</p>
      {empty ? (
        <p className="text-xs text-ink-3">—</p>
      ) : (
        <pre className="text-2xs text-ink-2 whitespace-pre-wrap break-words font-mono leading-relaxed max-h-40 overflow-y-auto">
          {JSON.stringify(value, null, 1)}
        </pre>
      )}
    </div>
  )
}
