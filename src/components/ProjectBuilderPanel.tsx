import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Code2, ExternalLink, FileText, FolderOpen, Loader, Play, RefreshCw, Terminal, X } from 'lucide-react'

type ProjectTemplate = {
  id: string
  label: string
  description: string
  stack: string
  installCommand?: string
  buildCommand?: string
  devCommand?: string
}

type ProjectBuildResult = {
  ok: boolean
  projectName: string
  projectPath: string
  template: ProjectTemplate
  filesWritten: string[]
  logs: string[]
  nextCommands: string[]
}

type ProjectAction = 'openExplorer' | 'openVsCode' | 'openTerminal' | 'openProjectPlan' | 'runInstall' | 'runBuild' | 'runDevServer' | 'stopDevServer' | 'runRepair' | 'runSmartNextStep' | 'runPreviewAudit'

type ProjectMissionStatus = {
  dependencyStatus: 'not_needed' | 'ready' | 'missing' | 'unknown'
  checkStatus: 'passed' | 'failed' | 'needs_attention' | 'unknown'
  devServerStatus: 'running' | 'stopped' | 'not_configured'
  suggestedAction: ProjectAction | null
  suggestedLabel: string
  suggestedReason: string
  blockers: string[]
}

type ProjectRecord = {
  id: string
  projectName: string
  projectPath: string
  templateLabel: string
  stack: string
  installCommand?: string
  buildCommand?: string
  devCommand?: string
  previewUrl?: string
  updatedAt: number
  lastBuildStatus?: string
  lastPreviewStatus?: string
  lastPreviewScreenshot?: string
  lastAction?: string
  lastLog?: string
  mission?: ProjectMissionStatus
}

type ProjectActionResult = {
  record: ProjectRecord
  output: string
}

type ToolchainStatus = {
  checkedAt: number
  ready: boolean
  tools: Array<{
    id: string
    label: string
    ok: boolean
    command: string
    version: string
    installHint: string
  }>
}

interface Props {
  apiBase: string
  onClose: () => void
}

export function ProjectBuilderPanel({ apiBase, onClose }: Props) {
  const [templates, setTemplates] = useState<ProjectTemplate[]>([])
  const [templateId, setTemplateId] = useState('vanilla-ts')
  const [name, setName] = useState('my-astra-app')
  const [basePath, setBasePath] = useState('~')
  const [approved, setApproved] = useState(false)
  const [runInstall, setRunInstall] = useState(false)
  const [runBuild, setRunBuild] = useState(true)
  const [openVsCode, setOpenVsCode] = useState(true)
  const [openExplorer, setOpenExplorer] = useState(true)
  const [loading, setLoading] = useState(true)
  const [building, setBuilding] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ProjectBuildResult | null>(null)
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [actionBusy, setActionBusy] = useState('')
  const [actionOutput, setActionOutput] = useState('')
  const [toolchain, setToolchain] = useState<ToolchainStatus | null>(null)
  const [toolchainLoading, setToolchainLoading] = useState(false)
  const [selectingFolder, setSelectingFolder] = useState(false)

  async function loadTemplates() {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`${apiBase}/api/project-builder/templates`)
      if (!response.ok) throw new Error(`Template load failed (${response.status})`)
      const data = await response.json() as { templates: ProjectTemplate[] }
      setTemplates(data.templates ?? [])
      if (data.templates?.[0]) setTemplateId(current => current || data.templates[0].id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load templates')
    } finally {
      setLoading(false)
    }
  }

  async function loadProjects() {
    setProjectsLoading(true)
    try {
      const response = await fetch(`${apiBase}/api/project-builder/projects`, { credentials: 'include' })
      if (!response.ok) throw new Error(`Project memory load failed (${response.status})`)
      const data = await response.json() as { projects: ProjectRecord[] }
      setProjects(data.projects ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load project memory')
    } finally {
      setProjectsLoading(false)
    }
  }

  async function loadToolchain() {
    setToolchainLoading(true)
    try {
      const response = await fetch(`${apiBase}/api/project-builder/toolchain`)
      if (!response.ok) throw new Error(`Toolchain check failed (${response.status})`)
      setToolchain(await response.json() as ToolchainStatus)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check coding toolchain')
    } finally {
      setToolchainLoading(false)
    }
  }

  function refreshAll() {
    setError('')
    void loadTemplates()
    void loadProjects()
    void loadToolchain()
  }

  useEffect(() => { refreshAll() }, [apiBase]) // eslint-disable-line react-hooks/exhaustive-deps

  const selected = templates.find(template => template.id === templateId)
  const projectFolderName = name.trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.\s-]+|[.\s-]+$/g, '') || 'Astra-Project'
  const displayBasePath = basePath.trim() === '~' ? 'your user folder' : basePath.trim().replace(/[\\/]$/, '')
  const destinationPreview = `${displayBasePath}\\${projectFolderName}`

  function statusLabel(value: string) {
    return value.replace(/_/g, ' ')
  }

  async function buildProject() {
    if (!name.trim() || !approved || building) return
    setBuilding(true)
    setError('')
    setResult(null)
    try {
      const response = await fetch(`${apiBase}/api/project-builder/build`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          template: templateId,
          basePath,
          approved,
          runInstall,
          runBuild,
          openVsCode,
          openExplorer,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error((data as { error?: string }).error ?? `Build failed (${response.status})`)
      setResult(data as ProjectBuildResult)
      await loadProjects()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Project build failed')
    } finally {
      setBuilding(false)
    }
  }

  async function chooseDestinationFolder() {
    if (selectingFolder || building) return
    setSelectingFolder(true)
    setError('')
    try {
      const response = await fetch(`${apiBase}/api/project-builder/select-folder`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ basePath }),
      })
      const data = await response.json() as { cancelled?: boolean; path?: string; error?: string }
      if (!response.ok) throw new Error(data.error ?? `Folder picker failed (${response.status})`)
      if (!data.cancelled && data.path) setBasePath(data.path)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not choose destination folder')
    } finally {
      setSelectingFolder(false)
    }
  }

  async function runProjectAction(project: ProjectRecord, action: ProjectAction) {
    const key = `${project.id}:${action}`
    if (actionBusy) return
    setActionBusy(key)
    setActionOutput('')
    setError('')
    try {
      const response = await fetch(`${apiBase}/api/project-builder/projects/${encodeURIComponent(project.id)}/actions`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, approved: true }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error((data as { error?: string }).error ?? `Project action failed (${response.status})`)
      const actionResult = data as ProjectActionResult
      setActionOutput(`${actionResult.record.projectName}: ${actionResult.record.lastAction ?? 'Action complete.'}\n\n${actionResult.output}`)
      await loadProjects()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Project action failed')
    } finally {
      setActionBusy('')
    }
  }

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel-drawer panel-right panel-wide project-builder-panel" onClick={event => event.stopPropagation()}>
        <div className="panel-header">
          <div className="panel-title">
            <Code2 size={16} />
            <span>Project Builder</span>
          </div>
          <div className="panel-header-actions">
            <button type="button" className="sidebar-action-btn" onClick={refreshAll} disabled={loading || building || Boolean(actionBusy)}>
              {loading ? <Loader size={13} className="spin" /> : <RefreshCw size={13} />}
              Refresh
            </button>
            <button className="icon-button" onClick={onClose} type="button" aria-label="Close project builder">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="panel-body project-builder-body">
          <section className="project-builder-hero">
            <div>
              <span className="settings-section-title">Build Workflow</span>
              <h3>Template, create, validate, open</h3>
              <p>Generate a programming project with repeatable scaffolds, check the local toolchain, then run validation and open the tools you approve.</p>
            </div>
            <Terminal size={34} />
          </section>

          <section className={`project-toolchain ${toolchain?.ready ? 'ready' : 'needs-attention'}`}>
            <div className="project-builder-section-head">
              <span className="settings-section-title">Coding Readiness</span>
              {toolchainLoading ? <Loader size={13} className="spin" /> : toolchain?.ready ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
            </div>
            {!toolchain && !toolchainLoading && <p className="panel-hint">Refresh to check local coding tools.</p>}
            {toolchain && (
              <div className="project-toolchain-grid">
                {toolchain.tools.map(tool => (
                  <div className={`project-toolchain-item ${tool.ok ? 'ok' : 'missing'}`} key={tool.id}>
                    <strong>{tool.label}</strong>
                    <span>{tool.ok ? tool.version : tool.installHint}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {error && <div className="project-builder-error">{error}</div>}

          <div className="project-builder-grid">
            <label className="project-builder-field">
              <span>Project name</span>
              <input value={name} onChange={event => setName(event.target.value)} placeholder="my-astra-app" />
            </label>
            <label className="project-builder-field project-builder-destination-field">
              <span>Parent destination folder</span>
              <div className="project-builder-path-row">
                <input value={basePath} onChange={event => setBasePath(event.target.value)} placeholder="~" />
                <button type="button" onClick={() => void chooseDestinationFolder()} disabled={selectingFolder || building}>
                  {selectingFolder ? <Loader size={13} className="spin" /> : <FolderOpen size={13} />}
                  Choose
                </button>
              </div>
              <small>Astra will create: {destinationPreview}</small>
            </label>
          </div>

          <section className="project-template-list">
            <span className="settings-section-title">Templates</span>
            {loading && <p className="panel-hint">Loading project templates...</p>}
            {!loading && templates.map(template => (
              <button
                key={template.id}
                type="button"
                className={`project-template-card ${template.id === templateId ? 'active' : ''}`}
                onClick={() => setTemplateId(template.id)}
              >
                <strong>{template.label}</strong>
                <span>{template.stack}</span>
                <p>{template.description}</p>
              </button>
            ))}
          </section>

          <section className="project-builder-options">
            <span className="settings-section-title">Actions</span>
            <label><input type="checkbox" checked={runInstall} onChange={event => setRunInstall(event.target.checked)} /> Run install when template needs dependencies</label>
            <label><input type="checkbox" checked={runBuild} onChange={event => setRunBuild(event.target.checked)} /> Run first build/check</label>
            <label><input type="checkbox" checked={openVsCode} onChange={event => setOpenVsCode(event.target.checked)} /> Open in Visual Studio Code</label>
            <label><input type="checkbox" checked={openExplorer} onChange={event => setOpenExplorer(event.target.checked)} /> Open folder in File Explorer</label>
          </section>

          <label className="project-builder-approval">
            <input type="checkbox" checked={approved} onChange={event => setApproved(event.target.checked)} />
            <span>I approve Astra creating files, running selected commands, and opening selected local tools for this project build.</span>
          </label>

          <button type="button" className="project-builder-run" onClick={() => void buildProject()} disabled={!approved || !name.trim() || building || loading}>
            {building ? <Loader size={15} className="spin" /> : <Play size={15} />}
            {building ? 'Building...' : 'Build Project'}
          </button>

          {selected && (
            <div className="project-builder-next">
              <strong>Selected workflow</strong>
              <span>{selected.installCommand ? `Install: ${selected.installCommand}` : 'Install: not required'}</span>
              <span>{selected.buildCommand ? `Build/check: ${selected.buildCommand}` : 'Build/check: not configured'}</span>
              <span>{selected.devCommand ? `Dev: ${selected.devCommand}` : 'Dev: not configured'}</span>
            </div>
          )}

          <section className="project-builder-projects">
            <div className="project-builder-section-head">
              <span className="settings-section-title">Project Memory</span>
              {projectsLoading && <Loader size={13} className="spin" />}
            </div>
            {!projectsLoading && projects.length === 0 && <p className="panel-hint">Built projects will appear here so Astra can open, check, and run them later.</p>}
            {projects.map(project => (
              <article className="project-memory-card" key={project.id}>
                <div className="project-memory-head">
                  <div>
                    <strong>{project.projectName}</strong>
                    <span>{project.projectPath}</span>
                  </div>
                  <span>{project.lastBuildStatus ?? 'Ready'}</span>
                </div>
                <div className="project-memory-meta">
                  <span>{project.templateLabel}</span>
                  <span>{project.stack}</span>
                  {project.lastPreviewStatus && <span>{project.lastPreviewStatus}</span>}
                  {project.lastPreviewScreenshot && <span>Screenshot: {project.lastPreviewScreenshot}</span>}
                  {project.lastAction && <span>{project.lastAction}</span>}
                </div>
                {project.mission && (
                  <div className="project-mission-card">
                    <div>
                      <strong>{project.mission.suggestedLabel}</strong>
                      <span>{project.mission.suggestedReason}</span>
                    </div>
                    <div className="project-mission-statuses">
                      <span>Deps: {statusLabel(project.mission.dependencyStatus)}</span>
                      <span>Check: {statusLabel(project.mission.checkStatus)}</span>
                      <span>Dev: {statusLabel(project.mission.devServerStatus)}</span>
                    </div>
                  </div>
                )}
                <div className="project-builder-actions">
                  <button type="button" className="project-next-action" onClick={() => void runProjectAction(project, 'runSmartNextStep')} disabled={Boolean(actionBusy) || !project.mission?.suggestedAction}><Play size={13} /> Next</button>
                  <button type="button" onClick={() => void runProjectAction(project, 'openExplorer')} disabled={Boolean(actionBusy)}><FolderOpen size={13} /> Folder</button>
                  <button type="button" onClick={() => void runProjectAction(project, 'openVsCode')} disabled={Boolean(actionBusy)}><Code2 size={13} /> Code</button>
                  <button type="button" onClick={() => void runProjectAction(project, 'openProjectPlan')} disabled={Boolean(actionBusy)}><FileText size={13} /> Plan</button>
                  <button type="button" onClick={() => void runProjectAction(project, 'openTerminal')} disabled={Boolean(actionBusy)}><Terminal size={13} /> Terminal</button>
                  <button type="button" onClick={() => void runProjectAction(project, 'runInstall')} disabled={Boolean(actionBusy) || !project.installCommand}><Terminal size={13} /> Install</button>
                  <button type="button" onClick={() => void runProjectAction(project, 'runBuild')} disabled={Boolean(actionBusy) || !project.buildCommand}><Terminal size={13} /> Check</button>
                  <button type="button" onClick={() => void runProjectAction(project, 'runRepair')} disabled={Boolean(actionBusy) || !project.buildCommand}><RefreshCw size={13} /> Fix</button>
                  <button type="button" onClick={() => void runProjectAction(project, 'runDevServer')} disabled={Boolean(actionBusy) || !project.devCommand}><Play size={13} /> Dev</button>
                  <button type="button" onClick={() => void runProjectAction(project, 'runPreviewAudit')} disabled={Boolean(actionBusy) || !project.previewUrl}><CheckCircle2 size={13} /> Audit</button>
                  <button type="button" onClick={() => void runProjectAction(project, 'stopDevServer')} disabled={Boolean(actionBusy) || !project.devCommand}>Stop</button>
                  {project.previewUrl && <a href={project.previewUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Preview</a>}
                </div>
              </article>
            ))}
            {actionOutput && <pre className="project-builder-action-log">{actionOutput}</pre>}
          </section>

          {result && (
            <section className="project-builder-result">
              <div className="project-builder-result-head">
                <FolderOpen size={16} />
                <div>
                  <strong>{result.projectName}</strong>
                  <span>{result.projectPath}</span>
                </div>
              </div>
              <div className="project-builder-columns">
                <div>
                  <strong>Files</strong>
                  {result.filesWritten.map(file => <span key={file}>{file}</span>)}
                </div>
                <div>
                  <strong>Next commands</strong>
                  {result.nextCommands.map(command => <span key={command}>{command}</span>)}
                </div>
              </div>
              <pre>{result.logs.join('\n\n')}</pre>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}