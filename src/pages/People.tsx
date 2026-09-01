/**
 * People and roles.
 *
 * Two things live here: the accounts, and what each role is allowed to do. The
 * permission matrix is the honest version of the access model — it is the same
 * list the server checks against, not a summary of it.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  KeyRound, Lock, Plus, ShieldCheck, UserPlus, Users as UsersIcon,
} from 'lucide-react'
import { PageHeader } from '../components/AppShell'
import { StatTile } from '../components/StatTile'
import {
  Badge, Button, Callout, Card, CardHeader, Empty, Field, Modal, Segmented, Toggle, Tooltip,
} from '../components/ui'
import { RequirePermission, usePermission } from '../components/Gate'
import { api, type AccountSummary, type PermissionDef, type RoleSummary } from '../lib/api'
import { useStore } from '../lib/store'
import { shortDate } from '../lib/format'

type Tab = 'people' | 'roles'

export default function People() {
  return (
    <RequirePermission permission="admin.users" what="Managing people">
      <PeopleInner />
    </RequirePermission>
  )
}

function PeopleInner() {
  const notify = useStore((s) => s.notify)
  const session = useStore((s) => s.session)
  const canManageRoles = usePermission('admin.roles')

  const [tab, setTab] = useState<Tab>('people')
  const [accounts, setAccounts] = useState<AccountSummary[]>([])
  const [roles, setRoles] = useState<RoleSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [resetting, setResetting] = useState<AccountSummary | null>(null)

  const refresh = async () => {
    setLoading(true)
    try {
      const [people, roleList] = await Promise.all([api.listUsers(), api.listRoles()])
      setAccounts(people)
      setRoles(roleList)
    } catch (error) {
      notify('risk', 'Could not load people', error instanceof Error ? error.message : undefined)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  const update = async (user: AccountSummary, patch: Parameters<typeof api.updateAccount>[1]) => {
    try {
      await api.updateAccount(user.id, patch)
      await refresh()
      notify('ok', 'Saved', `${user.displayName || user.userName} updated`)
    } catch (error) {
      notify('risk', 'Could not save that', error instanceof Error ? error.message : undefined)
    }
  }

  const active = accounts.filter((a) => a.active).length
  const withCosting = useMemo(() => {
    const costingRoles = new Set(
      roles.filter((r) => r.locked || (r.permissions ?? []).some((p) => p.startsWith('costing.'))).map((r) => r.id),
    )
    return accounts.filter((a) => a.active && costingRoles.has(a.roleId)).length
  }, [accounts, roles])

  return (
    <>
      <PageHeader
        title="People and roles"
        subtitle="What somebody can see and change is decided entirely by their role. Change a role and every session holding it is signed out at once."
        actions={
          tab === 'people'
            ? <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setAdding(true)}>Add a person</Button>
            : undefined
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatTile label="Accounts" value={String(accounts.length)} icon={<UsersIcon className="size-4" />} />
        <StatTile label="Active" value={String(active)} caption={accounts.length - active ? `${accounts.length - active} switched off` : 'all in use'} />
        <StatTile label="Roles" value={String(roles.length)} icon={<ShieldCheck className="size-4" />} />
        <StatTile
          label="Can see costing" value={String(withCosting)}
          caption="people who can see rates, costs and prices"
          tone={withCosting > 0 ? 'saffron' : 'neutral'}
        />
      </div>

      <Segmented
        value={tab}
        onChange={setTab}
        className="mb-4"
        options={[
          { value: 'people', label: `People · ${accounts.length}` },
          { value: 'roles', label: `Roles · ${roles.length}` },
        ]}
      />

      {loading ? (
        <Card><Empty title="Loading…" /></Card>
      ) : tab === 'people' ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="sticky-head">
                <tr className="text-2xs font-semibold uppercase tracking-[0.06em] text-ink-3">
                  <th className="text-left px-3 py-2">Person</th>
                  <th className="text-left px-3 py-2">Role</th>
                  <th className="text-left px-3 py-2 hidden md:table-cell">Last signed in</th>
                  <th className="text-left px-3 py-2 w-32">Active</th>
                  <th className="text-right px-3 py-2 w-40">Password</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => {
                  const isSelf = account.id === session?.userId
                  const role = roles.find((r) => r.id === account.roleId)
                  const seesCosting = role?.locked || (role?.permissions ?? []).some((p) => p.startsWith('costing.'))
                  return (
                    <tr key={account.id} className="border-b border-line/70 last:border-0 grid-row-hover">
                      <td className="px-3 py-2">
                        <span className="text-sm font-medium text-ink">
                          {account.displayName || account.userName}
                          {isSelf && <span className="text-ink-3 font-normal ml-1.5 text-xs">(you)</span>}
                        </span>
                        <span className="block text-2xs text-ink-3">{account.userName}</span>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={account.roleId}
                          disabled={isSelf}
                          title={isSelf ? 'You cannot change your own role' : undefined}
                          onChange={(e) => update(account, { roleId: e.target.value })}
                          className="field field-sm w-auto max-w-[12rem] disabled:opacity-50"
                        >
                          {roles.map((role) => (
                            <option key={role.id} value={role.id}>{role.name}</option>
                          ))}
                        </select>
                        {seesCosting && (
                          <Tooltip label="This role can see rates, costs, margins and buyer prices">
                            <Badge tone="saffron" className="ml-2">costing</Badge>
                          </Tooltip>
                        )}
                      </td>
                      <td className="px-3 py-2 text-sm text-ink-2 hidden md:table-cell">
                        {account.lastLoginAt ? shortDate(account.lastLoginAt.slice(0, 10)) : 'never'}
                        {account.mustChangePassword && (
                          <Badge tone="warn" className="ml-2">must change password</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Toggle
                          checked={account.active}
                          onChange={(value) => !isSelf && update(account, { active: value })}
                          label={account.active ? 'Active' : 'Off'}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button size="sm" variant="ghost" icon={<KeyRound className="size-3.5" />}
                          onClick={() => setResetting(account)}>
                          Reset
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {accounts.length === 0 && <Empty title="No accounts yet" />}
        </Card>
      ) : (
        <RoleEditor roles={roles} canEdit={canManageRoles} onChanged={refresh} />
      )}

      <AddPersonModal
        open={adding} roles={roles}
        onClose={() => setAdding(false)}
        onCreated={() => { setAdding(false); refresh() }}
      />
      <ResetPasswordModal
        account={resetting}
        onClose={() => setResetting(null)}
        onDone={() => { setResetting(null); refresh() }}
      />
    </>
  )
}

/* ── The permission matrix ───────────────────────────────────────────── */

function RoleEditor({
  roles, canEdit, onChanged,
}: { roles: RoleSummary[]; canEdit: boolean; onChanged: () => void }) {
  const notify = useStore((s) => s.notify)
  const catalogue = useStore((s) => s.session?.catalogue ?? []) as PermissionDef[]
  const [selectedId, setSelectedId] = useState(roles[0]?.id ?? '')
  const [draft, setDraft] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false)

  const selected = roles.find((r) => r.id === selectedId) ?? roles[0]

  useEffect(() => {
    if (!selectedId && roles.length) setSelectedId(roles[0].id)
  }, [roles, selectedId])
  useEffect(() => { setDraft(selected?.permissions ?? []) }, [selected?.id, selected?.permissions])

  const byModule = useMemo(() => {
    const map = new Map<string, PermissionDef[]>()
    for (const permission of catalogue) {
      const list = map.get(permission.module) ?? []
      list.push(permission)
      map.set(permission.module, list)
    }
    return [...map.entries()]
  }, [catalogue])

  if (!selected) return <Card><Empty title="No roles" /></Card>

  const dirty = JSON.stringify([...draft].sort()) !== JSON.stringify([...(selected.permissions ?? [])].sort())
  const locked = selected.locked

  const toggle = (key: string) =>
    setDraft((current) => current.includes(key) ? current.filter((k) => k !== key) : [...current, key])

  const save = async () => {
    setSaving(true)
    try {
      await api.updateRole(selected.id, { permissions: draft })
      notify('ok', 'Role saved', 'Everyone holding it has been signed out and must sign in again')
      onChanged()
    } catch (error) {
      notify('risk', 'Could not save the role', error instanceof Error ? error.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    try {
      await api.deleteRole(selected.id)
      notify('ok', 'Role deleted')
      setSelectedId('')
      onChanged()
    } catch (error) {
      notify('risk', 'Could not delete the role', error instanceof Error ? error.message : undefined)
    }
  }

  return (
    <div className="grid lg:grid-cols-[16rem_1fr] gap-5 items-start">
      <Card className="overflow-hidden">
        <CardHeader
          title="Roles"
          actions={canEdit
            ? <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)} />
            : undefined}
        />
        <div className="p-2 space-y-0.5">
          {roles.map((role) => (
            <button
              key={role.id}
              onClick={() => setSelectedId(role.id)}
              className={`w-full text-left rounded-lg px-2.5 py-2 transition-colors ${
                role.id === selected.id ? 'bg-brand-500/[0.11] text-brand-600' : 'hover:bg-ink/[0.04] text-ink-2'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <span className="text-sm font-medium truncate">{role.name}</span>
                {role.locked && <Lock className="size-3 text-ink-3 shrink-0" />}
              </span>
              <span className="block text-2xs text-ink-3 mt-0.5">
                {role.userCount} {role.userCount === 1 ? 'person' : 'people'} ·{' '}
                {role.locked ? 'every permission' : `${(role.permissions ?? []).length} permissions`}
              </span>
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader
          title={selected.name}
          subtitle={selected.description || 'No description'}
          actions={
            canEdit && !locked ? (
              <>
                {!selected.builtIn && selected.userCount === 0 && (
                  <Button size="sm" variant="quiet" className="hover:text-risk" onClick={remove}>Delete</Button>
                )}
                <Button size="sm" variant="primary" disabled={!dirty} loading={saving} onClick={save}>
                  Save role
                </Button>
              </>
            ) : undefined
          }
        />

        {locked && (
          <div className="px-4 pt-4">
            <Callout tone="info" title="The Administrator role always holds everything">
              It cannot be reduced or deleted — otherwise a mistake here could lock everybody out of their
              own system permanently.
            </Callout>
          </div>
        )}

        <div className="p-4 space-y-5">
          {byModule.map(([module, permissions]) => {
            const granted = permissions.filter((p) => locked || draft.includes(p.key)).length
            return (
              <section key={module}>
                <div className="flex items-baseline justify-between gap-3 mb-2">
                  <h3 className="text-sm font-semibold text-ink">{module}</h3>
                  <span className="text-2xs text-ink-3 num">{granted} of {permissions.length}</span>
                </div>
                <div className="space-y-1">
                  {permissions.map((permission) => {
                    const on = locked || draft.includes(permission.key)
                    return (
                      <label
                        key={permission.key}
                        className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors ${
                          on ? 'border-brand-500/30 bg-brand-500/[0.05]' : 'border-line hover:border-line-strong'
                        } ${canEdit && !locked ? 'cursor-pointer' : 'cursor-default'}`}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={!canEdit || locked}
                          onChange={() => toggle(permission.key)}
                          className="mt-0.5 size-3.5 accent-current shrink-0"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm text-ink">{permission.label}</span>
                            {permission.sensitive && <Badge tone="saffron">commercial</Badge>}
                            <code className="text-2xs text-ink-3">{permission.key}</code>
                          </span>
                          <span className="block text-xs text-ink-3 mt-0.5 leading-snug">{permission.detail}</span>
                        </span>
                      </label>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      </Card>

      <CreateRoleModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => { setCreating(false); onChanged() }}
      />
    </div>
  )
}

/* ── Modals ──────────────────────────────────────────────────────────── */

function AddPersonModal({
  open, roles, onClose, onCreated,
}: { open: boolean; roles: RoleSummary[]; onClose: () => void; onCreated: () => void }) {
  const notify = useStore((s) => s.notify)
  const [userName, setUserName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [roleId, setRoleId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setUserName(''); setDisplayName(''); setPassword(''); setError(null)
      setRoleId(roles.find((r) => r.name === 'Floor')?.id ?? roles[0]?.id ?? '')
    }
  }, [open, roles])

  const role = roles.find((r) => r.id === roleId)
  const seesCosting = role?.locked || (role?.permissions ?? []).some((p) => p.startsWith('costing.'))

  const submit = async () => {
    setBusy(true); setError(null)
    try {
      await api.createAccount({ userName, displayName, password, roleId })
      notify('ok', 'Account created', `${userName} must choose their own password at first sign-in`)
      onCreated()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not create the account')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open} onClose={onClose} title="Add a person" width="sm"
      subtitle="They will be asked to choose their own password the first time they sign in."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary" loading={busy}
            disabled={!userName.trim() || !password || !roleId}
            onClick={submit}
          >
            Create account
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Username" value={userName} autoCapitalize="none"
          hint="Letters, digits, dot, dash or underscore"
          onChange={(e) => setUserName(e.target.value)} autoFocus />
        <Field label="Their name" value={displayName} placeholder="Sambath"
          onChange={(e) => setDisplayName(e.target.value)} />
        <Field label="Starting password" type="password" value={password}
          hint="At least 10 characters, and not containing their username"
          onChange={(e) => setPassword(e.target.value)} />
        <label className="block">
          <span className="label">Role</span>
          <select value={roleId} onChange={(e) => setRoleId(e.target.value)} className="field">
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          {role?.description && <span className="block mt-1 text-2xs text-ink-3">{role.description}</span>}
        </label>

        {seesCosting && (
          <Callout tone="warn" title="This role can see costing">
            {role?.name} includes access to rates, cost per garment, margins and the prices quoted to
            buyers. Only give it to people who should see the commercials.
          </Callout>
        )}
        {error && (
          <div className="rounded-lg border border-risk/30 bg-risk/[0.07] px-3 py-2.5">
            <p className="text-sm text-ink-2">{error}</p>
          </div>
        )}
      </div>
    </Modal>
  )
}

function ResetPasswordModal({
  account, onClose, onDone,
}: { account: AccountSummary | null; onClose: () => void; onDone: () => void }) {
  const notify = useStore((s) => s.notify)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setPassword(''); setError(null) }, [account?.id])

  const submit = async () => {
    if (!account) return
    setBusy(true); setError(null)
    try {
      await api.resetPassword(account.id, password)
      notify('ok', 'Password reset', `${account.userName} is signed out and must choose a new password`)
      onDone()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not reset the password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={!!account} onClose={onClose} width="sm"
      title={`Reset password for ${account?.displayName || account?.userName}`}
      subtitle="Every session they have open will be signed out, and they must choose their own password next time."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!password} onClick={submit}>Reset password</Button>
        </>
      }
    >
      <Field
        label="Temporary password" type="password" value={password} autoFocus
        hint="Tell them in person. Nothing here sends email."
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && (
        <div className="mt-3 rounded-lg border border-risk/30 bg-risk/[0.07] px-3 py-2.5">
          <p className="text-sm text-ink-2">{error}</p>
        </div>
      )}
    </Modal>
  )
}

function CreateRoleModal({
  open, onClose, onCreated,
}: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const notify = useStore((s) => s.notify)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { if (open) { setName(''); setDescription(''); setError(null) } }, [open])

  const submit = async () => {
    setBusy(true); setError(null)
    try {
      await api.createRole({ name, description, permissions: [] })
      notify('ok', 'Role created', 'It starts with no permissions — tick what it should allow')
      onCreated()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not create the role')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open} onClose={onClose} title="New role" width="sm"
      subtitle="A new role starts with nothing allowed. Tick the permissions it should grant, then save."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={submit}>Create role</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name" value={name} placeholder="Quality" autoFocus onChange={(e) => setName(e.target.value)} />
        <Field label="What it is for" value={description}
          placeholder="Runs checking and inspection, no commercials"
          onChange={(e) => setDescription(e.target.value)} />
        {error && (
          <div className="rounded-lg border border-risk/30 bg-risk/[0.07] px-3 py-2.5">
            <p className="text-sm text-ink-2">{error}</p>
          </div>
        )}
      </div>
    </Modal>
  )
}
