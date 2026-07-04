import { useRef, useState } from 'react'
import { Loader, Scale, Send, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AppSettings } from '../types'

const API_BASE = import.meta.env.DEV ? 'http://localhost:8787' : ''

interface ModelResult {
  content: string
  done: boolean
  error: string | null
  firstTokenMs: number | null
  responseTokens: number | null
  tokensPerSec: number | null
}

interface Props {
  models: string[]
  settings: AppSettings
  onClose: () => void
  initialDraft?: string
}

export function ComparePanel({ models, settings, onClose, initialDraft }: Props) {
  const nonEmbedModels = models.filter(m => !m.includes('embed'))
  const [selectedModels, setSelectedModels] = useState<string[]>(
    nonEmbedModels.slice(0, Math.min(nonEmbedModels.length, 4)),
  )
  const [draft, setDraft] = useState(initialDraft ?? '')
  const [results, setResults] = useState<Map<string, ModelResult>>(new Map())
  const [running, setRunning] = useState(false)
  const [shownPrompt, setShownPrompt] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  function toggleModel(model: string) {
    setSelectedModels(prev => {
      if (prev.includes(model)) return prev.length <= 1 ? prev : prev.filter(m => m !== model)
      return prev.length >= 4 ? prev : [...prev, model]
    })
  }

  async function runCompare() {
    const text = draft.trim()
    if (!text || running || selectedModels.length === 0) return

    setShownPrompt(text)
    const initial = new Map<string, ModelResult>()
    for (const m of selectedModels) {
      initial.set(m, { content: '', done: false, error: null, firstTokenMs: null, responseTokens: null, tokensPerSec: null })
    }
    setResults(initial)
    setRunning(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch(`${API_BASE}/api/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: text }],
          models: selectedModels,
          temperature: settings.temperature,
          numCtx: settings.numCtx,
          systemPrompt: settings.systemPrompt || undefined,
        }),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const events = buf.split('\n\n')
        buf = events.pop() ?? ''

        for (const rawEvent of events) {
          const eventName = rawEvent.match(/^event: (.+)$/m)?.[1]
          const dataLine = rawEvent.match(/^data: (.+)$/m)?.[1]
          if (!eventName || !dataLine) continue
          const payload = JSON.parse(dataLine) as Record<string, unknown>

          if (eventName === 'token') {
            const model = payload.model as string
            const token = payload.token as string
            setResults(prev => {
              const next = new Map(prev)
              const r = next.get(model)
              if (r) next.set(model, { ...r, content: r.content + token })
              return next
            })
          } else if (eventName === 'model_done') {
            const model = payload.model as string
            setResults(prev => {
              const next = new Map(prev)
              const r = next.get(model)
              if (r) next.set(model, {
                ...r,
                done: true,
                firstTokenMs: (payload.firstTokenMs as number | null) ?? null,
                responseTokens: (payload.responseTokens as number | null) ?? null,
                tokensPerSec: (payload.tokensPerSec as number | null) ?? null,
              })
              return next
            })
          } else if (eventName === 'model_error') {
            const model = payload.model as string
            setResults(prev => {
              const next = new Map(prev)
              const r = next.get(model)
              if (r) next.set(model, { ...r, done: true, error: payload.error as string })
              return next
            })
          }
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        console.error('Compare error:', err)
      }
    } finally {
      setRunning(false)
      abortRef.current = null
    }
  }

  const colCount = Math.max(1, selectedModels.length)

  return (
    <div className="compare-overlay" onClick={onClose}>
      <div className="compare-panel" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="compare-header">
          <div className="compare-title">
            <Scale size={16} />
            <span>Model Compare</span>
            <span className="compare-title-sub">Run the same prompt across all local models simultaneously</span>
          </div>
          <div className="compare-header-actions">
            {running && (
              <button type="button" className="sidebar-action-btn" onClick={() => { abortRef.current?.abort(); setRunning(false) }}>
                Stop
              </button>
            )}
            <button className="icon-button" onClick={onClose} type="button" aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Model selection chips */}
        <div className="compare-model-row">
          <span className="compare-row-label">Models</span>
          {nonEmbedModels.map(m => {
            const rank = selectedModels.indexOf(m)
            const isSelected = rank !== -1
            return (
              <button
                key={m}
                type="button"
                className={`compare-model-chip ${isSelected ? 'selected' : ''}`}
                onClick={() => toggleModel(m)}
                title={isSelected ? 'Remove from comparison' : (selectedModels.length >= 4 ? 'Max 4 models' : 'Add to comparison')}
              >
                {m.split(':')[0]}
                {m.includes(':') && m.split(':')[1] !== 'latest' && (
                  <span className="compare-chip-ver">:{m.split(':')[1]}</span>
                )}
                {isSelected && <span className="compare-chip-rank">{rank + 1}</span>}
              </button>
            )
          })}
          {nonEmbedModels.length === 0 && (
            <span className="compare-hint">No models available — is Ollama running?</span>
          )}
          <span className="compare-hint" style={{ marginLeft: 'auto' }}>
            {selectedModels.length}/4 selected · up to 4
          </span>
        </div>

        {/* Composer */}
        <div className="compare-composer">
          <textarea
            className="compare-textarea"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="Enter a prompt to compare across selected models… (Enter to run, Shift+Enter for newline)"
            rows={2}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void runCompare()
              }
            }}
          />
          <button
            type="button"
            className="icon-button"
            onClick={() => void runCompare()}
            disabled={!draft.trim() || running || selectedModels.length === 0}
            title="Run comparison (Enter)"
          >
            {running ? <Loader size={16} className="spin" /> : <Send size={16} />}
          </button>
        </div>

        {/* Prompt label strip */}
        {shownPrompt && results.size > 0 && (
          <div className="compare-prompt-strip">
            <strong>Prompt:</strong>{' '}
            {shownPrompt.length > 140 ? shownPrompt.slice(0, 140) + '…' : shownPrompt}
          </div>
        )}

        {/* Results grid */}
        {results.size > 0 ? (
          <div className={`compare-results compare-cols-${Math.min(colCount, 4)}`}>
            {selectedModels.map(model => {
              const r = results.get(model)
              if (!r) return null
              return (
                <div key={model} className="compare-col">
                  <div className="compare-col-header">
                    <span className="compare-col-model">{model.split(':')[0]}</span>
                    {model.includes(':') && model.split(':')[1] !== 'latest' && (
                      <span className="compare-col-ver">{model.split(':')[1]}</span>
                    )}
                    {!r.done && !r.error && <Loader size={11} className="spin compare-loader" />}
                    {r.done && !r.error && <span className="compare-done-badge">✓</span>}
                    {r.error && <span className="compare-err-badge">✗</span>}
                  </div>

                  <div className="compare-col-body">
                    {r.error ? (
                      <p className="compare-error-text">{r.error}</p>
                    ) : r.content ? (
                      <div className="compare-markdown">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{r.content}</ReactMarkdown>
                      </div>
                    ) : (
                      <div className="typing-dots" aria-label="Generating">
                        <span /><span /><span />
                      </div>
                    )}
                  </div>

                  {r.done && !r.error && (
                    <div className="compare-col-footer">
                      {r.firstTokenMs !== null && (
                        <span title="Time to first token">⚡ {(r.firstTokenMs / 1000).toFixed(2)}s</span>
                      )}
                      {r.responseTokens !== null && <span>{r.responseTokens} tok</span>}
                      {r.tokensPerSec !== null && <span>{r.tokensPerSec} tok/s</span>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="compare-empty">
            <Scale size={36} className="compare-empty-icon" />
            <strong>Side-by-side model comparison</strong>
            <p>
              Select models above, type a prompt, and press Enter.<br />
              All selected models respond simultaneously — compare quality, speed, and style.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
