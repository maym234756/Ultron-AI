import { useEffect, useRef, useState } from 'react'
import { Check, Clock, Loader, Pencil, Search, Trash2, X } from 'lucide-react'
import type { HistoryMeta, Message } from '../types'

interface Props {
  apiBase: string
  onLoad: (messages: Message[], model: string) => void
  onClose: () => void
}

interface SearchResult extends HistoryMeta { snippet: string }

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

type DateGroup = 'Today' | 'Yesterday' | 'This week' | 'This month' | 'Older'

function getDateGroup(ts: number): DateGroup {
  const diff = Date.now() - ts
  if (diff < 86_400_000) return 'Today'
  if (diff < 172_800_000) return 'Yesterday'
  if (diff < 604_800_000) return 'This week'
  if (diff < 2_592_000_000) return 'This month'
  return 'Older'
}

const DATE_GROUP_ORDER: DateGroup[] = ['Today', 'Yesterday', 'This week', 'This month', 'Older']

export function HistoryPanel({ apiBase, onLoad, onClose }: Props) {
  const [sessions, setSessions] = useState<HistoryMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [searching, setSearching] = useState(false)
  const [contentResults, setContentResults] = useState<SearchResult[] | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const renameRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    fetch(`${apiBase}/api/history`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d: { sessions?: HistoryMeta[] }) => setSessions(d.sessions ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [apiBase])

  useEffect(() => {
    setTimeout(() => searchRef.current?.focus(), 80)
  }, [])

  // Debounced full-content search across all sessions
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = search.trim()
    if (!q) { setContentResults(null); setSearching(false); return }

    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const r = await fetch(`${apiBase}/api/history/search?q=${encodeURIComponent(q)}`, { credentials: 'include' })
        if (r.ok) {
          const d = await r.json() as { results: SearchResult[] }
          setContentResults(d.results ?? [])
        }
      } catch { /* silent */ } finally {
        setSearching(false)
      }
    }, 350)
  }, [search, apiBase])

  async function loadSession(id: string) {
    try {
      const r = await fetch(`${apiBase}/api/history/${id}`, { credentials: 'include' })
      const d = await r.json() as { session?: { messages: Message[]; model: string } }
      if (d.session) {
        onLoad(d.session.messages, d.session.model)
        onClose()
      }
    } catch { /* silent */ }
  }

  async function deleteSession(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    await fetch(`${apiBase}/api/history/${id}`, { method: 'DELETE', credentials: 'include' }).catch(() => {})
    setSessions((s) => s.filter((x) => x.id !== id))
    setContentResults(r => r ? r.filter(x => x.id !== id) : r)
  }

  function startRename(e: React.MouseEvent, session: HistoryMeta) {
    e.stopPropagation()
    setRenamingId(session.id)
    setRenameValue(session.title)
    setTimeout(() => renameRef.current?.select(), 30)
  }

  async function commitRename(id: string) {
    const title = renameValue.trim()
    if (!title) { setRenamingId(null); return }
    await fetch(`${apiBase}/api/history/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    }).catch(() => {})
    setSessions(s => s.map(x => x.id === id ? { ...x, title } : x))
    setRenamingId(null)
  }

  function highlightSnippet(snippet: string, query: string): string {
    const idx = snippet.toLowerCase().indexOf(query.toLowerCase())
    if (idx < 0) return snippet
    return snippet.slice(0, idx) + '**' + snippet.slice(idx, idx + query.length) + '**' + snippet.slice(idx + query.length)
  }

  const titleFiltered = sessions.filter(s =>
    !search.trim() || s.title.toLowerCase().includes(search.toLowerCase()),
  )

  // Build date-grouped map
  const grouped = new Map<DateGroup, HistoryMeta[]>()
  for (const s of titleFiltered) {
    const g = getDateGroup(s.updatedAt)
    if (!grouped.has(g)) grouped.set(g, [])
    grouped.get(g)!.push(s)
  }

  const isSearching = search.trim().length > 0

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel-drawer panel-left" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <div className="panel-title">
            <Clock size={16} />
            <span>Chat History</span>
          </div>
          <button className="icon-button" onClick={onClose} type="button" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="history-search-wrap">
          <Search size={13} className="history-search-icon" />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search titles and messages…"
            className="history-search-input"
          />
          {searching && <Loader size={12} className="spin history-search-icon" />}
          {search && !searching && (
            <button type="button" className="history-search-clear" onClick={() => { setSearch(''); setContentResults(null) }}>
              <X size={12} />
            </button>
          )}
        </div>

        <div className="panel-body">
          {loading && <p className="panel-hint">Loading…</p>}
          {!loading && sessions.length === 0 && (
            <p className="panel-hint">No saved conversations yet. They'll appear here automatically.</p>
          )}

          {/* Full-content search results */}
          {isSearching && contentResults !== null && contentResults.length > 0 && (
            <>
              <div className="history-group-label">
                Message matches ({contentResults.length})
              </div>
              {contentResults.map(r => (
                <div key={`cr-${r.id}`} className="history-item-row">
                  <button type="button" className="history-item history-item-content-match" onClick={() => void loadSession(r.id)}>
                    <div className="history-item-text">
                      <span className="history-item-title">{r.title}</span>
                      <span className="history-content-snippet">{highlightSnippet(r.snippet, search.trim())}</span>
                      <div className="history-item-meta">
                        <span className="history-model-badge">{r.model.split(':')[0]}</span>
                        <span>{relativeTime(r.updatedAt)}</span>
                      </div>
                    </div>
                  </button>
                  <button type="button" className="icon-button history-delete" onClick={(e) => void deleteSession(e, r.id)} aria-label="Delete">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              {titleFiltered.length > 0 && <div className="history-group-label" style={{ marginTop: 8 }}>Title matches</div>}
            </>
          )}

          {isSearching && contentResults !== null && contentResults.length === 0 && titleFiltered.length === 0 && (
            <p className="panel-hint">No matches for "{search}".</p>
          )}

          {/* Normal / title-filtered list */}
          {DATE_GROUP_ORDER.map(group => {
            const items = grouped.get(group)
            if (!items?.length) return null
            return (
              <div key={group} className="history-group">
                <div className="history-group-label">{group}</div>
                {items.map((s) => (
                  <div key={s.id} className="history-item-row">
                    {renamingId === s.id ? (
                      <div className="history-rename-wrap">
                        <input
                          ref={renameRef}
                          type="text"
                          value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') void commitRename(s.id)
                            if (e.key === 'Escape') setRenamingId(null)
                          }}
                          onBlur={() => void commitRename(s.id)}
                          className="history-rename-input"
                          maxLength={80}
                          autoFocus
                        />
                        <button type="button" className="history-rename-ok" onClick={() => void commitRename(s.id)}>
                          <Check size={12} />
                        </button>
                      </div>
                    ) : (
                      <button type="button" className="history-item" onClick={() => { void loadSession(s.id) }}>
                        <div className="history-item-text">
                          <span className="history-item-title">{s.title}</span>
                          <div className="history-item-meta">
                            <span className="history-model-badge">{s.model.split(':')[0]}</span>
                            <span>{relativeTime(s.updatedAt)}</span>
                          </div>
                        </div>
                      </button>
                    )}
                    <button type="button" className="icon-button history-rename-btn" onClick={(e) => startRename(e, s)} aria-label="Rename" title="Rename">
                      <Pencil size={12} />
                    </button>
                    <button type="button" className="icon-button history-delete" onClick={(e) => { void deleteSession(e, s.id) }} aria-label="Delete">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

