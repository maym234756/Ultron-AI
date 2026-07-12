import { useEffect, useState } from 'react'
import { Activity, AlertTriangle, CheckCircle, Download, Gauge, Loader, RefreshCw, Search, ShieldCheck, Trash2, X } from 'lucide-react'
import type { CapabilityStatus, ConnectorStatusSnapshot, EngineBenchmarkResult, EngineSearchResponse } from '../types'
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
  const [engineQuery, setEngineQuery] = useState('')
  const [engineSearch, setEngineSearch] = useState<EngineSearchResponse | null>(null)
  const [engineSearchLoading, setEngineSearchLoading] = useState(false)
  const [benchmark, setBenchmark] = useState<EngineBenchmarkResult | null>(null)
  const [benchmarkLoading, setBenchmarkLoading] = useState(false)
  const [benchmarkError, setBenchmarkError] = useState('')

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
    window.addEventListener('astra-telemetry-updated', syncTelemetry)
    return () => window.removeEventListener('astra-telemetry-updated', syncTelemetry)
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

  async function searchEngine(query = engineQuery) {
    setEngineSearchLoading(true)
    try {
      const params = new URLSearchParams()
      if (query.trim()) params.set('q', query.trim())
      params.set('limit', '12')
      const response = await fetch(`${apiBase}/api/engine/search?${params.toString()}`)
      if (!response.ok) throw new Error(`Engine search failed (${response.status})`)
      setEngineSearch(await response.json() as EngineSearchResponse)
    } catch (err) {
      setBenchmarkError(err instanceof Error ? err.message : 'Engine search failed')
    } finally {
      setEngineSearchLoading(false)
    }
  }

  async function runBenchmark() {
    setBenchmarkLoading(true)
    setBenchmarkError('')
    try {
      const response = await fetch(`${apiBase}/api/engine/benchmark`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: status?.defaultModel, maxTokens: 64 }),
      })
      const data = await response.json() as Partial<EngineBenchmarkResult> & { error?: string }
      if (!response.ok || data.error) throw new Error(data.error ?? `Benchmark failed (${response.status})`)
      setBenchmark(data as EngineBenchmarkResult)
    } catch (err) {
      setBenchmarkError(err instanceof Error ? err.message : 'Benchmark failed')
    } finally {
      setBenchmarkLoading(false)
    }
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
                  <span className="settings-section-title"><Search size={13} /> Engine Search</span>
                  <p>Find tools, connectors, routes, templates, and public capabilities.</p>
                </div>
                <form className="engine-search-row" onSubmit={event => { event.preventDefault(); void searchEngine() }}>
                  <input value={engineQuery} onChange={event => setEngineQuery(event.target.value)} placeholder="Search capabilities, tools, routes..." />
                  <button type="submit" className="sidebar-action-btn" disabled={engineSearchLoading}>
                    {engineSearchLoading ? <Loader size={13} className="spin" /> : <Search size={13} />}
                    Search
                  </button>
                </form>
                <div className="engine-result-list">
                  {(engineSearch?.results ?? []).slice(0, 8).map(result => (
                    <div key={result.id} className="engine-result-card">
                      <strong>{result.title}</strong>
                      <span>{result.type} · {result.detail}</span>
                    </div>
                  ))}
                  {engineSearch && engineSearch.results.length === 0 && <p className="panel-hint">No matching capability found.</p>}
                  {!engineSearch && <p className="panel-hint">Try “video”, “pdf”, “salesforce”, “benchmark”, “run tracker”, or “coding”.</p>}
                </div>
              </section>

              <section className="diagnostics-panel">
                <div className="diagnostics-header">
                  <span className="settings-section-title"><Gauge size={13} /> Response Benchmark</span>
                  <p>Run a short local Ollama benchmark against the selected default model.</p>
                </div>
                <button type="button" className="sidebar-action-btn benchmark-run-btn" onClick={() => void runBenchmark()} disabled={benchmarkLoading || status.models.length === 0}>
                  {benchmarkLoading ? <Loader size={13} className="spin" /> : <Gauge size={13} />}
                  Run benchmark
                </button>
                {benchmarkError && <div className="notice">{benchmarkError}</div>}
                {benchmark && (
                  <div className="diagnostics-metrics benchmark-metrics">
                    <div><strong>{formatMs(benchmark.totalMs)}</strong><span>Total</span></div>
                    <div><strong>{formatMs(benchmark.loadMs)}</strong><span>Load</span></div>
                    <div><strong>{benchmark.tokensPerSec ?? 'n/a'}</strong><span>Tokens/sec</span></div>
                    <div><strong>{benchmark.responseTokens ?? 'n/a'}</strong><span>Output tokens</span></div>
                  </div>
                )}
                {benchmark?.sample && <p className="panel-hint">{benchmark.model}: {benchmark.sample}</p>}
              </section>

              <section className="diagnostics-panel">
                <div className="diagnostics-header">
                  <span className="settings-section-title">Deployment Readiness</span>
                  <p>{status.runtime.readiness.summary}</p>
                </div>

                <div className="diagnostics-columns">
                  {status.runtime.readiness.checks.map(check => (
                    <div key={check.id} className="diagnostics-card">
                      <strong>{check.label}</strong>
                      <span>{check.ok ? 'Ready' : 'Needs work'} · {check.detail}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="diagnostics-panel">
                <div className="diagnostics-header">
                  <span className="settings-section-title">Runtime Stack</span>
                  <p>{status.runtime.database.provider === 'postgresql' ? 'Postgres-backed runtime' : 'SQLite-backed runtime'}</p>
                </div>

                <div className="diagnostics-columns">
                  <div className="diagnostics-card">
                    <strong>Database</strong>
                    <span>{status.runtime.database.provider} · {status.runtime.database.target}</span>
                  </div>
                  <div className="diagnostics-card">
                    <strong>Identity</strong>
                    <span>{status.runtime.identity.userCount} account(s) · {status.runtime.identity.organizationCount} org(s) · {status.runtime.identity.platformAdminCount} platform admin(s)</span>
                  </div>
                  <div className="diagnostics-card">
                    <strong>Auth Delivery</strong>
                    <span>{status.runtime.auth.deliveryMode} · {status.runtime.auth.deliveryDetail}</span>
                  </div>
                  <div className="diagnostics-card">
                    <strong>Session Cookie</strong>
                    <span>{status.runtime.auth.sessionCookie} · SameSite {status.runtime.auth.sameSite} · {status.runtime.auth.secure ? 'secure' : 'local dev'}</span>
                  </div>
                </div>

                <div className="diagnostics-card">
                  <strong>Local Services</strong>
                  {status.runtime.localServices.some(service => service.enabled)
                    ? status.runtime.localServices.filter(service => service.enabled).map(service => (
                      <a key={service.id} href={service.url} target="_blank" rel="noreferrer">{service.label} · {service.url}</a>
                    ))
                    : <span>No local service links are active for this runtime.</span>}
                </div>
              </section>

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
            <p className="panel-hint">Checking Astra's local systems...</p>
          )}
        </div>
      </div>
    </div>
  )
}