import { useEffect, useState } from 'react'
import { Loader, LockKeyhole, ShieldCheck } from 'lucide-react'

export type AuthUser = {
  id: string
  email: string
  username: string
  displayName: string
  organizationId: string | null
  organizationName: string | null
  organizationSlug: string | null
  organizationRole: 'owner' | 'member'
  isPlatformAdmin: boolean
  emailVerifiedAt: string | null
  createdAt: string
}

type AuthSession = {
  user: AuthUser
  expiresAt: string
}

type AuthSuccess = AuthSession & {
  inviteAccepted?: boolean
  inviteError?: string
}

type ChallengeDelivery =
  | {
    mode: 'debug'
    email: string
    code: string
    expiresAt: string
  }
  | {
    mode: 'email'
    provider: 'smtp'
    email: string
    expiresAt: string
    messageId?: string
  }

type ChallengePayload = {
  next?: 'verify_email'
  email?: string | null
  delivery?: ChallengeDelivery | null
  expiresAt?: string | null
  message?: string
  error?: string
  inviteAccepted?: boolean
  inviteError?: string
}

type OrganizationInvitePreview = {
  email: string
  role: 'owner' | 'member'
  expiresAt: string
  organization: {
    id: string
    name: string
    slug: string
  }
  invitedBy: {
    id: string
    email: string
    displayName: string
  } | null
  accountState: 'none' | 'existing_unverified' | 'existing_verified'
}

type Mode = 'login' | 'signup' | 'verify' | 'forgot' | 'reset'

type Props = {
  apiBase: string
  configured: boolean
  onAuthenticated: (session: AuthSuccess) => void
}

function inviteTokenFromUrl(): string {
  if (typeof window === 'undefined') return ''
  return new URLSearchParams(window.location.search).get('invite')?.trim() ?? ''
}

function clearInviteTokenFromUrl() {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.delete('invite')
  const nextSearch = url.searchParams.toString()
  window.history.replaceState({}, '', `${url.pathname}${nextSearch ? `?${nextSearch}` : ''}${url.hash}`)
}

function describeChallenge(payload: ChallengePayload, fallback: string): string {
  const parts = [payload.message ?? fallback]
  if (payload.delivery?.mode === 'debug') parts.push(`Debug code: ${payload.delivery.code}`)
  if (payload.delivery?.mode === 'email') parts.push(`Sent to ${payload.delivery.email} by email.`)
  if (payload.expiresAt) {
    const expires = new Date(payload.expiresAt)
    parts.push(`Expires ${expires.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)
  }
  return parts.join(' ')
}

export function AuthPanel({ apiBase, configured, onAuthenticated }: Props) {
  const [mode, setMode] = useState<Mode>(configured ? 'login' : 'signup')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [inviteToken] = useState(() => inviteTokenFromUrl())
  const [invitePreview, setInvitePreview] = useState<OrganizationInvitePreview | null>(null)

  useEffect(() => {
    if (!inviteToken) return
    let cancelled = false

    async function loadInvitePreview() {
      try {
        const response = await fetch(`${apiBase}/api/org/invites/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: inviteToken }),
        })
        const data = await response.json() as { invite?: OrganizationInvitePreview; error?: string }
        if (!response.ok || !data.invite) throw new Error(data.error ?? 'Could not load invite')
        if (cancelled) return

        setInvitePreview(data.invite)
        setEmail(current => current || data.invite!.email)
        setMode(data.invite.accountState === 'none' ? 'signup' : 'login')
        setInfo(`Invitation to join ${data.invite.organization.name} as ${data.invite.role}. ${data.invite.accountState === 'none' ? 'Create your account with this email to continue.' : 'Sign in with this email to join the workspace.'}`)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load invite')
      }
    }

    void loadInvitePreview()
    return () => { cancelled = true }
  }, [apiBase, inviteToken])

  function switchMode(next: Mode) {
    setError('')
    setInfo('')
    setCode('')
    setMode(next)
  }

  function applyChallenge(payload: ChallengePayload, nextMode: Extract<Mode, 'verify' | 'reset'>, fallback: string) {
    setEmail(payload.email ?? email)
    setCode('')
    setPassword('')
    setError(payload.error ?? '')
    setInfo(describeChallenge(payload, fallback))
    setMode(nextMode)
  }

  async function resendVerification() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${apiBase}/api/auth/verify/request`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailOrUsername: email }),
      })
      const data = await response.json() as ChallengePayload & { error?: string }
      if (!response.ok) throw new Error(data.error ?? 'Could not issue verification code')
      setInfo(describeChallenge(data, 'If the account still needs verification, a code is ready.'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not issue verification code')
    } finally {
      setBusy(false)
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      let endpoint = '/api/auth/login'
      let body: Record<string, unknown> = { emailOrUsername: email, password }

      if (mode === 'signup') {
        endpoint = '/api/auth/register'
        body = { email, username, displayName, password }
      } else if (mode === 'verify') {
        endpoint = '/api/auth/verify/confirm'
        body = { email, code, inviteToken }
      } else if (mode === 'forgot') {
        endpoint = '/api/auth/password/request-reset'
        body = { email }
      } else if (mode === 'reset') {
        endpoint = '/api/auth/password/reset'
        body = { email, code, password, inviteToken }
      } else if (inviteToken) {
        body = { emailOrUsername: email, password, inviteToken }
      }

      const response = await fetch(`${apiBase}${endpoint}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json() as AuthSuccess & ChallengePayload & { error?: string }

      if (!response.ok) {
        if (response.status === 403 && data.next === 'verify_email') {
          applyChallenge(data, 'verify', data.error ?? 'Verify your email before signing in.')
          return
        }
        throw new Error(data.error ?? 'Authentication failed')
      }

      if (mode === 'signup') {
        applyChallenge(data, 'verify', 'Enter the verification code to finish creating your account.')
        return
      }

      if (mode === 'forgot') {
        applyChallenge(data, 'reset', 'Use the reset code to choose a new password.')
        return
      }

      if (inviteToken) clearInviteTokenFromUrl()
      onAuthenticated(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setBusy(false)
    }
  }

  const title = mode === 'signup'
    ? 'Create your Ultron account'
    : mode === 'verify'
      ? 'Verify your email'
      : mode === 'forgot'
        ? 'Request a password reset'
        : mode === 'reset'
          ? 'Reset your password'
          : 'Sign in to Ultron'

  const description = mode === 'verify'
    ? 'Enter the verification code for your account. In debug mode the code appears here; with SMTP configured it is delivered by email.'
    : mode === 'forgot'
      ? 'Request a password reset code for your Ultron account.'
      : mode === 'reset'
        ? 'Enter your reset code and choose a new password.'
        : invitePreview
          ? `Use the invited email account to join ${invitePreview.organization.name}.`
          : 'Use your account to unlock your private credential vault and signed-in workspace on this machine.'

  const submitLabel = mode === 'signup'
    ? 'Create Account'
    : mode === 'verify'
      ? 'Verify Email'
      : mode === 'forgot'
        ? 'Send Reset Code'
        : mode === 'reset'
          ? 'Reset Password'
          : 'Sign In'

  return (
    <main className="auth-shell">
      <form className="auth-card" onSubmit={event => void submit(event)}>
        <div className="auth-mark"><ShieldCheck size={34} /></div>
        <p className="eyebrow">Ultron Account</p>
        <h1>{title}</h1>
        <p>{description}</p>

        {info && <p className="panel-hint">{info}</p>}
        {error && <div className="project-builder-error">{error}</div>}

        {invitePreview && (
          <div className="panel-hint org-invite-note auth-invite-note">
            {invitePreview.organization.name} · {invitePreview.role} · expires {new Date(invitePreview.expiresAt).toLocaleString()}
            {invitePreview.invitedBy ? ` · invited by ${invitePreview.invitedBy.displayName}` : ''}
          </div>
        )}

        <label className="project-builder-field">
          <span>{mode === 'login' ? 'Email or username' : 'Email'}</span>
          <input value={email} onChange={event => setEmail(event.target.value)} autoComplete="username" />
        </label>

        {mode === 'signup' && (
          <>
            <label className="project-builder-field">
              <span>Username</span>
              <input value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" />
            </label>
            <label className="project-builder-field">
              <span>Display name</span>
              <input value={displayName} onChange={event => setDisplayName(event.target.value)} autoComplete="name" />
            </label>
          </>
        )}

        {(mode === 'verify' || mode === 'reset') && (
          <label className="project-builder-field">
            <span>Verification code</span>
            <input value={code} onChange={event => setCode(event.target.value.toUpperCase())} autoComplete="one-time-code" />
          </label>
        )}

        {(mode === 'login' || mode === 'signup' || mode === 'reset') && (
          <label className="project-builder-field">
            <span>{mode === 'reset' ? 'New password' : 'Password'}</span>
            <input value={password} onChange={event => setPassword(event.target.value)} type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          </label>
        )}

        <button className="project-builder-run" type="submit" disabled={busy}>
          {busy ? <Loader size={15} className="spin" /> : <LockKeyhole size={15} />}
          {submitLabel}
        </button>

        {mode === 'login' && (
          <>
            <button className="auth-switch" type="button" onClick={() => switchMode('signup')}>
              Create an account
            </button>
            <button className="auth-switch" type="button" onClick={() => switchMode('forgot')}>
              Forgot your password?
            </button>
          </>
        )}

        {mode === 'signup' && (
          <button className="auth-switch" type="button" onClick={() => switchMode('login')}>
            Already have an account? Sign in
          </button>
        )}

        {mode === 'verify' && (
          <>
            <button className="auth-switch" type="button" onClick={() => void resendVerification()}>
              Resend verification code
            </button>
            <button className="auth-switch" type="button" onClick={() => switchMode('login')}>
              Back to sign in
            </button>
          </>
        )}

        {(mode === 'forgot' || mode === 'reset') && (
          <button className="auth-switch" type="button" onClick={() => switchMode('login')}>
            Back to sign in
          </button>
        )}
      </form>
    </main>
  )
}