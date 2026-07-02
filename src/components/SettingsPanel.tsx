import { X, SlidersHorizontal } from 'lucide-react'
import type { AppSettings } from '../types'

const API_BASE = import.meta.env.DEV ? 'http://localhost:8787' : ''

interface Props {
  settings: AppSettings
  onChange: (s: AppSettings) => void
  onClose: () => void
  models: string[]
}

export function SettingsPanel({ settings, onChange, onClose, models }: Props) {
  function set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    const next = { ...settings, [key]: value }
    onChange(next)
    localStorage.setItem('ultron-settings', JSON.stringify(next))
  }

  async function toggleObserver(enabled: boolean, mode?: 'fast' | 'deep', intervalSec?: number) {
    set('observationEnabled', enabled)
    await fetch(`${API_BASE}/api/observer/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled,
        mode: mode ?? settings.observationMode,
        intervalSec: intervalSec ?? settings.observationIntervalSec,
      }),
    }).catch(() => {})
  }

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel-drawer panel-right" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <div className="panel-title">
            <SlidersHorizontal size={16} />
            <span>Settings</span>
          </div>
          <button className="icon-button" onClick={onClose} type="button" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="panel-body settings-body">

          {/* ── Ambient Awareness ── */}
          <div className="settings-section-title">Ambient Screen Awareness</div>

          <div className="settings-field">
            <div className="settings-toggle-row">
              <div>
                <span className="settings-label">Passive observation</span>
                <p className="settings-hint">Ultron silently watches your screen and open windows, giving it context without you having to explain what's open.</p>
              </div>
              <button
                type="button"
                className={`toggle-button ${settings.observationEnabled ? 'toggle-on' : ''}`}
                onClick={() => toggleObserver(!settings.observationEnabled)}
                aria-label="Toggle observation"
              >
                {settings.observationEnabled ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>

          {settings.observationEnabled && (
            <>
              <div className="settings-field">
                <span className="settings-label">Mode</span>
                <div className="settings-radio-group">
                  <label>
                    <input type="radio" name="obsMode" value="fast"
                      checked={settings.observationMode === 'fast'}
                      onChange={() => { set('observationMode', 'fast'); toggleObserver(true, 'fast') }} />
                    {' '}Fast <em>(window titles only, instant)</em>
                  </label>
                  <label>
                    <input type="radio" name="obsMode" value="deep"
                      checked={settings.observationMode === 'deep'}
                      onChange={() => { set('observationMode', 'deep'); toggleObserver(true, 'deep') }} />
                    {' '}Deep <em>(+ screenshot + vision AI, ~10s)</em>
                  </label>
                </div>
              </div>

              <label className="settings-field">
                <span className="settings-label">Capture interval <em>{settings.observationIntervalSec}s</em></span>
                <input
                  type="range" min="15" max="300" step="15"
                  value={settings.observationIntervalSec}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10)
                    set('observationIntervalSec', v)
                    toggleObserver(true, settings.observationMode, v)
                  }}
                />
                <span className="settings-hint">How often to refresh screen awareness.</span>
              </label>
            </>
          )}

          <div className="settings-divider" />

          {/* ── Model ── */}
          <div className="settings-section-title">Model</div>

          <label className="settings-field">
            <span className="settings-label">Temperature <em>{settings.temperature.toFixed(2)}</em></span>
            <input
              type="range" min="0" max="1.5" step="0.05"
              value={settings.temperature}
              onChange={(e) => set('temperature', parseFloat(e.target.value))}
            />
            <span className="settings-hint">Lower = more focused. Higher = more creative.</span>
          </label>

          <label className="settings-field">
            <span className="settings-label">Context window <em>{(settings.numCtx ?? 8192).toLocaleString()} tokens</em></span>
            <input
              type="range" min="2048" max="32768" step="512"
              value={settings.numCtx ?? 8192}
              onChange={(e) => set('numCtx', parseInt(e.target.value, 10))}
            />
            <span className="settings-hint">Larger = remembers more of the conversation, but slower first-token on small GPUs. 8192 is a good default.</span>
          </label>

          <label className="settings-field">
            <span className="settings-label">Max iterations <em>{settings.maxIterations}</em></span>
            <input
              type="range" min="1" max="30" step="1"
              value={settings.maxIterations}
              onChange={(e) => set('maxIterations', parseInt(e.target.value, 10))}
            />
            <span className="settings-hint">Max tool-use steps per agent task.</span>
          </label>

          {models.length > 0 && (
            <div className="settings-field">
              <span className="settings-label">Available models</span>
              <p className="settings-hint">{models.join(', ')}</p>
            </div>
          )}

          <label className="settings-field">
            <span className="settings-label">Fast model <em>(optional)</em></span>
            <input
              type="text"
              value={settings.fastModel}
              onChange={(e) => set('fastModel', e.target.value)}
              placeholder="e.g. llama3.2:3b"
              className="settings-input"
            />
            <span className="settings-hint">Auto-used for short, simple queries.</span>
          </label>

          <div className="settings-divider" />

          {/* ── Domain Expertise ── */}
          <div className="settings-section-title">Domain Expertise</div>

          <label className="settings-field">
            <span className="settings-label">Who you are / what you work on</span>
            <textarea
              rows={3}
              value={settings.domainExpertise ?? ''}
              onChange={(e) => set('domainExpertise', e.target.value)}
              placeholder="e.g. I'm a TypeScript developer building React apps. I use Python for data scripts. I prefer concise answers with code examples."
              className="settings-textarea"
            />
            <span className="settings-hint">Injected into every message. Helps Ultron give more relevant answers without you explaining your context each time.</span>
          </label>

          <div className="settings-divider" />

          {/* ── System prompt ── */}
          <div className="settings-section-title">System Prompt</div>

          <label className="settings-field">
            <textarea
              rows={5}
              value={settings.systemPrompt}
              onChange={(e) => set('systemPrompt', e.target.value)}
              placeholder="Extra instructions appended to Ultron's system prompt…"
              className="settings-textarea"
            />
          </label>

          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              const defaults: AppSettings = {
                temperature: 0.35, maxIterations: 20, systemPrompt: '', fastModel: '',
                observationEnabled: false, observationMode: 'fast', observationIntervalSec: 60,
                domainExpertise: '', numCtx: 8192,
              }
              onChange(defaults)
              localStorage.removeItem('ultron-settings')
            }}
          >
            Reset to defaults
          </button>
        </div>
      </div>
    </div>
  )
}
