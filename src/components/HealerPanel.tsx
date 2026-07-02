import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle, Info, Loader, RefreshCw, Shield, X, Zap } from 'lucide-react'
import type { HealerIssue, HealerLogEntry, HealerState } from '../types'

interface Props {
  apiBase: string
  onClose: () => void
}

export function HealerPanel({ apiBase, onClose }: Props) {
  const [state, setState] = useState<HealerState | null>(null)
  const [scanning, setScanning] = useState(false)
  const [healingId, setHealingId] = useState<string | null>(null)
  const [healResult, setHealResult] = useState<Record<string, { success: boolean; message: string }>>({})
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function fetchStatus() {
    try {
      const r = await fetch(`${apiBase}/api/healer/status`)
      if (r.ok) setState(await r.json() as HealerState)
    } catch { /* offline */ }
  }

  useEffect(() => {
    void fetchStatus()
    pollRef.current = setInterval(() => void fetchStatus(), 5000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [apiBase]) // eslint-disable-line react-hooks/exhaustive-deps

  async function runScan() {
    setScanning(true)
    try {
      const r = await fetch(`${apiBase}/api/healer/scan`, { method: 'POST' })
      if (r.ok) setState(await r.json() as HealerState)
    } finally {
      setScanning(false)
      void fetchStatus()
    }
  }

  async function analyzeIssue(issue: HealerIssue) {
    setHealingId(issue.id)
    setHealResult(prev => { const n = { ...prev }; delete n[issue.id]; return n })

    try {
      const response = await fetch(`${apiBase}/api/healer/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId: issue.id }),
      })

      if (!response.ok || !response.body) {
        const err = await response.json().catch(() => ({ error: 'Request failed' })) as { error?: string }
        setHealResult(prev => ({ ...prev, [issue.id]: { success: false, message: err.error ?? 'Failed' } }))
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const events = buf.split('\n\n')
        buf = events.pop() ?? ''

        for (const raw of events) {
          const eventName = raw.match(/^event: (.+)$/m)?.[1]
          const dataLine = raw.match(/^data: (.+)$/m)?.[1]
          if (!eventName || !dataLine) continue
          const data = JSON.parse(dataLine) as Record<string, unknown>

          if (eventName === 'result') {
            setHealResult(prev => ({
              ...prev,
              [issue.id]: {
                success: data.success as boolean,
                message: data.message as string,
              },
            }))
          }
          if (eventName === 'error') {
            setHealResult(prev => ({
              ...prev,
              [issue.id]: { success: false, message: data.message as string },
            }))
          }
        }
      }
    } finally {
      setHealingId(null)
      void fetchStatus()
    }
  }

  const errors = state?.issues.filter(i => i.severity === 'error') ?? []
  const warnings = state?.issues.filter(i => i.severity === 'warning') ?? []

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel-drawer panel-right panel-wide" onClick={e => e.stopPropagation()}>
        <div className="panel-header">
          <div className="panel-title">
            <Zap size={16} />
            <span>Self-Healer</span>
            {errors.length > 0 && (
              <span className="healer-badge error">{errors.length}</span>
            )}
            {warnings.length > 0 && (
              <span className="healer-badge warning">{warnings.length}</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              type="button"
              className="sidebar-action-btn"
              onClick={runScan}
              disabled={scanning || state?.status === 'scanning'}
              title="Scan for TypeScript errors"
            >
              {scanning || state?.status === 'scanning'
                ? <Loader size={13} className="spin" />
                : <RefreshCw size={13} />}
              Scan
            </button>
            <button className="icon-button" onClick={onClose} type="button" aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Guardrails notice */}
        <div className="healer-notice">
          <Shield size={12} />
          <span>
            All fixes are <strong>proposals only</strong> — they appear in the Preview panel for your
            approval before any file is changed. The healing agent can only use{' '}
            <code>read_file</code>, <code>code_search</code>, and <code>preview_write</code>.
          </span>
        </div>

        <div className="panel-body">
          {/* Last scan info */}
          {state?.lastScanAt && (
            <div className="healer-scan-meta">
              Last scan: {new Date(state.lastScanAt).toLocaleTimeString()}
              {state.scanDurationMs ? ` (${(state.scanDurationMs / 1000).toFixed(1)}s)` : ''}
              {state.scanError && (
                <span className="healer-scan-error"> — Error: {state.scanError}</span>
              )}
            </div>
          )}

          {/* No issues */}
          {state && state.issues.length === 0 && state.lastScanAt && (
            <div className="healer-clean">
              <CheckCircle size={22} />
              <span>No TypeScript errors detected</span>
            </div>
          )}

          {/* Not scanned yet */}
          {!state?.lastScanAt && (
            <p className="panel-hint">
              Click <strong>Scan</strong> to check for TypeScript errors in the codebase.
              The healer will analyze issues and propose fixes for your review.
            </p>
          )}

          {/* Issues list */}
          {state?.issues.map(issue => {
            const result = healResult[issue.id]
            const isHealing = healingId === issue.id
            return (
              <div key={issue.id} className={`healer-issue ${issue.severity}`}>
                <div className="healer-issue-header">
                  {issue.severity === 'error'
                    ? <AlertTriangle size={13} className="healer-issue-icon error" />
                    : <Info size={13} className="healer-issue-icon warning" />}
                  <div className="healer-issue-info">
                    <span className="healer-file">
                      {issue.relativePath.split('/').pop()}:{issue.line}
                    </span>
                    <span className="healer-code">{issue.code}</span>
                    <span className="healer-message">{issue.message}</span>
                  </div>
                  {!result && (
                    <button
                      type="button"
                      className="healer-fix-btn"
                      onClick={() => void analyzeIssue(issue)}
                      disabled={!!healingId || state?.status === 'healing'}
                    >
                      {isHealing
                        ? <><Loader size={11} className="spin" /> Analyzing…</>
                        : <><Zap size={11} /> Fix</>}
                    </button>
                  )}
                </div>
                {result && (
                  <div className={`healer-result ${result.success ? 'success' : 'fail'}`}>
                    {result.success
                      ? <><CheckCircle size={11} /> {result.message}</>
                      : <><AlertTriangle size={11} /> {result.message}</>}
                  </div>
                )}
              </div>
            )
          })}

          {/* Audit log */}
          {state && state.log.length > 0 && (
            <>
              <div className="healer-log-heading">Heal History</div>
              {state.log.map((entry: HealerLogEntry) => (
                <div key={entry.id} className="healer-log-entry">
                  <span className={`healer-log-status ${entry.success ? 'success' : 'fail'}`}>
                    {entry.success ? '✓' : '✗'}
                  </span>
                  <div className="healer-log-info">
                    <span className="healer-log-file">
                      {entry.issue.relativePath.split('/').pop()}:{entry.issue.line} — {entry.issue.code}
                    </span>
                    <span className="healer-log-time">
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
