import { useState } from 'react'
import { Brain, CheckCircle2, ChevronDown, ChevronRight, FileText, Globe, HelpCircle, Loader, Search, Terminal } from 'lucide-react'
import type { AgentEvent, ToolCallEvent, ToolResultEvent } from '../types'

const API_BASE: string = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:8787' : '')

/** Extract an image URL or file path from a tool result string */
function extractImageFromResult(result: string): string | null {
  // Direct image URLs (Pollinations, etc.)
  const urlMatch = result.match(/https?:\/\/\S+\.(png|jpg|jpeg|gif|webp|svg)/i)
  if (urlMatch) return urlMatch[0]
  // Windows absolute paths
  const winPath = result.match(/([A-Za-z]:\\[^"'\n<>|*?]+\.(png|jpg|jpeg|gif|webp|bmp))/i)
  if (winPath) return `${API_BASE}/api/local-file?path=${encodeURIComponent(winPath[1])}`
  // Unix absolute paths
  const unixPath = result.match(/(\/[^\s"'<>|*?\n]+\.(png|jpg|jpeg|gif|webp|bmp))/i)
  if (unixPath) return `${API_BASE}/api/local-file?path=${encodeURIComponent(unixPath[1])}`
  return null
}

const IMAGE_PRODUCING_TOOLS = new Set([
  'generate_image', 'take_screenshot', 'browser_screenshot',
  'screen_read', 'analyze_image', 'record_screen',
])

const TOOL_ICON: Record<string, React.ReactNode> = {
  run_terminal: <Terminal size={13} />,
  sys_run: <Terminal size={13} />,
  run_code: <Terminal size={13} />,
  lint_code: <Terminal size={13} />,
  python_exec: <Terminal size={13} />,
  write_file: <FileText size={13} />,
  read_file: <FileText size={13} />,
  file_write: <FileText size={13} />,
  file_read: <FileText size={13} />,
  list_directory: <FileText size={13} />,
  file_list: <FileText size={13} />,
  open_in_editor: <FileText size={13} />,
  open_browser: <Globe size={13} />,
  fetch_webpage: <Globe size={13} />,
  browser_go: <Globe size={13} />,
  browser_click: <Globe size={13} />,
  browser_fill: <Globe size={13} />,
  browser_read: <Globe size={13} />,
  browser_screenshot: <Globe size={13} />,
  browser_eval: <Globe size={13} />,
  browser_wait: <Globe size={13} />,
  browser_select: <Globe size={13} />,
  browser_close: <Globe size={13} />,
  browser_type: <Globe size={13} />,
  search_web: <Search size={13} />,
  rag_search: <Search size={13} />,
  code_search: <Search size={13} />,
  mem_recall: <Search size={13} />,
}

const TOOL_LABEL: Record<string, string> = {
  run_terminal: 'Terminal',
  sys_run: 'Run command',
  run_code: 'Run code',
  lint_code: 'Lint / type-check',
  python_exec: 'Python REPL',
  write_file: 'Write file',
  read_file: 'Read file',
  file_write: 'Write file',
  file_read: 'Read file',
  list_directory: 'List directory',
  file_list: 'List directory',
  open_browser: 'Open browser',
  fetch_webpage: 'Fetch page',
  search_web: 'Web search',
  rag_search: 'Knowledge base search',
  code_search: 'Search codebase',
  mem_recall: 'Recall memory',
  browser_go: 'Browser navigate',
  browser_click: 'Browser click',
  browser_fill: 'Browser fill',
  browser_read: 'Browser read page',
  browser_screenshot: 'Browser screenshot',
  browser_eval: 'Browser eval JS',
  browser_wait: 'Browser wait',
  browser_select: 'Browser select',
  browser_close: 'Browser close',
  browser_type: 'Browser type',
  open_in_editor: 'Open in VS Code',
}

export function AgentTrace({ events }: { events: AgentEvent[] }) {
  if (events.length === 0) return null

  const resultById = new Map<string, ToolResultEvent>()
  for (const e of events) {
    if (e.type === 'tool_result') resultById.set(e.id, e)
  }

  return (
    <div className="agent-trace">
      {events.map((event, i) => {
        if (event.type === 'agent_step') {
          return (
            <div key={i} className="agent-step-header">
              <Loader size={11} className="spin" />
              <span>Step {event.step}</span>
            </div>
          )
        }

        if (event.type === 'agent_plan') {
          return <PlanBlock key={i} plan={event.plan} />
        }

        if (event.type === 'agent_task_state') {
          return <TaskStateBlock key={i} status={event.status} detail={event.detail} />
        }

        if (event.type === 'stream_status') {
          return <StreamStatusBlock key={i} event={event} />
        }

        if (event.type === 'thinking') {
          return <ThinkingBlock key={i} content={event.content} />
        }

        if (event.type === 'tool_call') {
          const result = resultById.get(event.id)
          return <ToolBlock key={i} call={event} result={result} />
        }

        if (event.type === 'user_question') {
          return (
            <div key={i} className="agent-question-trace">
              <HelpCircle size={12} />
              <span>Asked you: {event.question}</span>
            </div>
          )
        }

        // tool_result is rendered inside ToolBlock — skip standalone
        return null
      })}
    </div>
  )
}

function PlanBlock({ plan }: { plan: Extract<AgentEvent, { type: 'agent_plan' }>['plan'] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="agent-plan-block">
      <button className="agent-plan-header" onClick={() => setOpen(o => !o)} type="button" aria-expanded={open}>
        <Brain size={12} />
        <span>Task plan</span>
        <span className="agent-plan-meta">{plan.taskSize} · {plan.toolBudget} tools</span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {open && (
        <div className="agent-plan-body">
          <p><strong>Goal:</strong> {plan.goal}</p>
          <p><strong>Tools:</strong> {plan.toolsNeeded.join(', ')}</p>
          <p><strong>Verify:</strong> {plan.verificationMethod}</p>
          <p><strong>Done:</strong> {plan.doneCondition}</p>
          <ol>
            {plan.steps.map(step => <li key={step}>{step}</li>)}
          </ol>
        </div>
      )}
    </div>
  )
}

function TaskStateBlock({ status, detail }: { status: Extract<AgentEvent, { type: 'agent_task_state' }>['status']; detail: string }) {
  const label = status.replaceAll('_', ' ')
  const Icon = status === 'done' ? CheckCircle2 : status === 'needs_user_input' ? HelpCircle : Loader
  return (
    <div className={`agent-task-state ${status}`}>
      <Icon size={12} className={status === 'done' || status === 'needs_user_input' ? undefined : 'spin'} />
      <span>{label}</span>
      <small>{detail}</small>
    </div>
  )
}

function StreamStatusBlock({ event }: { event: Extract<AgentEvent, { type: 'stream_status' }> }) {
  const label = event.status.replaceAll('_', ' ')
  const metric = event.firstTokenMs ?? event.totalMs ?? event.elapsedMs
  return (
    <div className={`agent-task-state stream-${event.status}`}>
      <Loader size={12} className={event.status === 'done' ? undefined : 'spin'} />
      <span>{label}</span>
      <small>{event.detail ?? (typeof metric === 'number' ? `${metric} ms` : 'Model stream status')}</small>
    </div>
  )
}

function ThinkingBlock({ content }: { content: string }) {
  const [open, setOpen] = useState(false)
  const lines = content.split('\n').filter(Boolean).length
  return (
    <div className="thinking-block">
      <button className="thinking-header" onClick={() => setOpen(o => !o)} type="button" aria-expanded={open}>
        <Brain size={12} className="thinking-icon" />
        <span>Reasoning</span>
        <span className="thinking-meta">{lines} line{lines !== 1 ? 's' : ''}</span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {open && <pre className="thinking-body">{content}</pre>}
    </div>
  )
}

function ToolBlock({ call, result }: { call: ToolCallEvent; result?: ToolResultEvent }) {
  const [open, setOpen] = useState(false)
  const hasResult = Boolean(result)
  const label = TOOL_LABEL[call.name] ?? call.name
  const icon = TOOL_ICON[call.name] ?? <Terminal size={13} />
  const argsText = JSON.stringify(call.args, null, 2)
  const resultText = result?.result ?? ''
  const isLong = resultText.length > 320

  // Show inline image for image-producing tools
  const imageUrl = hasResult && IMAGE_PRODUCING_TOOLS.has(call.name)
    ? extractImageFromResult(resultText)
    : null

  return (
    <div className={`tool-block ${hasResult ? 'done' : 'pending'}`}>
      <button
        className="tool-block-header"
        onClick={() => setOpen((o) => !o)}
        type="button"
        aria-expanded={open}
      >
        <span className="tool-icon">{icon}</span>
        <span className="tool-name">{label}</span>
        <span className="tool-status">{hasResult ? '✓' : <Loader size={11} className="spin" />}</span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>

      {/* Inline image preview for screenshot/image tools — always visible */}
      {imageUrl && (
        <div className="tool-image-wrap">
          <img
            src={imageUrl}
            alt={`${label} output`}
            className="tool-image"
            loading="lazy"
          />
        </div>
      )}

      {open && (
        <div className="tool-body">
          <div className="tool-section">
            <p className="tool-section-label">Input</p>
            <pre className="tool-pre">{argsText}</pre>
          </div>
          {hasResult && (
            <div className="tool-section">
              <p className="tool-section-label">Output</p>
              <pre className={`tool-pre ${isLong ? 'scrollable' : ''}`}>{resultText}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
