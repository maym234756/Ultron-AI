import { useEffect, useState } from 'react'
import { Activity, AlertTriangle, CheckCircle, ExternalLink, Loader, PlayCircle, RefreshCw, ShieldCheck, X } from 'lucide-react'
import type { ConnectorActionPlan, ConnectorActionSchema, ConnectorPermissionLevel, ConnectorSetupState, ConnectorStatus, ConnectorStatusSnapshot } from '../types'

interface Props {
  apiBase: string
  onClose: () => void
}

function statusLabel(status: ConnectorStatus['status']): string {
  if (status === 'api-ready') return 'API ready'
  if (status === 'browser-ready') return 'Browser ready'
  return 'Setup needed'
}

function statusIcon(status: ConnectorStatus['status']) {
  if (status === 'setup-needed') return <AlertTriangle size={15} />
  return <CheckCircle size={15} />
}

const PERMISSION_LABELS: Record<ConnectorPermissionLevel, string> = {
  'read-only': 'Read only',
  'draft-changes': 'Draft changes',
  'apply-with-approval': 'Apply with approval',
  'safe-auto': 'Fully automated for safe tasks only',
}

function defaultSetup(connector: ConnectorStatus): ConnectorSetupState {
  return {
    connectorId: connector.id,
    preferredAuth: connector.authModes.includes('browser') ? 'browser' : connector.authModes[0],
    permissionLevel: 'apply-with-approval',
    auditLogEnabled: true,
    browserSessionReady: false,
    apiTokenConfigured: connector.apiConfigured,
    lastTestAt: null,
    lastTestOk: null,
    lastTestDetail: 'Not tested yet.',
    updatedAt: Date.now(),
  }
}

export function ConnectorsPanel({ apiBase, onClose }: Props) {
  const [snapshot, setSnapshot] = useState<ConnectorStatusSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | ConnectorStatus['status']>('all')
  const [activeConnectorId, setActiveConnectorId] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [dryRunningName, setDryRunningName] = useState<string | null>(null)
  const [actionPlans, setActionPlans] = useState<Record<string, ConnectorActionPlan>>({})

  async function refresh() {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`${apiBase}/api/connectors/status`)
      if (!response.ok) throw new Error(`Connector status failed (${response.status})`)
      setSnapshot(await response.json() as ConnectorStatusSnapshot)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connector status failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [apiBase]) // eslint-disable-line react-hooks/exhaustive-deps

  const connectors = snapshot?.connectors.filter(connector => filter === 'all' || connector.status === filter) ?? []

  async function updateSetup(connector: ConnectorStatus, patch: Partial<ConnectorSetupState>) {
    setSavingId(connector.id)
    setError('')
    try {
      const response = await fetch(`${apiBase}/api/connectors/${connector.id}/setup`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!response.ok) throw new Error(`Setup update failed (${response.status})`)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup update failed')
    } finally {
      setSavingId(null)
    }
  }

  async function testConnector(connector: ConnectorStatus) {
    setTestingId(connector.id)
    setError('')
    try {
      const response = await fetch(`${apiBase}/api/connectors/${connector.id}/test`, { method: 'POST', credentials: 'include' })
      if (!response.ok) throw new Error(`Connection test failed (${response.status})`)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection test failed')
    } finally {
      setTestingId(null)
    }
  }

  async function dryRunAction(action: ConnectorActionSchema) {
    setDryRunningName(action.name)
    setError('')
    try {
      const response = await fetch(`${apiBase}/api/connectors/actions/dry-run`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionName: action.name, input: {} }),
      })
      if (!response.ok) throw new Error(`Dry-run failed (${response.status})`)
      const data = await response.json() as { plan: ConnectorActionPlan }
      setActionPlans(prev => ({ ...prev, [action.name]: data.plan }))
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dry-run failed')
    } finally {
      setDryRunningName(null)
    }
  }

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel-drawer panel-right connectors-panel" onClick={event => event.stopPropagation()}>
        <div className="panel-header">
          <div className="panel-title">
            <Activity size={16} />
            <span>External Connectors</span>
          </div>
          <div className="panel-header-actions">
            <button type="button" className="sidebar-action-btn" onClick={() => void refresh()} disabled={loading}>
              {loading ? <Loader size={13} className="spin" /> : <RefreshCw size={13} />}
              Refresh
            </button>
            <button className="icon-button" onClick={onClose} type="button" aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="panel-body connectors-body">
          {error && (
            <div className="connectors-hero warning">
              <AlertTriangle size={22} />
              <div>
                <strong>Connector registry unavailable</strong>
                <span>{error}</span>
              </div>
            </div>
          )}

          {!error && snapshot && (
            <>
              <div className="connectors-hero ready">
                <ShieldCheck size={23} />
                <div>
                  <strong>{snapshot.total} connectors registered</strong>
                  <span>{snapshot.apiReady} API-ready · {snapshot.browserReady} browser-ready · checked {new Date(snapshot.checkedAt).toLocaleTimeString()}</span>
                </div>
              </div>

              <div className="connector-filter-row">
                {(['all', 'api-ready', 'browser-ready', 'setup-needed'] as const).map(item => (
                  <button
                    key={item}
                    type="button"
                    className={filter === item ? 'active' : ''}
                    onClick={() => setFilter(item)}
                  >
                    {item === 'all' ? 'All' : statusLabel(item)}
                  </button>
                ))}
              </div>

              <div className="connector-grid">
                {connectors.map(connector => {
                  const setup = snapshot.setupStates[connector.id] ?? defaultSetup(connector)
                  const active = activeConnectorId === connector.id
                  const auditLog = snapshot.auditLog.filter(entry => entry.connectorId === connector.id).slice(0, 3)
                  const nativeActions = (snapshot.nativeActions ?? []).filter(action => action.connectorId === connector.id)
                  return (
                  <article key={connector.id} className={`connector-card ${connector.status}`}>
                    <div className="connector-card-top">
                      <div>
                        <strong>{connector.label}</strong>
                        <span>{connector.category} · {connector.authModes.join(' / ')}</span>
                      </div>
                      <span className="connector-status-pill">
                        {statusIcon(connector.status)}
                        {statusLabel(connector.status)}
                      </span>
                    </div>
                    <p>{connector.detail}</p>
                    <ul>
                      {connector.capabilities.slice(0, 3).map(capability => <li key={capability}>{capability}</li>)}
                    </ul>
                    <div className="connector-card-actions">
                      <button type="button" onClick={() => window.open(connector.homeUrl, '_blank', 'noopener,noreferrer')}>
                        <ExternalLink size={13} />
                        Open
                      </button>
                      <button type="button" onClick={() => setActiveConnectorId(active ? null : connector.id)}>
                        <ShieldCheck size={13} />
                        {active ? 'Hide setup' : 'Setup'}
                      </button>
                      <span>Approves: {connector.sensitiveActions.slice(0, 2).join(', ')}</span>
                    </div>

                    {active && (
                      <div className="connector-setup-wizard">
                        <div className="connector-setup-grid">
                          <label>
                            <span>Auth path</span>
                            <select
                              value={setup.preferredAuth}
                              onChange={event => void updateSetup(connector, { preferredAuth: event.target.value as ConnectorSetupState['preferredAuth'] })}
                              disabled={savingId === connector.id}
                            >
                              {connector.authModes.map(mode => <option key={mode} value={mode}>{mode}</option>)}
                            </select>
                          </label>
                          <label>
                            <span>Permission level</span>
                            <select
                              value={setup.permissionLevel}
                              onChange={event => void updateSetup(connector, { permissionLevel: event.target.value as ConnectorPermissionLevel })}
                              disabled={savingId === connector.id}
                            >
                              {Object.entries(PERMISSION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                            </select>
                          </label>
                        </div>

                        <div className="connector-setup-steps">
                          <div className={connector.browserSupported ? 'ready' : 'blocked'}>
                            <CheckCircle size={13} />
                            <span>Browser tools {connector.browserSupported ? 'ready' : 'missing'}</span>
                          </div>
                          <div className={connector.apiConfigured ? 'ready' : 'blocked'}>
                            {connector.apiConfigured ? <CheckCircle size={13} /> : <AlertTriangle size={13} />}
                            <span>{connector.apiConfigured ? 'API variables configured' : `API vars: ${connector.apiEnvVars.slice(0, 2).join(', ') || 'not defined'}`}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => void updateSetup(connector, { browserSessionReady: !setup.browserSessionReady })}
                            disabled={savingId === connector.id}
                          >
                            {setup.browserSessionReady ? 'Browser signed in' : 'Mark browser signed in'}
                          </button>
                          <button type="button" onClick={() => void testConnector(connector)} disabled={testingId === connector.id}>
                            {testingId === connector.id ? <Loader size={13} className="spin" /> : <RefreshCw size={13} />}
                            Test connection
                          </button>
                        </div>

                        <label className="connector-audit-toggle">
                          <input
                            type="checkbox"
                            checked={setup.auditLogEnabled}
                            onChange={event => void updateSetup(connector, { auditLogEnabled: event.target.checked })}
                            disabled={savingId === connector.id}
                          />
                          <span>Audit log enabled</span>
                        </label>

                        <div className={`connector-test-result ${setup.lastTestOk === false ? 'failed' : setup.lastTestOk ? 'passed' : ''}`}>
                          <strong>{setup.lastTestOk === null ? 'Not tested' : setup.lastTestOk ? 'Connection test passed' : 'Connection needs setup'}</strong>
                          <span>{setup.lastTestDetail}</span>
                        </div>

                        <div className="connector-audit-log">
                          <strong>Audit log</strong>
                          {auditLog.length > 0 ? auditLog.map(entry => (
                            <span key={entry.id}>{new Date(entry.at).toLocaleTimeString()} · {entry.summary}</span>
                          )) : <span>No connector activity logged yet.</span>}
                        </div>

                        {nativeActions.length > 0 && (
                          <div className="connector-native-actions">
                            <strong>Native actions</strong>
                            {nativeActions.map(action => {
                              const plan = actionPlans[action.name]
                              return (
                                <div key={action.name} className={`connector-action-card mode-${action.mode}`}>
                                  <div>
                                    <span>{action.label}</span>
                                    <small>{action.name} · {action.mode}{action.approvalRequired ? ' · approval required' : ' · read-only'}</small>
                                  </div>
                                  <p>{action.description}</p>
                                  <small>Requires: {action.inputSchema.required.join(', ') || 'none'}</small>
                                  <button type="button" onClick={() => void dryRunAction(action)} disabled={dryRunningName === action.name}>
                                    {dryRunningName === action.name ? <Loader size={13} className="spin" /> : <PlayCircle size={13} />}
                                    Dry-run
                                  </button>
                                  {plan && (
                                    <div className={`connector-action-plan ${plan.ok ? 'ready' : 'needs-input'}`}>
                                      <span>{plan.approvalReason}</span>
                                      {plan.missingInputs.length > 0 && <span>Missing: {plan.missingInputs.join(', ')}</span>}
                                      {plan.prerequisites.length > 0 && <span>{plan.prerequisites.join(' ')}</span>}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                  )
                })}
              </div>
            </>
          )}

          {loading && !snapshot && !error && (
            <p className="panel-hint">Reading connector registry...</p>
          )}
        </div>
      </div>
    </div>
  )
}