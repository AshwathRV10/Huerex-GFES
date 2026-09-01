/**
 * Permission gating for the UI.
 *
 * This is convenience, not security. The server has already refused the data
 * and would refuse the write; these components exist so a user is not shown a
 * page full of buttons that will fail, or an empty table with no explanation.
 */
import type { ReactNode } from 'react'
import { Lock } from 'lucide-react'
import { Card, Empty } from './ui'
import { useStore } from '../lib/store'

/** True when the signed-in role grants the permission. */
export const usePermission = (permission: string) =>
  useStore((s) => s.session?.permissions.includes(permission) ?? false)

export const usePermissions = () =>
  useStore((s) => s.session?.permissions ?? [])

/** Renders children only with the permission; otherwise `fallback`, or nothing. */
export function Gate({
  permission, children, fallback = null,
}: { permission: string; children: ReactNode; fallback?: ReactNode }) {
  return usePermission(permission) ? <>{children}</> : <>{fallback}</>
}

/**
 * Wraps a whole page. Without the permission the user is told plainly rather
 * than shown a blank screen or bounced somewhere confusing.
 */
export function RequirePermission({
  permission, children, what,
}: { permission: string; children: ReactNode; what: string }) {
  const allowed = usePermission(permission)
  const roleName = useStore((s) => s.session?.roleName ?? 'your role')
  if (allowed) return <>{children}</>

  return (
    <Card className="mt-6">
      <Empty
        icon={<Lock className="size-5" />}
        title={`${what} is not part of your access`}
        detail={`${roleName} does not include the "${permission}" permission. If you need it, an administrator can add it to your role — or move you to a role that has it.`}
      />
    </Card>
  )
}

/** A small inline note where a field or figure has been withheld. */
export function Withheld({ label = 'Restricted' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-2xs text-ink-3" title="Your role does not include costing access">
      <Lock className="size-3" />
      {label}
    </span>
  )
}
