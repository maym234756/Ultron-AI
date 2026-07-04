import { useEffect, useState } from 'react'
import { Code2, ExternalLink, FolderOpen, Loader, Play, RefreshCw, Terminal, X } from 'lucide-react'

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

type ProjectAction = 'openExplorer' | 'openVsCode' | 'openTerminal' | 'runInstall' | 'runBuild' | 'runDevServer' | 'stopDevServer' | 'runRepair'

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
  lastAction?: string
  lastLog?: string
}

type ProjectActionResult = {
  record: ProjectRecord
  output: string
}

interface Props {
  apiBase: string
  onClose: () => void
}

export function ProjectBuilderPanel({ apiBase, onClose }: Props) {
  const [templates, setTemplates] = useState<ProjectTemplate[]>([])
  const [templateId, setTemplateId] = useState('vanilla-ts')
  const [name, setName] = useState('my-ultron-app')
  const [basePath, setBasePath] = useState('~/Ultron Projects')
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
      const response = await fetch(`${apiBase}/api/project-builder/projects`)
      if (!response.ok) throw new Error(`Project memory load failed (${response.status})`)
      const data = await response.json() as { projects: ProjectRecord[] }
      setProjects(data.projects ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load project memory')
    } finally {
      setProjectsLoading(false)
    }
  }

  function refreshAll() {
    void loadTemplates()
    void loadProjects()
  }

  useEffect(() => { refreshAll() }, [apiBase]) // eslint-disable-line react-hooks/exhaustive-deps

  const selected = templates.find(template => template.id === templateId)

  async function buildProject() {
    if (!name.trim() || !approved || building) return
    setBuilding(true)
    setError('')
    setResult(null)
    try {
      const response = await fetch(`${apiBase}/api/project-builder/build`, {
        method: 'POST',
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

  async function runProjectAction(project: ProjectRecord, action: ProjectAction) {
    const key = `${project.id}:${action}`
    if (actionBusy) return
    setActionBusy(key)
    setActionOutput('')
    setError('')
    try {
      const response = await fetch(`${apiBase}/api/project-builder/projects/${encodeURIComponent(project.id)}/actions`, {
        method: 'POST',
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
              <p>Generate a programming project with repeatable scaffolds, then run the first validation pass and open the workspace tools you approve.</p>
            </div>
            <Terminal size={34} />
          </section>

          {error && <div className="project-builder-error">{error}</div>}

          <div className="project-builder-grid">
            <label className="project-builder-field">
              <span>Project name</span>
              <input value={name} onChange={event => setName(event.target.value)} placeholder="my-ultron-app" />
            </label>
            <label className="project-builder-field">
              <span>Destination folder</span>
              <input value={basePath} onChange={event => setBasePath(event.target.value)} placeholder="~/Ultron Projects" />
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
            <span>I approve Ultron creating files, running selected commands, and opening selected local tools for this project build.</span>
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
            {!projectsLoading && projects.length === 0 && <p className="panel-hint">Built projects will appear here so Ultron can open, check, and run them later.</p>}
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
                  {project.lastAction && <span>{project.lastAction}</span>}
                </div>
                <div className="project-builder-actions">
                  <button type="button" onClick={() => void runProjectAction(project, 'openExplorer')} disabled={Boolean(actionBusy)}><FolderOpen size={13} /> Folder</button>
                  <button type="button" onClick={() => void runProjectAction(project, 'openVsCode')} disabled={Boolean(actionBusy)}><Code2 size={13} /> Code</button>
                  <button type="button" onClick={() => void runProjectAction(project, 'openTerminal')} disabled={Boolean(actionBusy)}><Terminal size={13} /> Terminal</button>
                  <button type="button" onClick={() => void runProjectAction(project, 'runInstall')} disabled={Boolean(actionBusy) || !project.installCommand}><Terminal size={13} /> Install</button>
                  <button type="button" onClick={() => void runProjectAction(project, 'runBuild')} disabled={Boolean(actionBusy) || !project.buildCommand}><Terminal size={13} /> Check</button>
                  <button type="button" onClick={() => void runProjectAction(project, 'runRepair')} disabled={Boolean(actionBusy) || !project.buildCommand}><RefreshCw size={13} /> Fix</button>
                  <button type="button" onClick={() => void runProjectAction(project, 'runDevServer')} disabled={Boolean(actionBusy) || !project.devCommand}><Play size={13} /> Dev</button>
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