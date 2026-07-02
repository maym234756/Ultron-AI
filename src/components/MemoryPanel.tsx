import { useEffect, useState } from 'react'
import { Brain, Plus, Trash2, X } from 'lucide-react'

interface MemoryEntry {
  id: string
  content: string
  tags: string[]
  timestamp: string
}

interface Props {
  apiBase: string
  onClose: () => void
}

export function MemoryPanel({ apiBase, onClose }: Props) {
  const [raw, setRaw] = useState('')
  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [newContent, setNewContent] = useState('')
  const [newTags, setNewTags] = useState('')
  const [saving, setSaving] = useState(false)
  const [showAdd, setShowAdd] = useState(false)

  useEffect(() => {
    fetch(`${apiBase}/api/memories`)
      .then(r => r.ok ? r.json() : { memories: '' })
      .then((d: { memories?: string }) => {
        setRaw(d.memories ?? '')
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [apiBase])

  async function deleteEntry(id: string) {
    await fetch(`${apiBase}/api/memories/${id}`, { method: 'DELETE' }).catch(() => {})
    // Re-fetch after delete
    const r = await fetch(`${apiBase}/api/memories`).catch(() => null)
    if (r?.ok) {
      const d = await r.json() as { memories?: string }
      setRaw(d.memories ?? '')
    }
  }

  async function addMemory() {
    if (!newContent.trim()) return
    setSaving(true)
    await fetch(`${apiBase}/api/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: newContent.trim(), tags: newTags.trim() }),
    }).catch(() => {})
    // Re-fetch
    const r = await fetch(`${apiBase}/api/memories`).catch(() => null)
    if (r?.ok) {
      const d = await r.json() as { memories?: string }
      setRaw(d.memories ?? '')
    }
    setNewContent('')
    setNewTags('')
    setShowAdd(false)
    setSaving(false)
  }

  // Parse the raw mem_list output into entries
  // Format is typically: [id] content (tags: ...) — timestamp
  const lines = raw.split('\n').filter(l => l.trim())
  const parsedEntries: MemoryEntry[] = lines.map((line, i) => {
    const idMatch = line.match(/^\[([^\]]+)\]/)
    const id = idMatch ? idMatch[1] : `entry-${i}`
    const content = line.replace(/^\[[^\]]+\]\s*/, '').replace(/\(tags:[^)]+\).*$/, '').trim()
    const tagsMatch = line.match(/\(tags:\s*([^)]+)\)/)
    const tags = tagsMatch ? tagsMatch[1].split(',').map(t => t.trim()) : []
    const tsMatch = line.match(/—\s*(.+)$/)
    const timestamp = tsMatch ? tsMatch[1].trim() : ''
    return { id, content, tags, timestamp }
  }).filter(e => e.content)

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel-drawer panel-right panel-wide" onClick={e => e.stopPropagation()}>
        <div className="panel-header">
          <div className="panel-title">
            <Brain size={16} />
            <span>Long-term Memory</span>
            {parsedEntries.length > 0 && <span className="memory-count">{parsedEntries.length}</span>}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="sidebar-action-btn" onClick={() => setShowAdd(s => !s)} title="Add memory">
              <Plus size={14} />
            </button>
            <button className="icon-button" onClick={onClose} type="button" aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        {showAdd && (
          <div className="memory-add-form">
            <textarea
              value={newContent}
              onChange={e => setNewContent(e.target.value)}
              placeholder="What should Ultron remember?"
              className="settings-textarea"
              rows={3}
            />
            <input
              type="text"
              value={newTags}
              onChange={e => setNewTags(e.target.value)}
              placeholder="Tags (comma-separated, optional)"
              className="settings-input"
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="sidebar-action-btn" onClick={addMemory} disabled={!newContent.trim() || saving}>
                {saving ? 'Saving…' : 'Save to memory'}
              </button>
              <button type="button" className="sidebar-action-btn" onClick={() => setShowAdd(false)}>Cancel</button>
            </div>
          </div>
        )}

        <div className="panel-body">
          {loading && <p className="panel-hint">Loading memories…</p>}
          {!loading && raw.toLowerCase().includes('no memories') && (
            <p className="panel-hint">No long-term memories saved yet. Ultron will save important facts automatically, or you can add them manually.</p>
          )}
          {!loading && parsedEntries.length === 0 && !raw.toLowerCase().includes('no memories') && raw.trim() && (
            <pre className="memory-raw">{raw}</pre>
          )}
          {parsedEntries.map(e => (
            <div key={e.id} className="memory-entry">
              <div className="memory-entry-content">{e.content}</div>
              {e.tags.length > 0 && (
                <div className="memory-tags">
                  {e.tags.map(t => <span key={t} className="memory-tag">{t}</span>)}
                </div>
              )}
              {e.timestamp && <div className="memory-timestamp">{e.timestamp}</div>}
              <button type="button" className="memory-delete" onClick={() => void deleteEntry(e.id)} title="Forget this">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
