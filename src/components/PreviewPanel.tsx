import { useState, useEffect, useCallback } from 'react'
import { Check, X, ChevronDown, ChevronRight, FileCode2, Terminal, AlertTriangle } from 'lucide-react'

const API_BASE = import.meta.env.DEV ? 'http://localhost:8787' : ''

export interface PendingPreview {
  id: string
  type: 'file' | 'exec'
  path?: string
  command?: string
  oldContent?: string | null
  newContent?: string
  description?: string
  lang?: string
  createdAt: number
}

// ── Unified diff algorithm (LCS-based) ───────────────────────────────────────

type DiffLine = { type: 'add' | 'remove' | 'equal'; content: string }

function computeDiff(oldText: string | null, newText: string): DiffLine[] {
  const newLines = newText.split('\n')

  if (!oldText) {
    return newLines.map(l => ({ type: 'add' as const, content: l }))
  }

  const oldLines = oldText.split('\n')

  // For very large files, show new content only
  if (oldLines.length > 400 || newLines.length > 400) {
    return newLines.map(l => ({ type: 'equal' as const, content: l }))
  }

  // LCS table
  const m = oldLines.length
  const n = newLines.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  // Backtrack
  const result: DiffLine[] = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ type: 'equal', content: oldLines[i - 1] })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'add', content: newLines[j - 1] })
      j--
    } else {
      result.unshift({ type: 'remove', content: oldLines[i - 1] })
      i--
    }
  }
  return result
}

// Count only lines that actually changed (not equal)
function countChangedLines(diff: DiffLine[]): { added: number; removed: number } {
  return diff.reduce(
    (acc, l) => {
      if (l.type === 'add')    acc.added++
      if (l.type === 'remove') acc.removed++
      return acc
    },
    { added: 0, removed: 0 },
  )
}

// ── PreviewItem ───────────────────────────────────────────────────────────────

interface ItemProps {
  preview: PendingPreview
  applying: boolean
  onApply(): void
  onDiscard(): void
}

function PreviewItem({ preview, applying, onApply, onDiscard }: ItemProps) {
  const [expanded, setExpanded] = useState(false)

  const diff = preview.type === 'file'
    ? computeDiff(preview.oldContent ?? null, preview.newContent ?? '')
    : []

  const { added, removed } = countChangedLines(diff)
  const isNewFile = preview.type === 'file' && preview.oldContent === null

  return (
    <div className="preview-item">
      <div className="preview-item-header" onClick={() => setExpanded(e => !e)}>
        <div className="preview-item-left">
          <span className="preview-chevron">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <span className="preview-item-icon">
            {preview.type === 'file' ? <FileCode2 size={14} /> : <Terminal size={14} />}
          </span>
          <span className="preview-item-path">
            {preview.type === 'file'
              ? (preview.path ?? '').replace(/\\/g, '/').split('/').slice(-3).join('/')
              : preview.command}
          </span>
          {isNewFile && <span className="preview-badge new">NEW</span>}
          {preview.type === 'file' && !isNewFile && (
            <span className="preview-diff-counts">
              {added > 0 && <span className="diff-added">+{added}</span>}
              {removed > 0 && <span className="diff-removed">-{removed}</span>}
            </span>
          )}
        </div>
        <div className="preview-item-right">
          {preview.description && (
            <span className="preview-description" title={preview.description}>
              {preview.description.slice(0, 60)}{preview.description.length > 60 ? '…' : ''}
            </span>
          )}
          <button
            className="preview-btn preview-apply"
            onClick={e => { e.stopPropagation(); onApply() }}
            disabled={applying}
            title="Apply this change"
          >
            {applying ? '…' : <><Check size={12} /> Apply</>}
          </button>
          <button
            className="preview-btn preview-discard"
            onClick={e => { e.stopPropagation(); onDiscard() }}
            disabled={applying}
            title="Discard this change"
          >
            <X size={12} /> Discard
          </button>
        </div>
      </div>

      {expanded && (
        <div className="preview-diff-view">
          {preview.type === 'exec' ? (
            <div className="preview-exec-body">
              <div className="preview-exec-warning">
                <AlertTriangle size={13} /> This command will run in a PowerShell shell
              </div>
              <pre className="preview-exec-cmd">{preview.command}</pre>
            </div>
          ) : (
            <div className="preview-diff-body">
              {diff.map((line, idx) => (
                <div
                  key={idx}
                  className={`diff-line diff-${line.type}`}
                >
                  <span className="diff-gutter">
                    {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
                  </span>
                  <span className="diff-content">{line.content || '\u00a0'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── PreviewPanel (main export) ────────────────────────────────────────────────

export function PreviewPanel() {
  const [previews, setPreviews] = useState<PendingPreview[]>([])
  const [applying, setApplying] = useState<Set<string>>(new Set())
  const [minimized, setMinimized] = useState(false)

  const fetchPreviews = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/previews`)
      if (r.ok) setPreviews(await r.json() as PendingPreview[])
    } catch { /* server offline */ }
  }, [])

  useEffect(() => {
    void fetchPreviews()
    const timer = setInterval(fetchPreviews, 2000)
    return () => clearInterval(timer)
  }, [fetchPreviews])

  if (previews.length === 0) return null

  async function applyOne(id: string) {
    setApplying(prev => new Set([...prev, id]))
    try {
      await fetch(`${API_BASE}/api/previews/${id}/apply`, { method: 'POST' })
      setPreviews(prev => prev.filter(p => p.id !== id))
    } finally {
      setApplying(prev => { const s = new Set(prev); s.delete(id); return s })
    }
  }

  async function discardOne(id: string) {
    await fetch(`${API_BASE}/api/previews/${id}`, { method: 'DELETE' })
    setPreviews(prev => prev.filter(p => p.id !== id))
  }

  async function applyAll() {
    const ids = previews.map(p => p.id)
    for (const id of ids) await applyOne(id)
  }

  async function discardAll() {
    const ids = previews.map(p => p.id)
    for (const id of ids) await discardOne(id)
  }

  return (
    <div className={`preview-panel ${minimized ? 'preview-panel-minimized' : ''}`}>
      <div className="preview-panel-header">
        <button
          className="preview-panel-toggle"
          onClick={() => setMinimized(m => !m)}
          title={minimized ? 'Expand preview panel' : 'Minimize preview panel'}
        >
          {minimized ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <span className="preview-panel-title">
            Pending Changes
          </span>
          <span className="preview-panel-count">{previews.length}</span>
        </button>
        {!minimized && (
          <div className="preview-panel-bulk">
            <button className="preview-btn preview-apply" onClick={() => void applyAll()}>
              <Check size={12} /> Apply All
            </button>
            <button className="preview-btn preview-discard" onClick={() => void discardAll()}>
              <X size={12} /> Discard All
            </button>
          </div>
        )}
      </div>

      {!minimized && (
        <div className="preview-items">
          {previews.map(p => (
            <PreviewItem
              key={p.id}
              preview={p}
              applying={applying.has(p.id)}
              onApply={() => void applyOne(p.id)}
              onDiscard={() => void discardOne(p.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
