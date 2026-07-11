import { useEffect, useState } from 'react'
import { Eye, KeyRound, Loader, Plus, Trash2, X } from 'lucide-react'

type Credential = {
  id: string
  label: string
  site: string
  username: string
  email: string
  hasSecret: boolean
  notes: string
  updatedAt: string
}

type Props = {
  apiBase: string
  onClose: () => void
}

export function CredentialVaultPanel({ apiBase, onClose }: Props) {
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [form, setForm] = useState({ label: '', site: '', username: '', email: '', secret: '', notes: '' })

  async function loadCredentials() {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`${apiBase}/api/credentials`, { credentials: 'include' })
      const data = await response.json()
      if (!response.ok) throw new Error((data as { error?: string }).error ?? 'Could not load credentials')
      setCredentials((data as { credentials: Credential[] }).credentials ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load credentials')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadCredentials() }, [apiBase]) // eslint-disable-line react-hooks/exhaustive-deps

  async function saveCredential(event: React.FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const response = await fetch(`${apiBase}/api/credentials`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await response.json()
      if (!response.ok) throw new Error((data as { error?: string }).error ?? 'Could not save credential')
      setForm({ label: '', site: '', username: '', email: '', secret: '', notes: '' })
      await loadCredentials()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save credential')
    } finally {
      setSaving(false)
    }
  }

  async function reveal(id: string) {
    const response = await fetch(`${apiBase}/api/credentials/${encodeURIComponent(id)}/reveal`, { method: 'POST', credentials: 'include' })
    const data = await response.json()
    if (response.ok) setRevealed(current => ({ ...current, [id]: (data as { secret?: string }).secret ?? '' }))
    else setError((data as { error?: string }).error ?? 'Could not reveal secret')
  }

  async function remove(id: string) {
    const response = await fetch(`${apiBase}/api/credentials/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' })
    if (response.ok) await loadCredentials()
    else setError('Could not delete credential')
  }

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel-drawer panel-right panel-wide credential-panel" onClick={event => event.stopPropagation()}>
        <div className="panel-header">
          <div className="panel-title"><KeyRound size={16} /><span>Credential Vault</span></div>
          <button className="icon-button" onClick={onClose} type="button" aria-label="Close credential vault"><X size={18} /></button>
        </div>
        <div className="panel-body project-builder-body">
          <section className="project-builder-hero credential-hero">
            <div>
              <span className="settings-section-title">Local Private Store</span>
              <h3>Credentials for apps and connectors</h3>
              <p>Secrets are encrypted on this machine. Reveal only when you need to copy or verify a saved login.</p>
            </div>
            <KeyRound size={34} />
          </section>

          {error && <div className="project-builder-error">{error}</div>}

          <form className="credential-form" onSubmit={event => void saveCredential(event)}>
            <label className="project-builder-field"><span>Label</span><input value={form.label} onChange={event => setForm({ ...form, label: event.target.value })} placeholder="Salesforce admin" /></label>
            <label className="project-builder-field"><span>Site/app</span><input value={form.site} onChange={event => setForm({ ...form, site: event.target.value })} placeholder="salesforce.com" /></label>
            <label className="project-builder-field"><span>Username</span><input value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} /></label>
            <label className="project-builder-field"><span>Email</span><input value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></label>
            <label className="project-builder-field"><span>Secret/password/token</span><input value={form.secret} onChange={event => setForm({ ...form, secret: event.target.value })} type="password" /></label>
            <label className="project-builder-field credential-notes"><span>Notes</span><input value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} /></label>
            <button className="project-builder-run" type="submit" disabled={saving || !form.site.trim()}>{saving ? <Loader size={15} className="spin" /> : <Plus size={15} />} Save Credential</button>
          </form>

          <section className="project-builder-projects">
            <div className="project-builder-section-head">
              <span className="settings-section-title">Saved Credentials</span>
              {loading && <Loader size={13} className="spin" />}
            </div>
            {!loading && credentials.length === 0 && <p className="panel-hint">No credentials saved yet.</p>}
            {credentials.map(item => (
              <article className="credential-card" key={item.id}>
                <div>
                  <strong>{item.label}</strong>
                  <span>{item.site}</span>
                  {(item.username || item.email) && <span>{[item.username, item.email].filter(Boolean).join(' · ')}</span>}
                  {item.notes && <span>{item.notes}</span>}
                  {revealed[item.id] !== undefined && <code>{revealed[item.id] || '(empty secret)'}</code>}
                </div>
                <div className="project-builder-actions">
                  <button type="button" onClick={() => void reveal(item.id)} disabled={!item.hasSecret}><Eye size={13} /> Reveal</button>
                  <button type="button" onClick={() => void remove(item.id)}><Trash2 size={13} /> Delete</button>
                </div>
              </article>
            ))}
          </section>
        </div>
      </div>
    </div>
  )
}