import { useEffect, useRef, useState } from 'react'
import { BookOpen, Plus, Search, Trash2, X } from 'lucide-react'

interface Template {
  id: string
  category: string
  label: string
  prompt: string
  custom?: boolean
}

const BUILT_IN_TEMPLATES: Template[] = [
  // ── Code ──
  { id: 'code-review', category: 'Code', label: '🔍 Code Review', prompt: 'Review this code for bugs, security issues, performance, and best practices. Be specific:\n\n```\n\n```' },
  { id: 'explain-code', category: 'Code', label: '💡 Explain Code', prompt: 'Explain what this code does, step by step. Include the purpose of key functions:\n\n```\n\n```' },
  { id: 'write-tests', category: 'Code', label: '🧪 Write Tests', prompt: 'Write comprehensive unit tests for this code. Cover edge cases:\n\n```\n\n```' },
  { id: 'debug', category: 'Code', label: '🐛 Debug Error', prompt: 'I\'m getting this error. Help me debug it:\n\n**Error:**\n```\n\n```\n\n**Relevant code:**\n```\n\n```' },
  { id: 'refactor', category: 'Code', label: '♻️ Refactor', prompt: 'Refactor this code to improve readability, performance, and maintainability:\n\n```\n\n```' },
  { id: 'document', category: 'Code', label: '📖 Document', prompt: 'Add clear documentation (docstrings, comments, README section) to this code:\n\n```\n\n```' },
  // ── Analysis ──
  { id: 'summarize', category: 'Analysis', label: '📋 Summarize', prompt: 'Summarize this concisely in 3-5 bullet points. Highlight the most important points:\n\n' },
  { id: 'pros-cons', category: 'Analysis', label: '⚖️ Pros & Cons', prompt: 'Give me a balanced pros and cons analysis. Be specific and practical:\n\n' },
  { id: 'eli5', category: 'Analysis', label: '👶 Explain Simply', prompt: 'Explain this concept simply, as if to a smart beginner with no prior knowledge:\n\n' },
  { id: 'compare', category: 'Analysis', label: '🔄 Compare', prompt: 'Compare and contrast these two options across: features, performance, ease of use, cost, and best use cases.\n\nOption A:\nOption B:' },
  // ── Writing ──
  { id: 'email', category: 'Writing', label: '📧 Professional Email', prompt: 'Write a clear, professional email. Context:\n\n' },
  { id: 'improve', category: 'Writing', label: '✍️ Improve Writing', prompt: 'Improve this text — fix grammar, make it clearer and more engaging, keep the same tone:\n\n' },
  // ── System ──
  { id: 'system-status', category: 'System', label: '📊 System Status', prompt: 'Show me a full system status: CPU usage, RAM, disk space, top processes by CPU/memory, and system uptime.' },
  { id: 'daily-brief', category: 'System', label: '📅 Daily Briefing', prompt: 'Give me my daily briefing: overdue tasks, tasks due today, upcoming tasks, and system health.' },
  // ── Research ──
  { id: 'search-web', category: 'Research', label: '🌐 Research Topic', prompt: 'Search the web and give me a comprehensive, cited overview of:\n\n' },
  { id: 'find-docs', category: 'Research', label: '📖 Find Docs', prompt: 'Find the official documentation and show me the key APIs and usage examples for:\n\n' },
]

const STORAGE_KEY = 'ultron-custom-templates'

function loadCustom(): Template[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Template[]) : []
  } catch { return [] }
}

function saveCustom(templates: Template[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates))
}

interface Props {
  onSelect: (prompt: string) => void
  onClose: () => void
  currentDraft?: string
}

export function TemplatesPanel({ onSelect, onClose, currentDraft }: Props) {
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [custom, setCustom] = useState<Template[]>(loadCustom)
  const [saving, setSaving] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTimeout(() => searchRef.current?.focus(), 80)
  }, [])

  const all = [...BUILT_IN_TEMPLATES, ...custom]
  const categories = [...new Set(all.map(t => t.category))]

  const filtered = all.filter(t => {
    const q = search.toLowerCase()
    const matchSearch = !q || t.label.toLowerCase().includes(q) || t.prompt.toLowerCase().includes(q)
    const matchCat = !activeCategory || t.category === activeCategory
    return matchSearch && matchCat
  })

  function saveCurrentAsDraft() {
    if (!currentDraft?.trim() || !newLabel.trim()) return
    const tpl: Template = {
      id: `custom-${Date.now()}`,
      category: 'Custom',
      label: `⭐ ${newLabel.trim()}`,
      prompt: currentDraft.trim(),
      custom: true,
    }
    const next = [tpl, ...custom]
    setCustom(next)
    saveCustom(next)
    setNewLabel('')
    setSaving(false)
  }

  function deleteCustom(id: string) {
    const next = custom.filter(t => t.id !== id)
    setCustom(next)
    saveCustom(next)
  }

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel-drawer panel-left panel-wide" onClick={e => e.stopPropagation()}>
        <div className="panel-header">
          <div className="panel-title">
            <BookOpen size={16} />
            <span>Prompt Templates</span>
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
            placeholder="Search templates…"
            className="history-search-input"
          />
        </div>

        {/* Categories */}
        <div className="template-cats">
          <button type="button" className={`template-cat${!activeCategory ? ' active' : ''}`} onClick={() => setActiveCategory(null)}>All</button>
          {categories.map(cat => (
            <button key={cat} type="button" className={`template-cat${activeCategory === cat ? ' active' : ''}`} onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}>
              {cat}
            </button>
          ))}
        </div>

        {/* Save current draft as template */}
        {currentDraft && currentDraft.length > 10 && (
          <div className="template-save-wrap">
            {saving ? (
              <div className="template-save-row">
                <input
                  type="text"
                  value={newLabel}
                  onChange={e => setNewLabel(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveCurrentAsDraft()}
                  placeholder="Template name…"
                  className="history-search-input"
                  autoFocus
                />
                <button type="button" className="template-save-btn" onClick={saveCurrentAsDraft} disabled={!newLabel.trim()}>Save</button>
                <button type="button" className="template-save-btn ghost" onClick={() => setSaving(false)}>Cancel</button>
              </div>
            ) : (
              <button type="button" className="template-add-btn" onClick={() => setSaving(true)}>
                <Plus size={12} /> Save current draft as template
              </button>
            )}
          </div>
        )}

        <div className="panel-body">
          {filtered.length === 0 && <p className="panel-hint">No templates match "{search}".</p>}
          {filtered.map(t => (
            <div key={t.id} className="template-item-wrap">
              <button
                type="button"
                className="template-item"
                onClick={() => { onSelect(t.prompt); onClose() }}
              >
                <span className="template-label">{t.label}</span>
                <span className="template-preview">{t.prompt.replace(/```[\s\S]*?```/g, '[code]').slice(0, 90).replace(/\n/g, ' ')}</span>
              </button>
              {t.custom && (
                <button
                  type="button"
                  className="template-delete"
                  onClick={() => deleteCustom(t.id)}
                  title="Delete"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
