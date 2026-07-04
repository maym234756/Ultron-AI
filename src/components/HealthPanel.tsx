import { useEffect, useState } from 'react'
import { Activity, AlertTriangle, CheckCircle, Download, Loader, RefreshCw, ShieldCheck, Trash2, X } from 'lucide-react'
import type { CapabilityStatus, ConnectorStatusSnapshot } from '../types'
import { clearTelemetry, exportTelemetry, getTelemetrySnapshot } from '../lib/telemetry'
import type { TelemetrySnapshot } from '../lib/telemetry'

interface Props {
  apiBase: string
  onClose: () => void
}

export function HealthPanel({ apiBase, onClose }: Props) {
  const [status, setStatus] = useState<CapabilityStatus | null>(null)
  const [connectors, setConnectors] = useState<ConnectorStatusSnapshot | null>(null)
  const [telemetry, setTelemetry] = useState<TelemetrySnapshot>(getTelemetrySnapshot)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function refresh() {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`${apiBase}/api/capabilities/status`)
      if (!response.ok) throw new Error(`Health check failed (${response.status})`)
      setStatus(await response.json() as CapabilityStatus)
      const connectorResponse = await fetch(`${apiBase}/api/connectors/status`).catch(() => null)
      if (connectorResponse?.ok) setConnectors(await connectorResponse.json() as ConnectorStatusSnapshot)
      setTelemetry(getTelemetrySnapshot())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Health check failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    const syncTelemetry = () => setTelemetry(getTelemetrySnapshot())
    window.addEventListener('ultron-telemetry-updated', syncTelemetry)
    return () => window.removeEventListener('ultron-telemetry-updated', syncTelemetry)
  }, [apiBase]) // eslint-disable-line react-hooks/exhaustive-deps

  const recentRoutes = telemetry.entries.slice(0, 6)
  const slowPrompts = [...telemetry.entries].sort((a, b) => b.totalResponseMs - a.totalResponseMs).slice(0, 4)
  const failures = telemetry.entries.filter(entry => entry.errorType).slice(0, 4)
  const modelRows = Object.entries(telemetry.entries.reduce<Record<string, { count: number; total: number; tokens: number; tokenSamples: number }>>((acc, entry) => {
    const row = acc[entry.model] ?? { count: 0, total: 0, tokens: 0, tokenSamples: 0 }
    row.count += 1
    row.total += entry.totalResponseMs
    if (typeof entry.tokensPerSec === 'number') {
      row.tokens += entry.tokensPerSec
      row.tokenSamples += 1
    }
    acc[entry.model] = row
    return acc
  }, {})).map(([model, row]) => ({
    model,
    count: row.count,
    averageTotal: Math.round(row.total / row.count),
    averageTokens: row.tokenSamples ? Math.round(row.tokens / row.tokenSamples) : null,
  })).slice(0, 5)

  function formatMs(value: number | null | undefined): string {
    if (typeof value !== 'number') return 'n/a'
    if (value >= 1000) return `${(value / 1000).toFixed(1)}s`
    return `${value}ms`
  }

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel-drawer panel-right panel-wide" onClick={e => e.stopPropagation()}>
        <div className="panel-header">
          <div className="panel-title">
            <Activity size={16} />
            <span>Health Command Center</span>
          </div>
          <div className="panel-header-actions">
            <button type="button" className="sidebar-action-btn" onClick={() => void refresh()} disabled={loading}>
              {loading ? <Loader size={13} className="spin" /> : <RefreshCw size={13} />}
              Refresh
            </button>
            <button type="button" className="sidebar-action-btn" onClick={exportTelemetry} disabled={telemetry.entries.length === 0}>
              <Download size={13} />
              Export
            </button>
            <button type="button" className="sidebar-action-btn" onClick={() => { clearTelemetry(); setTelemetry(getTelemetrySnapshot()) }} disabled={telemetry.entries.length === 0}>
              <Trash2 size={13} />
              Clear
            </button>
            <button className="icon-button" onClick={onClose} type="button" aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="panel-body health-body">
          {error && (
            <div className="health-hero unhealthy">
              <AlertTriangle size={22} />
              <div>
                <strong>Health check unavailable</strong>
                <span>{error}</span>
              </div>
            </div>
          )}

          {!error && status && (
            <>
              <div className={`health-hero ${status.healthy ? 'healthy' : 'unhealthy'}`}>
                {status.healthy ? <ShieldCheck size={24} /> : <AlertTriangle size={24} />}
                <div>
                  <strong>{status.summary}</strong>
                  <span>
                    {status.toolCount} tools loaded · {status.models.length} models · checked {new Date(status.checkedAt).toLocaleTimeString()}
                  </span>
                </div>
              </div>

              <div className="health-grid">
                {status.statuses.map(row => (
                  <div key={row.id} className={`health-card ${row.ok ? 'ok' : 'warn'}`}>
                    {row.ok ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
                    <div>
                      <strong>{row.label}</strong>
                      <span>{row.detail}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="health-models">
                <span className="settings-section-title">Available Models</span>
                <p>{status.models.length ? status.models.join(', ') : 'No models reported'}</p>
              </div>

              <section className="diagnostics-panel">
                <div className="diagnostics-header">
                  <span className="settings-section-title">Local Diagnostics</span>
                  <p>{telemetry.totals.count} captured responses · {telemetry.totals.errors} error(s)</p>
                </div>

                <div className="diagnostics-metrics">
                  <div><strong>{formatMs(telemetry.totals.averageFirstTokenMs)}</strong><span>Avg first token</span></div>
                  <div><strong>{formatMs(telemetry.totals.averageTotalMs)}</strong><span>Avg total time</span></div>
                  <div><strong>{telemetry.totals.averageTokensPerSec ?? 'n/a'}</strong><span>Avg tokens/sec</span></div>
                  <div><strong>{connectors ? `${connectors.apiReady}/${connectors.browserReady}` : 'n/a'}</strong><span>API/browser connectors</span></div>
                </div>

                <div className="diagnostics-columns">
                  <div className="diagnostics-card">
                    <strong>Recent Routes</strong>
                    {recentRoutes.length ? recentRoutes.map(entry => (
                      <span key={entry.id}>{entry.route} · {entry.intelligenceMode} · {Math.round(entry.confidence * 100)}% · {formatMs(entry.firstTokenMs)}</span>
                    )) : <span>No telemetry captured yet.</span>}
                  </div>
                  <div className="diagnostics-card">
                    <strong>Slow Prompts</strong>
                    {slowPrompts.length ? slowPrompts.map(entry => (
                      <span key={entry.id}>{formatMs(entry.totalResponseMs)} · {entry.route} · {entry.promptLength} chars</span>
                    )) : <span>No slow prompt data yet.</span>}
                  </div>
                  <div className="diagnostics-card">
                    <strong>Tool Failures</strong>
                    {failures.length ? failures.map(entry => (
                      <span key={entry.id}>{entry.route} · {entry.errorType}</span>
                    )) : <span>No failures captured.</span>}
                  </div>
                  <div className="diagnostics-card">
                    <strong>Model Latency</strong>
                    {modelRows.length ? modelRows.map(row => (
                      <span key={row.model}>{row.model}: {formatMs(row.averageTotal)} avg · {row.averageTokens ?? 'n/a'} tok/s · {row.count} run(s)</span>
                    )) : <span>No model samples yet.</span>}
                  </div>
                </div>
              </section>
            </>
          )}

          {loading && !status && !error && (
            <p className="panel-hint">Checking Ultron's local systems...</p>
          )}
        </div>
      </div>
    </div>
  )
}