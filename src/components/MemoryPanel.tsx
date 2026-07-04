import { useEffect, useState } from 'react'
import { Brain, Clock, FolderKanban, Plus, ShieldAlert, Star, Trash2, UserRound, X } from 'lucide-react'
import type { LongMemoryEntry, MemoryConflict, MemoryScope } from '../types'

interface Props {
  apiBase: string
  onClose: () => void
}

type MemoryResponse = {
  memories?: string
  entries?: LongMemoryEntry[]
}

type MemorySaveResponse = MemoryResponse & {
  ok?: boolean
  conflicts?: MemoryConflict[]
}

const SCOPE_LABEL: Record<MemoryScope | 'all', string> = {
  all: 'All',
  user: 'User',
  project: 'Project',
  temporary: 'Temporary',
}

function parseLegacy(raw: string): LongMemoryEntry[] {
  return raw.split('\n').filter(line => line.trim()).map((line, i) => {
    const idMatch = line.match(/^\[([^\]]+)\]/)
    const id = idMatch ? idMatch[1] : `entry-${i}`
    const tagsMatch = line.match(/\[([^\]]+)\]$/)
    const tags = tagsMatch ? tagsMatch[1].split(',').map(tag => tag.trim()).filter(Boolean) : []
    const content = line
      .replace(/^\[[^\]]+\]\s*/, '')
      .replace(/^[0-9-]+\s*[:·]\s*/, '')
      .replace(/\[[^\]]+\]$/, '')
      .trim()
    return {
      id,
      timestamp: '',
      content,
      tags,
      confidence: 0.85,
      source: 'legacy',
      scope: 'user' as const,
      expiresAt: null,
      promotedFrom: null,
    }
  }).filter(entry => entry.content && !entry.content.toLowerCase().includes('no memories'))
}

function scopeIcon(scope: MemoryScope) {
  if (scope === 'project') return <FolderKanban size={12} />
  if (scope === 'temporary') return <Clock size={12} />
  return <UserRound size={12} />
}

export function MemoryPanel({ apiBase, onClose }: Props) {
  const [entries, setEntries] = useState<LongMemoryEntry[]>([])
  const [raw, setRaw] = useState('')
  const [loading, setLoading] = useState(true)
  const [newContent, setNewContent] = useState('')
  const [newTags, setNewTags] = useState('')
  const [newScope, setNewScope] = useState<MemoryScope>('user')
  const [newConfidence, setNewConfidence] = useState(0.85)
  const [newSource, setNewSource] = useState('user')
  const [newExpiresAt, setNewExpiresAt] = useState('')
  const [conflicts, setConflicts] = useState<MemoryConflict[]>([])
  const [saving, setSaving] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [filter, setFilter] = useState<MemoryScope | 'all'>('all')

  async function refresh() {
    setLoading(true)
    const response = await fetch(`${apiBase}/api/memories`).catch(() => null)
    if (response?.ok) {
      const data = await response.json() as MemoryResponse
      setRaw(data.memories ?? '')
      setEntries(data.entries?.length ? data.entries : parseLegacy(data.memories ?? ''))
    }
    setLoading(false)
  }

  useEffect(() => { void refresh() }, [apiBase]) // eslint-disable-line react-hooks/exhaustive-deps

  async function deleteEntry(id: string) {
    await fetch(`${apiBase}/api/memories/${id}`, { method: 'DELETE' }).catch(() => {})
    await refresh()
  }

  async function promoteEntry(id: string, scope: 'user' | 'project') {
    await fetch(`${apiBase}/api/memories/${id}/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope }),
    }).catch(() => {})
    await refresh()
  }

  async function addMemory() {
    if (!newContent.trim()) return
    setSaving(true)
    setConflicts([])
    const response = await fetch(`${apiBase}/api/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: newContent.trim(),
        tags: newTags.trim(),
        scope: newScope,
        confidence: newConfidence,
        source: newSource.trim() || 'user',
        expiresAt: newScope === 'temporary' ? newExpiresAt : '',
      }),
    }).catch(() => null)
    if (response?.ok) {
      const data = await response.json() as MemorySaveResponse
      setConflicts(data.conflicts ?? [])
      setEntries(data.entries?.length ? data.entries : entries)
      setNewContent('')
      setNewTags('')
      setNewScope('user')
      setNewConfidence(0.85)
      setNewSource('user')
      setNewExpiresAt('')
      setShowAdd(false)
      await refresh()
    }
    setSaving(false)
  }

  const visibleEntries = entries.filter(entry => filter === 'all' || entry.scope === filter)
  const userCount = entries.filter(entry => entry.scope === 'user').length
  const projectCount = entries.filter(entry => entry.scope === 'project').length
  const temporaryCount = entries.filter(entry => entry.scope === 'temporary').length
  const recentEntries = [...entries].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0, 3)

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel-drawer panel-right panel-wide" onClick={event => event.stopPropagation()}>
        <div className="panel-header">
          <div className="panel-title">
            <Brain size={16} />
            <span>Memory 2.0</span>
            {entries.length > 0 && <span className="memory-count">{entries.length}</span>}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="sidebar-action-btn" onClick={() => setShowAdd(state => !state)} title="Add memory">
              <Plus size={14} />
            </button>
            <button className="icon-button" onClick={onClose} type="button" aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        {showAdd && (
          <div className="memory-add-form memory-add-form-v2">
            <textarea
              value={newContent}
              onChange={event => setNewContent(event.target.value)}
              placeholder="What should Ultron remember?"
              className="settings-textarea"
              rows={3}
            />
            <input
              type="text"
              value={newTags}
              onChange={event => setNewTags(event.target.value)}
              placeholder="Tags (comma-separated)"
              className="settings-input"
            />
            <div className="memory-form-grid">
              <label>
                <span>Scope</span>
                <select value={newScope} onChange={event => setNewScope(event.target.value as MemoryScope)}>
                  <option value="user">User</option>
                  <option value="project">Project</option>
                  <option value="temporary">Temporary</option>
                </select>
              </label>
              <label>
                <span>Source</span>
                <input className="settings-input" value={newSource} onChange={event => setNewSource(event.target.value)} />
              </label>
              <label>
                <span>Confidence {Math.round(newConfidence * 100)}%</span>
                <input type="range" min="0.1" max="1" step="0.05" value={newConfidence} onChange={event => setNewConfidence(Number(event.target.value))} />
              </label>
              {newScope === 'temporary' && (
                <label>
                  <span>Expires</span>
                  <input className="settings-input" type="datetime-local" value={newExpiresAt} onChange={event => setNewExpiresAt(event.target.value)} />
                </label>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="sidebar-action-btn" onClick={() => void addMemory()} disabled={!newContent.trim() || saving}>
                {saving ? 'Saving...' : 'Save to memory'}
              </button>
              <button type="button" className="sidebar-action-btn" onClick={() => setShowAdd(false)}>Cancel</button>
            </div>
          </div>
        )}

        <div className="panel-body memory-body-v2">
          <div className="memory-summary-grid">
            <div><UserRound size={13} /><strong>{userCount}</strong><span>User</span></div>
            <div><FolderKanban size={13} /><strong>{projectCount}</strong><span>Project</span></div>
            <div><Clock size={13} /><strong>{temporaryCount}</strong><span>Temporary</span></div>
          </div>

          {conflicts.length > 0 && (
            <div className="memory-conflicts">
              <ShieldAlert size={15} />
              <div>
                <strong>Possible memory conflict</strong>
                {conflicts.map(conflict => <span key={conflict.id}>{conflict.reason}: {conflict.content}</span>)}
              </div>
            </div>
          )}

          <div className="memory-filter-row">
            {(['all', 'user', 'project', 'temporary'] as const).map(scope => (
              <button key={scope} type="button" className={filter === scope ? 'active' : ''} onClick={() => setFilter(scope)}>
                {SCOPE_LABEL[scope]}
              </button>
            ))}
          </div>

          {recentEntries.length > 0 && (
            <div className="memory-review-block">
              <strong>Recent auto-saved memories</strong>
              {recentEntries.map(entry => <span key={entry.id}>{entry.scope}: {entry.content.slice(0, 90)}{entry.content.length > 90 ? '...' : ''}</span>)}
            </div>
          )}

          {loading && <p className="panel-hint">Loading memories...</p>}
          {!loading && visibleEntries.length === 0 && (
            <p className="panel-hint">No memories in this scope yet.</p>
          )}
          {!loading && visibleEntries.length === 0 && raw.trim() && entries.length === 0 && (
            <pre className="memory-raw">{raw}</pre>
          )}
          {visibleEntries.map(entry => (
            <div key={entry.id} className={`memory-entry memory-entry-${entry.scope}`}>
              <div className="memory-entry-topline">
                <span>{scopeIcon(entry.scope)} {SCOPE_LABEL[entry.scope]}</span>
                <span><Star size={11} /> {Math.round(entry.confidence * 100)}%</span>
                <span>source: {entry.source}</span>
              </div>
              <div className="memory-entry-content">{entry.content}</div>
              {entry.tags.length > 0 && (
                <div className="memory-tags">
                  {entry.tags.map(tag => <span key={tag} className="memory-tag">{tag}</span>)}
                </div>
              )}
              <div className="memory-timestamp">
                {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : 'legacy memory'}
                {entry.expiresAt ? ` · expires ${new Date(entry.expiresAt).toLocaleString()}` : ''}
              </div>
              <div className="memory-entry-actions">
                {entry.scope === 'temporary' && (
                  <>
                    <button type="button" onClick={() => void promoteEntry(entry.id, 'user')}>Promote to user</button>
                    <button type="button" onClick={() => void promoteEntry(entry.id, 'project')}>Promote to project</button>
                  </>
                )}
                <button type="button" className="memory-delete" onClick={() => void deleteEntry(entry.id)} title="Forget this">
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}