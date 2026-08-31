/**
 * Every open alert, and everything management has accepted.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { StatTile } from '../components/StatTile'
import { Badge, Button, Card, CardHeader, Empty, Segmented } from '../components/ui'
import { useDerived } from '../lib/store'
import { num } from '../lib/format'
import { ALERT_TYPES, type Alert } from '../lib/engine/alerts'

export default function Alerts() {
  const { alerts } = useDerived()
  const [severity, setSeverity] = useState<'all' | 'HIGH' | 'MEDIUM'>('all')
  const [type, setType] = useState<string>('all')

  const open = useMemo(
    () => alerts.open.filter(
      (a) => (severity === 'all' || a.severity === severity) && (type === 'all' || a.type === type),
    ),
    [alerts.open, severity, type],
  )

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const alert of alerts.open) map.set(alert.type, (map.get(alert.type) ?? 0) + 1)
    return map
  }, [alerts.open])

  const high = alerts.open.filter((a) => a.severity === 'HIGH')
  const affected = new Set(alerts.open.map((a) => a.orderNo))

  return (
    <>
      <PageHeader
        title="Alerts"
        subtitle="Fourteen checks run over every live order. Accepting a delay suppresses the alert until the date management set — it is never deleted."
        actions={<Link to="/approvals"><Button size="sm" variant="ghost">Manage waivers</Button></Link>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatTile label="Open" value={num(alerts.open.length)} tone={alerts.open.length ? 'warn' : 'ok'} icon={<AlertTriangle className="size-4" />} />
        <StatTile label="High severity" value={num(high.length)} tone={high.length ? 'risk' : 'ok'} />
        <StatTile label="Orders affected" value={num(affected.size)} />
        <StatTile
          label="Under management approval" value={num(alerts.suppressed.length)}
          tone={alerts.suppressed.length ? 'info' : 'neutral'} icon={<ShieldCheck className="size-4" />}
        />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-line bg-raised/60">
          <Segmented
            size="sm" value={severity} onChange={setSeverity}
            options={[
              { value: 'all', label: 'All' },
              { value: 'HIGH', label: 'High' },
              { value: 'MEDIUM', label: 'Medium' },
            ]}
          />
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="field field-sm w-auto max-w-[14rem]"
          >
            <option value="all">Every check</option>
            {ALERT_TYPES.filter((t) => counts.has(t)).map((t) => (
              <option key={t} value={t}>{t} ({counts.get(t)})</option>
            ))}
          </select>
          <span className="ml-auto text-2xs text-ink-3 num">{open.length} shown</span>
        </div>

        {open.length === 0 ? (
          <Empty
            icon={<ShieldCheck className="size-5" />}
            title={alerts.open.length === 0 ? 'Nothing is asking for you' : 'Nothing matches that filter'}
            detail={alerts.open.length === 0
              ? 'Every order is inside its dates, nothing is stalled on the floor, and the buyer owes you nothing.'
              : undefined}
          />
        ) : (
          <div className="divide-y divide-line">
            {open.map((alert) => <Row key={alert.id} alert={alert} />)}
          </div>
        )}
      </Card>

      {alerts.suppressed.length > 0 && (
        <Card className="mt-5 overflow-hidden">
          <CardHeader
            title="Accepted by management"
            subtitle="These are still true — they have simply been agreed to, and will fire again when the waiver lapses."
            icon={<ShieldCheck className="size-4" />}
          />
          <div className="divide-y divide-line">
            {alerts.suppressed.map((alert) => <Row key={alert.id} alert={alert} suppressed />)}
          </div>
        </Card>
      )}
    </>
  )
}

function Row({ alert, suppressed }: { alert: Alert; suppressed?: boolean }) {
  return (
    <div className={`flex items-start gap-3 px-4 py-3 transition-colors hover:bg-ink/[0.02] ${suppressed ? 'opacity-70' : ''}`}>
      <span
        className={`mt-1.5 size-1.5 rounded-full shrink-0 ${
          suppressed ? 'bg-info' : alert.severity === 'HIGH' ? 'bg-risk' : 'bg-warn'
        }`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            to={`/orders/${encodeURIComponent(alert.orderNo)}`}
            className="text-sm font-medium text-ink hover:text-brand-600 transition-colors"
          >
            {alert.orderNo}
          </Link>
          <Badge tone={suppressed ? 'info' : alert.severity === 'HIGH' ? 'risk' : 'warn'}>{alert.type}</Badge>
          <span className="text-2xs text-ink-3">{alert.buyer}</span>
          {suppressed && alert.suppressedUntil && (
            <span className="text-2xs text-info">suppressed until {alert.suppressedUntil}</span>
          )}
        </div>
        <p className="text-sm text-ink-2 mt-1 leading-snug">{alert.message}</p>
        <p className="text-xs text-ink-3 mt-1 leading-snug">{alert.action}</p>
      </div>
      <div className="shrink-0 text-right">
        <span className="block text-2xs text-ink-3">{alert.owner}</span>
        {alert.qty > 0 && <span className="block text-sm num text-ink-2 mt-0.5">{num(alert.qty)}</span>}
        {alert.days > 0 && <span className="block text-2xs text-ink-3 num">{alert.days}d</span>}
      </div>
    </div>
  )
}
