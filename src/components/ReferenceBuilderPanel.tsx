import { useState } from 'react'
import { Camera, Clipboard, FolderOpen, Loader, ScanSearch, X } from 'lucide-react'

type ReferenceBlueprint = {
  ok: boolean
  sourceType: 'url' | 'screenshot' | 'url+screenshot'
  summary: string
  blueprint: string
  sourceFacts: {
    title?: string
    headings: string[]
    navigation: string[]
    callsToAction: string[]
    forms: string[]
    colors: string[]
    screenshotSummary?: string
  }
  suggestedProject: {
    name: string
    template: 'vanilla-ts' | 'react-vite'
    buildPrompt: string
  }
  guardrails: string[]
}

type ReferenceBuildResult = {
  ok: boolean
  reference: ReferenceBlueprint
  visualCompare?: {
    ok: boolean
    report: string
    referenceScreenshot?: string
    generatedScreenshot?: string
  }
  project: {
    projectName: string
    projectPath: string
    filesWritten: string[]
    logs: string[]
    nextCommands: string[]
  }
}

interface Props {
  apiBase: string
  onUsePrompt: (prompt: string) => void
  onClose: () => void
}

export function ReferenceBuilderPanel({ apiBase, onUsePrompt, onClose }: Props) {
  const [url, setUrl] = useState('')
  const [goal, setGoal] = useState('')
  const [projectName, setProjectName] = useState('reference-site')
  const [basePath, setBasePath] = useState('~/Ultron Projects')
  const [imageBase64, setImageBase64] = useState('')
  const [imageName, setImageName] = useState('')
  const [approved, setApproved] = useState(false)
  const [visualCompare, setVisualCompare] = useState(true)
  const [loading, setLoading] = useState(false)
  const [building, setBuilding] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ReferenceBlueprint | null>(null)
  const [buildResult, setBuildResult] = useState<ReferenceBuildResult | null>(null)

  function loadImage(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Choose a screenshot image file.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setImageBase64(String(reader.result ?? ''))
      setImageName(file.name)
    }
    reader.onerror = () => setError('Could not read screenshot file.')
    reader.readAsDataURL(file)
  }

  async function scanReference() {
    if ((!url.trim() && !imageBase64) || !approved || loading) return
    setLoading(true)
    setError('')
    setResult(null)
    setBuildResult(null)
    try {
      const response = await fetch(`${apiBase}/api/reference-builder/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() || undefined, imageBase64: imageBase64 || undefined, goal, approved }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error((data as { error?: string }).error ?? `Reference scan failed (${response.status})`)
      const blueprint = data as ReferenceBlueprint
      setResult(blueprint)
      setProjectName(current => current === 'reference-site' ? blueprint.suggestedProject.name : current)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reference scan failed')
    } finally {
      setLoading(false)
    }
  }

  async function learnAndBuild() {
    if ((!url.trim() && !imageBase64) || !approved || building) return
    setBuilding(true)
    setError('')
    setResult(null)
    setBuildResult(null)
    try {
      const response = await fetch(`${apiBase}/api/reference-builder/build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url.trim() || undefined,
          imageBase64: imageBase64 || undefined,
          goal,
          projectName,
          basePath,
          approved,
          runBuild: true,
          visualCompare,
          openVsCode: false,
          openExplorer: false,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error((data as { error?: string }).error ?? `Reference build failed (${response.status})`)
      const built = data as ReferenceBuildResult
      setResult(built.reference)
      setBuildResult(built)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reference build failed')
    } finally {
      setBuilding(false)
    }
  }

  function usePrompt() {
    if (!result) return
    onUsePrompt(result.suggestedProject.buildPrompt)
    onClose()
  }

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel-drawer panel-right panel-wide reference-builder-panel" onClick={event => event.stopPropagation()}>
        <div className="panel-header">
          <div className="panel-title">
            <ScanSearch size={16} />
            <span>Reference Builder</span>
          </div>
          <button className="icon-button" onClick={onClose} type="button" aria-label="Close reference builder">
            <X size={18} />
          </button>
        </div>

        <div className="panel-body project-builder-body">
          <section className="project-builder-hero reference-builder-hero">
            <div>
              <span className="settings-section-title">Website Learner</span>
              <h3>Scan, understand, blueprint</h3>
              <p>Use a public URL or screenshot as a reference, then generate an original build plan Ultron can turn into a project.</p>
            </div>
            <Camera size={34} />
          </section>

          {error && <div className="project-builder-error">{error}</div>}

          <label className="project-builder-field">
            <span>Public reference URL</span>
            <input value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.com" />
          </label>

          <label className="project-builder-field">
            <span>What should Ultron build?</span>
            <input value={goal} onChange={event => setGoal(event.target.value)} placeholder="vehicle history report website, SaaS dashboard, booking site..." />
          </label>

          <div className="project-builder-grid">
            <label className="project-builder-field">
              <span>Project name</span>
              <input value={projectName} onChange={event => setProjectName(event.target.value)} placeholder="reference-site" />
            </label>
            <label className="project-builder-field">
              <span>Destination folder</span>
              <input value={basePath} onChange={event => setBasePath(event.target.value)} placeholder="~/Ultron Projects" />
            </label>
          </div>

          <label className="reference-upload">
            <input type="file" accept="image/*" onChange={event => loadImage(event.target.files?.[0])} />
            <Camera size={15} />
            <span>{imageName || 'Add screenshot reference'}</span>
          </label>

          <label className="project-builder-approval">
            <input type="checkbox" checked={approved} onChange={event => setApproved(event.target.checked)} />
            <span>I approve Ultron scanning this public reference/screenshot and creating an original blueprint, without copying protected brand assets or exact content.</span>
          </label>

          <label className="reference-compare-toggle">
            <input type="checkbox" checked={visualCompare} onChange={event => setVisualCompare(event.target.checked)} />
            <span>Run visual compare after build and save a QA report with screenshots.</span>
          </label>

          <button type="button" className="project-builder-run" onClick={() => void scanReference()} disabled={!approved || loading || building || (!url.trim() && !imageBase64)}>
            {loading ? <Loader size={15} className="spin" /> : <ScanSearch size={15} />}
            {loading ? 'Learning reference...' : 'Learn Reference'}
          </button>

          <button type="button" className="project-builder-run reference-build-run" onClick={() => void learnAndBuild()} disabled={!approved || loading || building || (!url.trim() && !imageBase64)}>
            {building ? <Loader size={15} className="spin" /> : <FolderOpen size={15} />}
            {building ? 'Learning and building...' : 'Learn + Build'}
          </button>

          {result && (
            <section className="reference-result">
              <div className="project-builder-result-head">
                <ScanSearch size={16} />
                <div>
                  <strong>{result.summary}</strong>
                  <span>{result.sourceType} · suggested project: {result.suggestedProject.name}</span>
                </div>
              </div>

              <div className="reference-facts">
                {result.sourceFacts.headings.slice(0, 5).map(item => <span key={item}>{item}</span>)}
                {result.sourceFacts.forms.slice(0, 4).map(item => <span key={item}>Form: {item}</span>)}
                {result.sourceFacts.callsToAction.slice(0, 4).map(item => <span key={item}>Action: {item}</span>)}
              </div>

              <pre>{result.blueprint}</pre>

              <div className="project-builder-actions">
                <button type="button" onClick={usePrompt}><Clipboard size={13} /> Use As Build Prompt</button>
              </div>
            </section>
          )}

          {buildResult && (
            <section className="project-builder-result">
              <div className="project-builder-result-head">
                <FolderOpen size={16} />
                <div>
                  <strong>{buildResult.project.projectName}</strong>
                  <span>{buildResult.project.projectPath}</span>
                </div>
              </div>
              <div className="project-builder-columns">
                <div>
                  <strong>Files</strong>
                  {buildResult.project.filesWritten.map(file => <span key={file}>{file}</span>)}
                </div>
                <div>
                  <strong>Next commands</strong>
                  {buildResult.project.nextCommands.map(command => <span key={command}>{command}</span>)}
                </div>
              </div>
              {buildResult.visualCompare && (
                <div className={`reference-compare-result ${buildResult.visualCompare.ok ? 'ok' : 'warn'}`}>
                  <div>
                    <strong>{buildResult.visualCompare.ok ? 'Visual compare saved' : 'Visual compare needs attention'}</strong>
                    <span>Report: VISUAL_COMPARE.md</span>
                  </div>
                  {(buildResult.visualCompare.referenceScreenshot || buildResult.visualCompare.generatedScreenshot) && (
                    <div className="reference-compare-files">
                      {buildResult.visualCompare.referenceScreenshot && <span>Reference: {buildResult.visualCompare.referenceScreenshot}</span>}
                      {buildResult.visualCompare.generatedScreenshot && <span>Generated: {buildResult.visualCompare.generatedScreenshot}</span>}
                    </div>
                  )}
                  <pre>{buildResult.visualCompare.report}</pre>
                </div>
              )}
              <pre>{buildResult.project.logs.join('\n\n')}</pre>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
