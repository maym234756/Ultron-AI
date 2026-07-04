import { useEffect, useRef, useState } from 'react'
import { Cpu, Loader, PackageCheck, RefreshCw, RotateCcw, Send, Shield, Square, X } from 'lucide-react'
import { AgentTrace } from './AgentTrace'
import type { AgentEvent } from '../types'

const API_BASE = import.meta.env.DEV ? 'http://localhost:8787' : ''

interface Props {
  onClose: () => void
  currentModel: string
}

type UpgradeRisk = 'low' | 'medium' | 'high'
type UpgradeStatus = 'pending' | 'running' | 'previewed' | 'applied' | 'rolled_back' | 'dismissed'

type UpgradePack = {
  id: string
  label: string
  description: string
  task: string
  risk: UpgradeRisk
  impact: string
  filesAffected: string[]
  requiredValidation: string[]
}

type BacklogItem = {
  id: string
  title: string
  prompt: string
  risk: UpgradeRisk
  impact: string
  filesAffected: string[]
  requiredValidation: string[]
  packId: string | null
  status: UpgradeStatus
  updatedAt: number
}

type AppliedPreview = {
  id: string
  type: 'file' | 'exec'
  path?: string
  command?: string
  description?: string
  appliedAt: number
  rolledBackAt?: number
  rollbackAvailable: boolean
}

type SafetySnapshot = {
  stage: 'before' | 'after'
  checkedAt: number
  pendingPreviews: number
  appliedPreviews: number
  rollbackablePreviews: number
  toolCount: number
}

type SelfUpgradeSnapshot = {
  packs: UpgradePack[]
  backlog: BacklogItem[]
  appliedPreviews: AppliedPreview[]
  safety: SafetySnapshot
}

const QUICK_TASKS = [
  { emoji: '🔍', label: 'Review for improvements', task: 'Review the Ultron codebase in src/ and server/. Identify the most impactful improvement opportunities — performance, reliability, UX, or missing features. List what you find, then implement the single most valuable one using preview_write.' },
  { emoji: '🐛', label: 'Fix TypeScript errors', task: 'Run lint_code on src/ and server/ to find all TypeScript errors. For each error found, read the affected file, diagnose the issue, and propose a minimal fix using preview_write.' },
  { emoji: '⚡', label: 'Optimize agent performance', task: 'Review server/agent.ts and server/index.ts. Look for performance bottlenecks — unnecessary awaits, redundant processing, or inefficient context handling. Propose targeted optimizations using preview_write.' },
  { emoji: '🎨', label: 'UI accessibility audit', task: 'Review src/App.css and src/components/ for accessibility issues — missing aria-labels, poor contrast, keyboard navigation gaps, or layout issues. Propose improvements using preview_write.' },
  { emoji: '🔒', label: 'Security review', task: 'Review server/index.ts for security issues — input validation gaps, path traversal risks, injection vectors, or missing sanitization. Identify issues and propose fixes using preview_write.' },
  { emoji: '📊', label: 'Add analytics to agent', task: 'Review server/agent.ts. Add better timing metrics (tool call durations, total elapsed ms) to the metrics event so the frontend can display richer performance data. Use preview_write for changes.' },
]

export function SelfUpgradePanel({ onClose, currentModel }: Props) {
  const [task, setTask] = useState('')
  const [running, setRunning] = useState(false)
  const [content, setContent] = useState('')
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([])
  const [done, setDone] = useState(false)
  const [packs, setPacks] = useState<UpgradePack[]>([])
  const [backlog, setBacklog] = useState<BacklogItem[]>([])
  const [appliedPreviews, setAppliedPreviews] = useState<AppliedPreview[]>([])
  const [safety, setSafety] = useState<SafetySnapshot | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const outputRef = useRef<HTMLDivElement>(null)

  async function loadSnapshot() {
    const response = await fetch(`${API_BASE}/api/self-upgrade`).catch(() => null)
    if (!response?.ok) return
    const data = await response.json() as SelfUpgradeSnapshot
    setPacks(data.packs ?? [])
    setBacklog(data.backlog ?? [])
    setAppliedPreviews(data.appliedPreviews ?? [])
    setSafety(data.safety ?? null)
  }

  useEffect(() => { void loadSnapshot() }, [])

  async function rollbackPreview(id: string) {
    await fetch(`${API_BASE}/api/previews/${id}/rollback`, { method: 'POST' }).catch(() => null)
    await loadSnapshot()
  }

  async function runUpgrade(taskText: string, packId?: string) {
    const text = taskText.trim()
    if (!text || running) return

    setRunning(true)
    setContent('')
    setAgentEvents([])
    setDone(false)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch(`${API_BASE}/api/self-upgrade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: text, model: currentModel, packId }),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done: streamDone, value } = await reader.read()
        if (streamDone) break
        buf += decoder.decode(value, { stream: true })
        const events = buf.split('\n\n')
        buf = events.pop() ?? ''

        for (const rawEvent of events) {
          const eventName = rawEvent.match(/^event: (.+)$/m)?.[1]
          const dataLine = rawEvent.match(/^data: (.+)$/m)?.[1]
          if (!eventName || !dataLine) continue
          const payload = JSON.parse(dataLine) as Record<string, unknown>

          switch (eventName) {
            case 'token':
              setContent(prev => prev + (payload.token as string))
              break
            case 'self_upgrade_status':
              if (payload.health) setSafety(payload.health as SafetySnapshot)
              if (payload.item) {
                const item = payload.item as BacklogItem
                setBacklog(prev => [item, ...prev.filter(existing => existing.id !== item.id)])
              }
              if (Array.isArray(payload.appliedPreviews)) setAppliedPreviews(payload.appliedPreviews as AppliedPreview[])
              break
            case 'agent_step':
              setAgentEvents(prev => [...prev, {
                type: 'agent_step',
                step: payload.step as number,
                maxSteps: payload.maxSteps as number,
              }])
              break
            case 'thinking':
              setAgentEvents(prev => [...prev, { type: 'thinking', content: payload.content as string }])
              break
            case 'tool_call':
              setAgentEvents(prev => [...prev, {
                type: 'tool_call',
                id: payload.id as string,
                name: payload.name as string,
                args: payload.args as Record<string, unknown>,
              }])
              break
            case 'tool_result':
              setAgentEvents(prev => [...prev, {
                type: 'tool_result',
                id: payload.id as string,
                name: payload.name as string,
                result: payload.result as string,
              }])
              break
            case 'set_content':
              setContent(payload.content as string)
              break
            case 'metrics':
            case 'all_done':
              setDone(true)
              break
            case 'error':
              setContent(prev => (prev ? prev + '\n\n' : '') + `Error: ${payload.error as string}`)
              setDone(true)
              break
          }

          // Scroll output into view
          setTimeout(() => outputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 50)
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setContent(prev => (prev ? prev + '\n\n' : '') + `Stopped: ${err instanceof Error ? err.message : 'Failed'}`)
      }
    } finally {
      setRunning(false)
      setDone(true)
      abortRef.current = null
      void loadSnapshot()
    }
  }

  function stopUpgrade() {
    abortRef.current?.abort()
    setRunning(false)
    setDone(true)
  }

  function reset() {
    setContent('')
    setAgentEvents([])
    setDone(false)
    setTask('')
  }

  const showWorkspace = !running && !content && agentEvents.length === 0

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel-drawer panel-right upgrade-panel" onClick={e => e.stopPropagation()}>

        <div className="panel-header">
          <div className="panel-title">
            <Cpu size={16} />
            <span>Self-Upgrade</span>
            {running && <Loader size={12} className="spin" style={{ marginLeft: 4 }} />}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {running && (
              <button type="button" className="sidebar-action-btn" onClick={stopUpgrade}>
                <Square size={11} /> Stop
              </button>
            )}
            {done && !running && (
              <button type="button" className="sidebar-action-btn" onClick={reset}>
                ↩ New task
              </button>
            )}
            <button type="button" className="sidebar-action-btn" onClick={() => void loadSnapshot()} disabled={running}>
              <RefreshCw size={11} /> Refresh
            </button>
            <button className="icon-button" onClick={onClose} type="button" aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Guardrails notice */}
        <div className="upgrade-notice">
          <Shield size={12} />
          <span>
            <strong>Guardrailed.</strong> Ultron reads its own source and proposes changes in the{' '}
            <strong>Preview panel</strong> — nothing is written without your approval.
            Only <code>read_file</code>, <code>code_search</code>, <code>lint_code</code>, and{' '}
            <code>preview_write</code> are permitted.
          </span>
        </div>

        <div className="panel-body upgrade-body">

          {/* Quick tasks (shown before running) */}
          {showWorkspace && (
            <>
              {safety && (
                <div className="upgrade-safety-strip">
                  <Shield size={13} />
                  <span>{safety.pendingPreviews} pending preview(s)</span>
                  <span>{safety.rollbackablePreviews} rollbackable change(s)</span>
                  <span>{safety.toolCount} tools</span>
                </div>
              )}

              <p className="settings-section-title">Upgrade packs</p>
              <div className="upgrade-pack-grid">
                {packs.map(pack => (
                  <button
                    key={pack.id}
                    type="button"
                    className={`upgrade-pack-card risk-${pack.risk}`}
                    onClick={() => { setTask(pack.task); void runUpgrade(pack.task, pack.id) }}
                  >
                    <PackageCheck size={15} />
                    <strong>{pack.label}</strong>
                    <span>{pack.description}</span>
                    <small>{pack.risk} risk · {pack.requiredValidation.join(', ')}</small>
                  </button>
                ))}
              </div>

              {backlog.length > 0 && (
                <div className="upgrade-backlog">
                  <p className="settings-section-title">Backlog</p>
                  {backlog.slice(0, 7).map(item => (
                    <button
                      key={item.id}
                      type="button"
                      className={`upgrade-backlog-item status-${item.status}`}
                      onClick={() => { setTask(item.prompt); void runUpgrade(item.prompt, item.packId ?? undefined) }}
                    >
                      <strong>{item.title}</strong>
                      <span>{item.status} · {item.risk} risk · {item.impact}</span>
                    </button>
                  ))}
                </div>
              )}

              <p className="settings-section-title">Quick tasks</p>
              <div className="upgrade-quick-grid">
                {QUICK_TASKS.map(qt => (
                  <button
                    key={qt.emoji}
                    type="button"
                    className="upgrade-quick-btn"
                    onClick={() => { setTask(qt.task); void runUpgrade(qt.task) }}
                  >
                    <span className="upgrade-quick-emoji">{qt.emoji}</span>
                    <span>{qt.label}</span>
                  </button>
                ))}
              </div>

              <p className="settings-section-title" style={{ marginTop: 16 }}>Custom task</p>
              <div className="upgrade-composer">
                <textarea
                  className="compare-textarea"
                  value={task}
                  onChange={e => setTask(e.target.value)}
                  placeholder={`Describe what you want Ultron to improve about itself…\n\nExamples:\n• Add keyboard shortcut Ctrl+T to open Tasks panel\n• Improve the dark mode contrast for code block backgrounds\n• Add a token cost estimate to each message footer`}
                  rows={5}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void runUpgrade(task)
                  }}
                />
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => void runUpgrade(task)}
                  disabled={!task.trim()}
                  title="Run (Ctrl+Enter)"
                >
                  <Send size={16} />
                </button>
              </div>
              <p className="settings-hint" style={{ textAlign: 'center' }}>Ctrl+Enter to run · Changes appear in Preview panel below</p>
            </>
          )}

          {/* Agent trace + output */}
          {(running || content || agentEvents.length > 0) && (
            <>
              <AgentTrace events={agentEvents} />
              {content && (
                <div className="upgrade-output">
                  <pre>{content}</pre>
                </div>
              )}
              {running && !content && agentEvents.length === 0 && (
                <p className="panel-hint">Analyzing codebase…</p>
              )}
            </>
          )}

          {/* Done notice */}
          {done && !running && (
            <div className="upgrade-done-notice">
              <Shield size={13} />
              <span>
                Review proposed changes in the <strong>Preview panel</strong> at the bottom of the screen.
                Click <strong>Apply</strong> to write each change, or <strong>Discard</strong> to skip.
              </span>
            </div>
          )}

          {appliedPreviews.length > 0 && (
            <div className="upgrade-rollback-list">
              <p className="settings-section-title">Rollback history</p>
              {appliedPreviews.slice(0, 6).map(preview => (
                <div key={preview.id} className="upgrade-rollback-item">
                  <span>{preview.description || preview.path || preview.command || preview.id}</span>
                  <small>{new Date(preview.appliedAt).toLocaleString()}{preview.rolledBackAt ? ' · rolled back' : ''}</small>
                  {preview.rollbackAvailable && !preview.rolledBackAt && (
                    <button type="button" onClick={() => void rollbackPreview(preview.id)}>
                      <RotateCcw size={12} /> Roll back
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div ref={outputRef} />
        </div>
      </div>
    </div>
  )
}
