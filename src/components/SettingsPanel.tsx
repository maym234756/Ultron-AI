import { X, SlidersHorizontal } from 'lucide-react'
import type { AppSettings, IntelligenceMode } from '../types'

const API_BASE = import.meta.env.DEV ? 'http://localhost:8787' : ''

const INTELLIGENCE_MODES: Array<{ value: IntelligenceMode; label: string; hint: string }> = [
  { value: 'instant', label: 'Instant', hint: 'Short answers, fast-model routing, minimal context overhead.' },
  { value: 'balanced', label: 'Balanced', hint: 'Good default for normal chat and coding questions.' },
  { value: 'deep', label: 'Deep', hint: 'More deliberate reasoning, larger context, stronger verification.' },
  { value: 'research', label: 'Research', hint: 'Synthesis mode for comparisons, uncertainty, and source-backed answers.' },
]

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
    localStorage.setItem('astra-settings', JSON.stringify(next))
  }

  async function toggleObserver(enabled: boolean, mode?: 'fast' | 'deep', intervalSec?: number) {
    set('observationEnabled', enabled)
    await fetch(`${API_BASE}/api/observer/toggle`, {
      method: 'POST',
      credentials: 'include',
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
                <p className="settings-hint">Astra silently watches your screen and open windows, giving it context without you having to explain what's open.</p>
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

          <div className="settings-field">
            <div className="settings-toggle-row">
              <div>
                <span className="settings-label">Auto route Chat / Agent</span>
                <p className="settings-hint">Astra decides whether a prompt needs tools, browser, files, connectors, or a normal chat answer.</p>
              </div>
              <button
                type="button"
                className={`toggle-button ${settings.autoRoute ? 'toggle-on' : ''}`}
                onClick={() => set('autoRoute', !settings.autoRoute)}
                aria-label="Toggle auto route"
              >
                {settings.autoRoute ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>

          <div className="settings-field">
            <div className="settings-toggle-row">
              <div>
                <span className="settings-label">Auto intelligence profile</span>
                <p className="settings-hint">Astra chooses Instant, Balanced, Deep, or Research based on prompt complexity and freshness needs.</p>
              </div>
              <button
                type="button"
                className={`toggle-button ${settings.autoIntelligence ? 'toggle-on' : ''}`}
                onClick={() => set('autoIntelligence', !settings.autoIntelligence)}
                aria-label="Toggle auto intelligence profile"
              >
                {settings.autoIntelligence ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>

          <div className="settings-field">
            <span className="settings-label">Intelligence profile <em>{settings.intelligenceMode}</em></span>
            <div className="intelligence-grid">
              {INTELLIGENCE_MODES.map(mode => (
                <button
                  key={mode.value}
                  type="button"
                  className={`intelligence-option ${settings.intelligenceMode === mode.value ? 'selected' : ''}`}
                  onClick={() => set('intelligenceMode', mode.value)}
                  disabled={settings.autoIntelligence}
                >
                  <strong>{mode.label}</strong>
                  <span>{mode.hint}</span>
                </button>
              ))}
            </div>
          </div>

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
            <span className="settings-hint">Injected into every message. Helps Astra give more relevant answers without you explaining your context each time.</span>
          </label>

          <div className="settings-divider" />

          {/* ── System prompt ── */}
          <div className="settings-section-title">System Prompt</div>

          <label className="settings-field">
            <textarea
              rows={5}
              value={settings.systemPrompt}
              onChange={(e) => set('systemPrompt', e.target.value)}
              placeholder="Extra instructions appended to Astra's system prompt…"
              className="settings-textarea"
            />
          </label>

          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              const defaults: AppSettings = {
                temperature: 0.35, maxIterations: 20, systemPrompt: '', fastModel: '',
                intelligenceMode: 'balanced', autoRoute: true, autoIntelligence: true,
                observationEnabled: false, observationMode: 'fast', observationIntervalSec: 60,
                domainExpertise: '', numCtx: 8192, answerStyle: 'detailed',
              }
              onChange(defaults)
              localStorage.removeItem('astra-settings')
            }}
          >
            Reset to defaults
          </button>
        </div>
      </div>
    </div>
  )
}
