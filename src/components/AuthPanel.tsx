import { useState } from 'react'
import { Loader, LockKeyhole, ShieldCheck } from 'lucide-react'

export type AuthUser = {
  id: string
  email: string
  username: string
  displayName: string
  createdAt: string
}

type AuthSession = {
  token: string
  user: AuthUser
  expiresAt: string
}

type Props = {
  apiBase: string
  configured: boolean
  onAuthenticated: (session: AuthSession) => void
}

export function AuthPanel({ apiBase, configured, onAuthenticated }: Props) {
  const [mode, setMode] = useState<'login' | 'setup'>(configured ? 'login' : 'setup')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const endpoint = mode === 'setup' ? '/api/auth/register' : '/api/auth/login'
      const body = mode === 'setup'
        ? { email, username, displayName, password }
        : { emailOrUsername: email || username, password }
      const response = await fetch(`${apiBase}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json()
      if (!response.ok) throw new Error((data as { error?: string }).error ?? 'Authentication failed')
      onAuthenticated(data as AuthSession)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-shell">
      <form className="auth-card" onSubmit={event => void submit(event)}>
        <div className="auth-mark"><ShieldCheck size={34} /></div>
        <p className="eyebrow">Local Identity Vault</p>
        <h1>{mode === 'setup' ? 'Create your Ultron login' : 'Sign in to Ultron'}</h1>
        <p>Use a local account to unlock your private credential vault and signed-in workspace on this machine.</p>

        {error && <div className="project-builder-error">{error}</div>}

        <label className="project-builder-field">
          <span>{mode === 'setup' ? 'Email' : 'Email or username'}</span>
          <input value={email} onChange={event => setEmail(event.target.value)} autoComplete="username" />
        </label>
        {mode === 'setup' && (
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
        <label className="project-builder-field">
          <span>Password</span>
          <input value={password} onChange={event => setPassword(event.target.value)} type="password" autoComplete={mode === 'setup' ? 'new-password' : 'current-password'} />
        </label>

        <button className="project-builder-run" type="submit" disabled={busy}>
          {busy ? <Loader size={15} className="spin" /> : <LockKeyhole size={15} />}
          {mode === 'setup' ? 'Create Login' : 'Sign In'}
        </button>

        {configured && (
          <button className="auth-switch" type="button" onClick={() => setMode(mode === 'login' ? 'setup' : 'login')}>
            {mode === 'login' ? 'Create a new local identity' : 'Back to sign in'}
          </button>
        )}
      </form>
    </main>
  )
}