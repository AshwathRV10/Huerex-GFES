/**
 * Sign in — and, on a brand new installation, the screen that creates the
 * first administrator.
 *
 * The password rules are stated before they are broken, so nobody types a
 * password twice to be told the second time what was wrong with the first.
 */
import { useEffect, useMemo, useState } from 'react'
import { Check, KeyRound, Loader2, Shirt, TriangleAlert } from 'lucide-react'
import { Button, Callout, Field } from '../components/ui'
import { useStore } from '../lib/store'

export default function SignIn() {
  const needsBootstrap = useStore((s) => s.needsBootstrap)
  return needsBootstrap ? <Bootstrap /> : <LoginForm />
}

/* ── Shared frame ────────────────────────────────────────────────────── */

function Frame({ title, subtitle, children }: {
  title: string; subtitle: string; children: React.ReactNode
}) {
  return (
    <div className="min-h-full grid place-items-center bg-canvas grain px-4 py-10">
      <div className="w-full max-w-sm animate-slide-up">
        <div className="flex items-center gap-3 mb-7">
          <span className="size-10 rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 grid place-items-center shadow-lift shrink-0">
            <Shirt className="size-5 text-white" />
          </span>
          <span>
            <span className="block font-semibold text-ink text-lg leading-none tracking-tight">HUEREX</span>
            <span className="block text-2xs text-ink-3 mt-1 tracking-[0.12em] uppercase">
              Execution &amp; Costing
            </span>
          </span>
        </div>

        <h1 className="text-xl font-semibold text-ink tracking-tight">{title}</h1>
        <p className="text-sm text-ink-3 mt-1.5 leading-relaxed">{subtitle}</p>

        <div className="mt-6">{children}</div>
      </div>
    </div>
  )
}

/* ── Normal sign in ──────────────────────────────────────────────────── */

function LoginForm() {
  const signIn = useStore((s) => s.signIn)
  const [userName, setUserName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!userName.trim() || !password) return
    setBusy(true)
    setError(null)
    try {
      await signIn(userName, password)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not sign in')
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Frame title="Sign in" subtitle="Your account decides what you can see and change.">
      <form onSubmit={submit} className="space-y-4">
        <Field
          label="Username"
          value={userName}
          autoComplete="username"
          autoCapitalize="none"
          autoFocus
          onChange={(e) => setUserName(e.target.value)}
        />
        <Field
          label="Password"
          type="password"
          value={password}
          autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-risk/30 bg-risk/[0.07] px-3 py-2.5">
            <TriangleAlert className="size-4 text-risk shrink-0 mt-px" />
            <p className="text-sm text-ink-2 leading-snug">{error}</p>
          </div>
        )}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full"
          loading={busy}
          disabled={!userName.trim() || !password}
        >
          Sign in
        </Button>
      </form>

      <p className="mt-6 text-xs text-ink-3 leading-relaxed">
        Forgotten your password? An administrator can reset it for you from the People page — there is
        no email recovery, because this system does not send any.
      </p>
    </Frame>
  )
}

/* ── First run ───────────────────────────────────────────────────────── */

const RULES = [
  { test: (p: string) => p.length >= 10, label: 'At least 10 characters' },
  { test: (p: string) => !/^\d+$/.test(p), label: 'Not digits alone' },
  {
    test: (p: string) => !['password', '12345678', 'qwerty', 'huerex', 'admin123', 'letmein', 'welcome']
      .some((c) => p.toLowerCase().includes(c)),
    label: 'Not a common password',
  },
]

function Bootstrap() {
  const bootstrapAdmin = useStore((s) => s.bootstrapAdmin)
  const [userName, setUserName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const rules = useMemo(() => RULES.map((rule) => ({ ...rule, ok: rule.test(password) })), [password])
  const nameInPassword = userName.length >= 4 && password.toLowerCase().includes(userName.toLowerCase())
  const usernameOk = /^[a-z0-9._-]{3,32}$/i.test(userName)
  const ready = usernameOk && rules.every((r) => r.ok) && !nameInPassword && password === confirm && !!password

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      await bootstrapAdmin({ userName, displayName: displayName || userName, password })
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not create the account')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Frame
      title="Create the administrator"
      subtitle="This is a new installation. The first account you make holds every permission, including the right to create everyone else."
    >
      <form onSubmit={submit} className="space-y-4">
        <Field
          label="Username"
          value={userName}
          autoComplete="username"
          autoCapitalize="none"
          autoFocus
          hint="Letters, digits, dot, dash or underscore"
          error={userName && !usernameOk ? 'Between 3 and 32 characters, no spaces' : undefined}
          onChange={(e) => setUserName(e.target.value)}
        />
        <Field
          label="Your name"
          value={displayName}
          placeholder="Ashwath"
          hint="Shown against everything you do"
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <Field
          label="Password"
          type="password"
          value={password}
          autoComplete="new-password"
          onChange={(e) => setPassword(e.target.value)}
        />

        <ul className="space-y-1">
          {rules.map((rule) => (
            <li key={rule.label} className="flex items-center gap-2 text-xs">
              <span className={`size-3.5 rounded-full grid place-items-center shrink-0 ${
                rule.ok ? 'bg-ok/15 text-ok' : 'bg-ink/[0.07] text-ink-3'
              }`}>
                {rule.ok ? <Check className="size-2.5" /> : <span className="size-1 rounded-full bg-current" />}
              </span>
              <span className={rule.ok ? 'text-ink-2' : 'text-ink-3'}>{rule.label}</span>
            </li>
          ))}
          <li className="flex items-center gap-2 text-xs">
            <span className={`size-3.5 rounded-full grid place-items-center shrink-0 ${
              password && !nameInPassword ? 'bg-ok/15 text-ok' : 'bg-ink/[0.07] text-ink-3'
            }`}>
              {password && !nameInPassword
                ? <Check className="size-2.5" />
                : <span className="size-1 rounded-full bg-current" />}
            </span>
            <span className={password && !nameInPassword ? 'text-ink-2' : 'text-ink-3'}>
              Does not contain your username
            </span>
          </li>
        </ul>

        <Field
          label="Confirm password"
          type="password"
          value={confirm}
          autoComplete="new-password"
          error={confirm && confirm !== password ? 'The two passwords do not match' : undefined}
          onChange={(e) => setConfirm(e.target.value)}
        />

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-risk/30 bg-risk/[0.07] px-3 py-2.5">
            <TriangleAlert className="size-4 text-risk shrink-0 mt-px" />
            <p className="text-sm text-ink-2 leading-snug">{error}</p>
          </div>
        )}

        <Button
          type="submit" variant="primary" size="lg" className="w-full"
          loading={busy} disabled={!ready} icon={<KeyRound className="size-4" />}
        >
          Create account and sign in
        </Button>
      </form>

      <Callout tone="info" title="There is no password recovery">
        Nothing in this system sends email. Write this password down somewhere safe — if it is lost, the
        only way back in is another administrator account.
      </Callout>
    </Frame>
  )
}

/* ── Forced password change ──────────────────────────────────────────── */

export function ChangePasswordGate() {
  const changeOwnPassword = useStore((s) => s.changeOwnPassword)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const rules = useMemo(() => RULES.map((rule) => ({ ...rule, ok: rule.test(next) })), [next])
  const ready = rules.every((r) => r.ok) && next === confirm && !!current && !!next

  useEffect(() => { setError(null) }, [current, next, confirm])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!ready) return
    setBusy(true)
    try {
      await changeOwnPassword(current, next)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not change the password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Frame
      title="Choose a new password"
      subtitle="An administrator set the password you just used. Pick your own before carrying on."
    >
      <form onSubmit={submit} className="space-y-4">
        <Field
          label="The password you were given" type="password" value={current}
          autoComplete="current-password" autoFocus
          onChange={(e) => setCurrent(e.target.value)}
        />
        <Field
          label="New password" type="password" value={next} autoComplete="new-password"
          onChange={(e) => setNext(e.target.value)}
        />
        <ul className="space-y-1">
          {rules.map((rule) => (
            <li key={rule.label} className="flex items-center gap-2 text-xs">
              <span className={`size-3.5 rounded-full grid place-items-center shrink-0 ${
                rule.ok ? 'bg-ok/15 text-ok' : 'bg-ink/[0.07] text-ink-3'
              }`}>
                {rule.ok ? <Check className="size-2.5" /> : <span className="size-1 rounded-full bg-current" />}
              </span>
              <span className={rule.ok ? 'text-ink-2' : 'text-ink-3'}>{rule.label}</span>
            </li>
          ))}
        </ul>
        <Field
          label="Confirm new password" type="password" value={confirm} autoComplete="new-password"
          error={confirm && confirm !== next ? 'The two passwords do not match' : undefined}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-risk/30 bg-risk/[0.07] px-3 py-2.5">
            <TriangleAlert className="size-4 text-risk shrink-0 mt-px" />
            <p className="text-sm text-ink-2 leading-snug">{error}</p>
          </div>
        )}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!ready}>
          Set my password
        </Button>
      </form>
    </Frame>
  )
}

export function AuthLoading() {
  return (
    <div className="min-h-full grid place-items-center bg-canvas grain">
      <div className="flex flex-col items-center gap-3 animate-fade-in">
        <Loader2 className="size-5 text-brand-500 animate-spin" />
        <p className="text-sm text-ink-3">Checking your session…</p>
      </div>
    </div>
  )
}
