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
  const [showTerms, setShowTerms] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)
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
    setShowTerms(false)
    setTermsAccepted(false)
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
    if (mode === 'signup' && !termsAccepted) {
      setError('You must accept the Terms & Agreement before creating a Lumivex AI account.')
      return
    }
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
    ? 'Create your Lumivex AI account'
    : mode === 'verify'
      ? 'Verify your email'
      : mode === 'forgot'
        ? 'Request a password reset'
        : mode === 'reset'
          ? 'Reset your password'
          : 'Sign in to Lumivex AI'

  const description = mode === 'verify'
    ? 'Enter the verification code for your account. In debug mode the code appears here; with SMTP configured it is delivered by email.'
    : mode === 'forgot'
      ? 'Request a password reset code for your Lumivex AI account.'
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
        <p className="eyebrow">Lumivex AI Account</p>
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

        {mode === 'signup' && (
          <label className="auth-terms-consent">
            <input checked={termsAccepted} onChange={event => setTermsAccepted(event.target.checked)} type="checkbox" required />
            <span>
              I agree to the{' '}
              <button className="auth-terms-link" type="button" onClick={() => setShowTerms(true)}>
                Terms & Agreement
              </button>
              .
            </span>
          </label>
        )}

        <button className="project-builder-run" type="submit" disabled={busy || (mode === 'signup' && !termsAccepted)}>
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

      {showTerms && (
        <div className="auth-terms-overlay" role="presentation" onClick={() => setShowTerms(false)}>
          <section className="auth-terms-modal" role="dialog" aria-modal="true" aria-labelledby="lumivex-terms-title" onClick={event => event.stopPropagation()}>
            <div className="auth-terms-head">
              <div>
                <p className="eyebrow">Lumivex AI Terms & Agreement</p>
                <h2 id="lumivex-terms-title">Use Lumivex AI with clear consent and responsibility.</h2>
              </div>
              <button type="button" className="auth-terms-close" onClick={() => setShowTerms(false)} aria-label="Close terms">×</button>
            </div>

            <div className="auth-terms-body">
              <p><strong>Last updated:</strong> July 12, 2026. These terms explain the expected use of Lumivex AI, a local-first AI workspace for chat, tools, memory, coding, browser automation, media workflows, run tracking, and connected services.</p>

              <h3>1. Lumivex AI service</h3>
              <p>Lumivex AI provides an AI assistant interface, local model routing, project-building tools, memory features, browser and desktop automation, connectors, media processing, and administrative workspace controls. Features may run locally, call your configured backend, or interact with third-party services you connect.</p>

              <h3>2. Account and workspace access</h3>
              <p>You are responsible for keeping your login, verification codes, password reset codes, devices, and workspace access secure. Organization owners and platform admins are responsible for invited users, roles, workspace membership, and access changes.</p>

              <h3>3. Local-first privacy and data</h3>
              <p>Lumivex AI is designed to operate with local infrastructure where configured, including Ollama, local databases, encrypted credential storage, and local project files. Data may still leave your device if you enable connectors, external APIs, email delivery, browser automation, cloud endpoints, or public URLs.</p>

              <h3>4. Credentials, files, and sensitive information</h3>
              <p>Only store credentials, tokens, files, screenshots, media, health data, location data, or private business information that you are authorized to use. Review tool actions before approval, especially actions that read files, write files, run terminal commands, access browsers, or use saved credentials.</p>

              <h3>5. Automation and user approval</h3>
              <p>Lumivex AI can help operate browsers, files, terminals, apps, code projects, schedulers, and connectors. You remain responsible for approving actions, checking outputs, confirming destructive or account-changing operations, and complying with the terms of any third-party website or service Lumivex AI interacts with.</p>

              <h3>6. AI output and professional review</h3>
              <p>Lumivex AI may generate text, code, images, videos, analysis, summaries, recommendations, and automations that can be incomplete, inaccurate, unsafe, or outdated. Review important output before relying on it. Lumivex AI is not a substitute for legal, medical, financial, security, emergency, or other licensed professional advice.</p>

              <h3>7. Media, location, and personal data features</h3>
              <p>PDF scanning, photo viewing, video viewing, AI media generation, voice, vision, and run tracking can involve personal or sensitive data. Use these features only with consent from the people involved and only where collection, processing, storage, and sharing are lawful and appropriate.</p>

              <h3>8. Acceptable use</h3>
              <p>Do not use Lumivex AI to break laws, violate privacy, bypass authorization, abuse systems, generate harmful instructions, impersonate others, create malicious code, or infringe intellectual property. You are responsible for what you ask Lumivex AI to do and what you do with Lumivex AI's output.</p>

              <h3>9. Billing, subscriptions, and paid features</h3>
              <p>If Lumivex AI adds paid plans, usage limits, billing, credits, enterprise seats, paid connectors, premium model access, AI media generation, storage, support, or other paid features, the displayed pricing, renewal, cancellation, refund, trial, tax, and usage terms will apply. You are responsible for keeping billing information accurate and for charges authorized by your account or organization.</p>

              <h3>10. User content ownership and processing permission</h3>
              <p>You keep ownership of your prompts, files, uploads, screenshots, project content, credentials, run data, media, and other content you provide. You grant Lumivex AI permission to process that content only as needed to provide the features you use, operate connected tools, maintain security, troubleshoot issues, and comply with law or account administration requirements.</p>

              <h3>11. Generated output and user responsibility</h3>
              <p>Subject to applicable law and third-party rights, you may use Lumivex AI-generated output for your own work. You are responsible for reviewing output, checking licenses and attribution, validating generated code or media, and making sure your use of output does not violate someone else's rights or applicable rules.</p>

              <h3>12. Data retention, export, and deletion</h3>
              <p>Lumivex AI may store account records, sessions, memories, credentials, project history, tasks, run data, generated artifacts, logs, and organization records depending on your configuration. You are responsible for exporting anything you need before deleting it. Account deletion, workspace removal, or local database deletion may permanently remove data unless backups or third-party copies exist.</p>

              <h3>13. Security limitations</h3>
              <p>Lumivex AI uses security-minded patterns such as session auth, local-first storage, encrypted credential handling where configured, and approval gates for sensitive actions. No system is perfectly secure. You should use strong passwords, protect your device, restrict admin access, rotate compromised credentials, and avoid storing secrets you do not need.</p>

              <h3>14. Suspension, termination, and misuse</h3>
              <p>Access may be limited, suspended, or terminated if an account is compromised, violates these terms, creates security risk, abuses systems, infringes rights, fails billing requirements, or is required by law or workspace administration. You may stop using Lumivex AI at any time, but prior obligations and responsible-use requirements still apply.</p>

              <h3>15. Availability, updates, and third-party services</h3>
              <p>Lumivex AI depends on your device, local services, models, databases, browser runtime, network, packages, and connected providers. Features may change, fail, or require maintenance. Third-party services remain governed by their own terms, privacy policies, limits, and availability.</p>

              <h3>16. Disclaimers and limitation of liability</h3>
              <p>Lumivex AI is provided as a configurable assistant platform and may be experimental, incomplete, interrupted, or incorrect. To the maximum extent allowed by law, Lumivex AI is provided without warranties of perfect accuracy, fitness for a particular purpose, uninterrupted operation, or error-free results. Lumivex AI's operators and contributors are not liable for indirect, incidental, consequential, special, punitive, or lost-profit damages caused by use or inability to use Lumivex AI.</p>

              <h3>17. Indemnification</h3>
              <p>You agree to be responsible for claims, losses, liabilities, damages, costs, and expenses that arise from your misuse of Lumivex AI, violation of these terms, violation of law, infringement of third-party rights, unauthorized use of data or credentials, or harmful actions you approve or perform through Lumivex AI.</p>

              <h3>18. Changes, governing rules, and contact</h3>
              <p>These terms may be updated as Lumivex AI adds billing, enterprise controls, new AI tools, model providers, media generation, storage, mobile features, or other capabilities. Continued use after updated terms are shown means you accept the updated terms. Production deployments should provide a support or legal contact, a governing-law section, and any required privacy-policy links for the region where Lumivex AI is offered.</p>

              <h3>19. Agreement</h3>
              <p>By creating an account or using Lumivex AI, you agree to use it responsibly, protect your account, respect other users and third-party systems, review AI output, and accept that Lumivex AI is provided as a configurable assistant platform rather than a guarantee of perfect results.</p>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}