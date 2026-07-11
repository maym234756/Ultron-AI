import { useDeferredValue, useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Bot,
  Brain,
  ChevronLeft,
  ChevronRight,
  Clock,
  Code2,
  Copy,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Activity,
  KeyRound,
  Loader,
  ListTodo,
  LogOut,
  PhoneCall,
  PhoneOff,
  Cpu,
  Scale,
  Wand2,
  Mic,
  MicOff,
  Moon,
  Paperclip,
  Pencil,
  RadioTower,
  RefreshCw,
  Search,
  Send,
  SlidersHorizontal,
  Square,
  Sun,
  ThumbsDown,
  ThumbsUp,
  BookOpen,
  UserRound,
  Volume2,
  VolumeX,
  X,
  Wrench,
  Zap,
} from 'lucide-react'
import { AgentTrace } from './components/AgentTrace'
import { ComparePanel } from './components/ComparePanel'
import { ConnectorsPanel } from './components/ConnectorsPanel'
import { HealerPanel } from './components/HealerPanel'
import { SelfUpgradePanel } from './components/SelfUpgradePanel'
import { TaskPanel } from './components/TaskPanel'
import { HealthPanel } from './components/HealthPanel'
import { MessageContent } from './components/MessageContent'
import { HistoryPanel } from './components/HistoryPanel'
import { MemoryPanel } from './components/MemoryPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { TemplatesPanel } from './components/TemplatesPanel'
import { PreviewPanel } from './components/PreviewPanel'
import { ProjectBuilderPanel } from './components/ProjectBuilderPanel'
import { ReferenceBuilderPanel } from './components/ReferenceBuilderPanel'
import { AuthPanel } from './components/AuthPanel'
import { CredentialVaultPanel } from './components/CredentialVaultPanel'
import type { AuthUser } from './components/AuthPanel'
import type { AgentEvent, AnswerStyle, AppSettings, AttachedFile, HistoryMeta, IntelligenceMode, Message, ObserverStatus, PendingQuestion, Prediction, PromptRoute, Task } from './types'
import { routePrompt } from './lib/promptRouter'
import { recordTelemetry } from './lib/telemetry'
import type { PendingTelemetry } from './lib/telemetry'
import './App.css'

type EngineStatus = 'checking' | 'online' | 'offline'
type WorkspaceMode = 'chat' | 'build' | 'research' | 'debug' | 'review' | 'system'

type AuthState = {
  ready: boolean
  configured: boolean
  token: string
  user: AuthUser | null
}

type QuickAction = {
  emoji: string
  label: string
  desc: string
  prompt: string
}

const DEFAULT_SETTINGS: AppSettings = {
  temperature: 0.35,
  maxIterations: 20,
  systemPrompt: '',
  fastModel: '',
  intelligenceMode: 'balanced',
  autoRoute: true,
  autoIntelligence: true,
  observationEnabled: true,
  observationMode: 'fast',
  observationIntervalSec: 45,
  domainExpertise: '',
  numCtx: 8192,
  answerStyle: 'detailed',
}

const AUTH_TOKEN_KEY = 'ultron-auth-token'

const ANSWER_STYLE_LABEL: Record<AnswerStyle, string> = {
  concise: 'Concise',
  detailed: 'Detailed',
  technical: 'Technical',
  executive: 'Executive',
}

const INTELLIGENCE_LABEL: Record<IntelligenceMode, string> = {
  instant: 'Instant',
  balanced: 'Balanced',
  deep: 'Deep',
  research: 'Research',
}

const ROUTE_SCORE_LABELS: Array<[keyof PromptRoute['scores'], string]> = [
  ['agent', 'Agent'],
  ['chat', 'Chat'],
  ['complexity', 'Complexity'],
  ['freshness', 'Freshness'],
]

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem('ultron-settings')
    if (raw) {
      const parsed = JSON.parse(raw) as AppSettings
      // Back-fill defaults for fields added after initial save
      return { ...DEFAULT_SETTINGS, ...parsed }
    }
  } catch { /* ignore */ }
  return DEFAULT_SETTINGS
}

function loadDarkMode(): boolean {
  try { return localStorage.getItem('ultron-dark') === '1' } catch { return false }
}

function loadQuietMode(): boolean {
  try { return localStorage.getItem('ultron-quiet-ui') !== '0' } catch { return true }
}

function loadWorkspaceMode(): WorkspaceMode {
  try {
    const raw = localStorage.getItem('ultron-workspace-mode')
    if (raw === 'build' || raw === 'research' || raw === 'debug' || raw === 'review' || raw === 'system') return raw
  } catch { /* ignore */ }
  return 'chat'
}

function buildArtifactSrcDoc(lang: string, code: string): string {
  if (lang === 'html' || lang === 'htm') {
    return code.includes('<html') ? code
      : `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;margin:16px;line-height:1.6}</style></head><body>${code}</body></html>`
  }
  if (lang === 'svg') return `<!DOCTYPE html><html><head><style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f8f9fa}</style></head><body>${code}</body></html>`
  if (lang === 'css') return `<!DOCTYPE html><html><head><style>body{font-family:system-ui,sans-serif;padding:24px}${code}</style></head><body><h1>Heading</h1><p>Paragraph with <strong>bold</strong> and <em>italic</em>.</p><button>Button</button></body></html>`
  if (lang === 'javascript' || lang === 'js') return `<!DOCTYPE html><html><head><style>body{font-family:ui-monospace,monospace;padding:12px;background:#0d1117;color:#c9d1d9;margin:0;font-size:12px}pre{white-space:pre-wrap;margin:0}.err{color:#f85149}</style></head><body><pre id="out"></pre><script>const $o=document.getElementById('out');const $a=(t,c)=>$o.innerHTML+=(c?'<span style="color:'+c+'">':'<span>')+String(t).replace(/</g,'&lt;')+'</span>\n';['log','info'].forEach(k=>{const _=console[k];console[k]=(...a)=>{$a(a.join(' '));_(...a)}});['error','warn'].forEach(k=>{const _=console[k];console[k]=(...a)=>{$a(a.join(' '),'#f85149');_(...a)}});try{${code}}catch(e){$a('Error: '+e.message,'#f85149')}<\/script></body></html>`
  return code
}

function getGreeting(): string {
  const h = new Date().getHours()
  if (h >= 5 && h < 12) return 'Good morning!'
  if (h >= 12 && h < 17) return 'Good afternoon!'
  if (h >= 17 && h < 21) return 'Good evening!'
  return 'Working late?'
}

const SLASH_COMMANDS = [
  { cmd: 'debug',    emoji: '🐛', label: 'Debug Error',      prompt: 'I\'m getting this error. Help me debug it:\n\n**Error:**\n```\n\n```\n\n**Code:**\n```\n\n```' },
  { cmd: 'review',   emoji: '🔍', label: 'Code Review',      prompt: 'Review this code for bugs, security issues, and best practices:\n\n```\n\n```' },
  { cmd: 'test',     emoji: '🧪', label: 'Write Tests',      prompt: 'Write comprehensive unit tests for this code:\n\n```\n\n```' },
  { cmd: 'explain',  emoji: '💡', label: 'Explain Code',     prompt: 'Explain what this code does, step by step:\n\n```\n\n```' },
  { cmd: 'refactor', emoji: '♻️', label: 'Refactor',         prompt: 'Refactor this code to improve readability and performance:\n\n```\n\n```' },
  { cmd: 'fix',      emoji: '🔧', label: 'Fix Bug',          prompt: 'Fix this bug and explain what was wrong:\n\n```\n\n```' },
  { cmd: 'summarize',emoji: '📋', label: 'Summarize',        prompt: 'Summarize this in 3-5 bullet points:\n\n' },
  { cmd: 'compare',  emoji: '🔄', label: 'Compare',          prompt: 'Compare and contrast these options:\n\nOption A:\nOption B:' },
  { cmd: 'improve',  emoji: '✍️', label: 'Improve Writing',  prompt: 'Improve this text for clarity and tone:\n\n' },
  { cmd: 'email',    emoji: '📧', label: 'Write Email',      prompt: 'Write a professional email for this situation:\n\n' },
  { cmd: 'search',   emoji: '🌐', label: 'Search Web',       prompt: 'Search the web and give me a comprehensive overview of:\n\n' },
  { cmd: 'files',    emoji: '📂', label: 'Search Files',      prompt: 'Search my files for: ' },
  { cmd: 'cmd',      emoji: '⌨️', label: 'Run CMD',           prompt: 'Run this in Command Prompt and summarize the output:\n\n' },
  { cmd: 'ps',       emoji: '⚡', label: 'Run PowerShell',    prompt: 'Run this in PowerShell and summarize the output:\n\n' },
  { cmd: 'status',   emoji: '📊', label: 'System Status',    prompt: 'Show my full system status: CPU, RAM, disk, top processes, uptime.' },
  { cmd: 'brief',    emoji: '📅', label: 'Daily Briefing',   prompt: 'Give me my daily briefing: tasks, schedule, and what I should know today.' },
  { cmd: 'image',    emoji: '🎨', label: 'Generate Image',   prompt: 'Generate an image of: ' },
  { cmd: 'memo',     emoji: '🧠', label: 'Save to Memory',   prompt: 'Remember this: ' },
]

const KEYBOARD_SHORTCUTS = [
  { key: 'Enter',       desc: 'Send message' },
  { key: 'Shift+Enter', desc: 'Newline in message' },
  { key: '↑ / ↓',       desc: 'Navigate prompt history' },
  { key: 'Ctrl+N',      desc: 'New chat' },
  { key: 'Ctrl+B',      desc: 'Toggle sidebar' },
  { key: 'Ctrl+F',      desc: 'Search in conversation' },
  { key: 'Ctrl+K',      desc: 'Open Command Center' },
  { key: 'Ctrl+M',      desc: 'Open Model Compare' },
  { key: 'Esc',         desc: 'Stop streaming' },
  { key: '?',           desc: 'Show this help' },
  { key: '/',           desc: 'Open slash command menu' },
]

function relativeTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(ts).toLocaleDateString()
}

function describeAgentEvent(event: AgentEvent): { label: string; detail: string } {
  switch (event.type) {
    case 'agent_plan':
      return { label: 'Plan', detail: event.plan.goal }
    case 'agent_task_state':
      return { label: event.status.replaceAll('_', ' '), detail: event.detail }
    case 'tool_call':
      return { label: 'Tool', detail: event.name }
    case 'tool_result':
      return { label: 'Result', detail: event.name }
    case 'stream_status':
      return { label: 'Status', detail: event.detail ?? event.status }
    case 'user_question':
      return { label: event.kind === 'permission' ? 'Permission' : 'Question', detail: event.question }
    case 'agent_step':
      return { label: 'Step', detail: `${event.step}/${event.maxSteps}` }
    case 'thinking':
      return { label: 'Thinking', detail: event.content }
  }
}

const WORKSPACE_MODES: Array<{ id: WorkspaceMode; label: string; headline: string; placeholder: string; agent: boolean }> = [
  { id: 'chat', label: 'Chat', headline: 'Ask, iterate, build', placeholder: 'Message Ultron...', agent: false },
  { id: 'build', label: 'Build', headline: 'Build workspace', placeholder: 'Describe the project or feature to build...', agent: true },
  { id: 'research', label: 'Research', headline: 'Research workspace', placeholder: 'What should Ultron verify, scan, or synthesize?', agent: true },
  { id: 'debug', label: 'Debug', headline: 'Debug workspace', placeholder: 'Paste the error, failing behavior, or stack trace...', agent: true },
  { id: 'review', label: 'Review', headline: 'Review workspace', placeholder: 'Paste code or describe what needs review...', agent: false },
  { id: 'system', label: 'System', headline: 'System workspace', placeholder: 'Ask Ultron to inspect health, tasks, memory, or connectors...', agent: true },
]

const QUICK_ACTIONS: QuickAction[] = [
  { emoji: '💻', label: 'Review my code', desc: 'Find bugs, suggestions, and best practices', prompt: 'Review the code I\'m working on and suggest improvements.' },
  { emoji: '🔍', label: 'Search the web', desc: 'Find up-to-date information online', prompt: 'Search the web for: ' },
  { emoji: '📁', label: 'Search files', desc: 'Find filenames or matching text locally', prompt: 'Search my files for: ' },
  { emoji: '🐛', label: 'Debug an error', desc: 'Diagnose and fix errors in your code', prompt: 'Help me debug this error:\n\n' },
  { emoji: '📝', label: 'Explain this', desc: 'Clear explanations on any topic', prompt: 'Explain this clearly:\n\n' },
  { emoji: '⚙️', label: 'System stats', desc: 'CPU, RAM, disk, and running processes', prompt: 'Show my system stats (CPU, RAM, disk, running processes).' },
  { emoji: '🌐', label: 'Summarize URL', desc: 'Fetch and summarize any web page', prompt: 'Fetch and summarize the content of: ' },
]

const AGENT_QUICK_ACTIONS: QuickAction[] = [
  { emoji: '📂', label: 'Explore project', desc: 'Map folder structure and purpose of each module', prompt: 'List this project\'s files and summarise what each top-level folder does.' },
  { emoji: '🧭', label: 'Find in files', desc: 'Fast local filename/content search', prompt: 'Search this workspace for files or code related to: ' },
  { emoji: '⌨️', label: 'Open shell', desc: 'Use CMD or PowerShell for local commands', prompt: 'Open or run the right Windows shell command for: ' },
  { emoji: '🔨', label: 'Build & fix errors', desc: 'Run the build, catch errors, auto-fix', prompt: 'Run the build, find any errors, and fix them.' },
  { emoji: '🌐', label: 'Latest Ollama news', desc: 'Find new models worth pulling locally', prompt: 'Search the web for the latest Ollama model releases and tell me which ones to pull.' },
  { emoji: '📊', label: 'System monitor', desc: 'Live CPU, RAM, and top processes', prompt: 'Show my system stats and top CPU/RAM processes.' },
  { emoji: '🧠', label: 'Recall memories', desc: 'Review everything Ultron remembers about you', prompt: 'List everything you remember about me and my projects.' },
  { emoji: '📋', label: 'Daily briefing', desc: 'Tasks, schedule, and system health', prompt: 'Give me my daily briefing — tasks, schedule, and anything I should know.' },
]

const WORKSPACE_QUICK_ACTIONS: Record<WorkspaceMode, QuickAction[]> = {
  chat: QUICK_ACTIONS,
  build: [
    { emoji: '🧱', label: 'New project', desc: 'Choose a template, plan files, and scaffold locally', prompt: 'Help me start a new programming project. Ask what kind of project, then make a build plan.' },
    { emoji: '🔨', label: 'Build & fix', desc: 'Run checks, inspect failures, and repair the project', prompt: 'Run the build, find any errors, and fix them.' },
    { emoji: '📋', label: 'Project plan', desc: 'Turn an idea into templates, tasks, and milestones', prompt: 'Turn this project idea into a file-by-file implementation plan with build steps:' },
    ...AGENT_QUICK_ACTIONS.slice(0, 3),
  ],
  research: [
    { emoji: '🌐', label: 'Scan website', desc: 'Learn a reference site and extract a build blueprint', prompt: 'Open Reference Builder so I can learn a website and build an original version from it.' },
    { emoji: '🔎', label: 'Verify sources', desc: 'Search, compare, and cite current information', prompt: 'Research this topic with current sources and summarize what is verified:' },
    { emoji: '🧭', label: 'Compare options', desc: 'Build a decision matrix from evidence', prompt: 'Compare these options with pros, cons, risks, and a recommendation:' },
    ...QUICK_ACTIONS.filter(action => action.label === 'Search the web' || action.label === 'Summarize URL'),
  ],
  debug: [
    { emoji: '🐞', label: 'Diagnose error', desc: 'Find likely cause and next checks', prompt: 'Help me debug this error. Start with the most likely root cause and the cheapest check:\n\n' },
    { emoji: '🧪', label: 'Run tests', desc: 'Find failing checks and propose fixes', prompt: 'Run the relevant tests or build, explain the failures, and fix what is broken.' },
    { emoji: '🩺', label: 'Health check', desc: 'Inspect UI, API, models, and local services', prompt: 'Check Ultron health end to end and tell me what needs attention.' },
    ...AGENT_QUICK_ACTIONS.slice(1, 4),
  ],
  review: [
    { emoji: '🧾', label: 'Code review', desc: 'Prioritize bugs, risks, and missing tests', prompt: 'Review this code like a senior engineer. Lead with bugs and risks:\n\n' },
    { emoji: '🔐', label: 'Security pass', desc: 'Look for unsafe inputs, secrets, and permissions', prompt: 'Review this for security risks, privacy issues, and permission problems:\n\n' },
    { emoji: '🧹', label: 'Simplify UI', desc: 'Find frontend noise and simplify the workflow', prompt: 'Review this UI and suggest what to remove, collapse, or make clearer:' },
    ...QUICK_ACTIONS.slice(0, 3),
  ],
  system: [
    { emoji: '⚙️', label: 'System stats', desc: 'CPU, RAM, disk, processes, and uptime', prompt: 'Show my system stats (CPU, RAM, disk, running processes).' },
    { emoji: '🧠', label: 'Recall memory', desc: 'Review what Ultron knows across projects', prompt: 'List everything you remember about me and my projects.' },
    { emoji: '🛠️', label: 'Self repair', desc: 'Scan Ultron and propose repairs', prompt: 'Run Ultron self-healer and tell me what should be repaired.' },
    ...AGENT_QUICK_ACTIONS.slice(3),
  ],
}

// In dev, call Express directly (bypasses Vite proxy which drops SSE connections on idle).
// CORS is open on the Express server so this works fine.
const API_BASE = import.meta.env.DEV ? 'http://localhost:8787' : ''

function App() {
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [status, setStatus] = useState<EngineStatus>('checking')
  const [engineError, setEngineError] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [agentMode, setAgentMode] = useState(false)
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null)
  const [questionDraft, setQuestionDraft] = useState('')
  const [questionFolderLoading, setQuestionFolderLoading] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
  const [isListening, setIsListening] = useState(false)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [visionModels, setVisionModels] = useState<Set<string>>(new Set())
  const [observerStatus, setObserverStatus] = useState<ObserverStatus | null>(null)
  const [darkMode, setDarkMode] = useState<boolean>(loadDarkMode)
  const [quietMode, setQuietMode] = useState<boolean>(loadQuietMode)
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(loadWorkspaceMode)
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Array<{ id: string; message: string; type: 'success' | 'error' | 'info' }>>([])
  const [showScrollBottom, setShowScrollBottom] = useState(false)
  const [messageImages, setMessageImages] = useState<Map<string, string[]>>(new Map())
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(loadQuietMode)
  const [artifact, setArtifact] = useState<{ lang: string; code: string; srcDoc: string } | null>(null)
  const [showTemplates, setShowTemplates] = useState(false)
  const [showMemory, setShowMemory] = useState(false)
  const [showHealer, setShowHealer] = useState(false)
  const [showHealth, setShowHealth] = useState(false)
  const [showCompare, setShowCompare] = useState(false)
  const [showTasks, setShowTasks] = useState(false)
  const [showConnectors, setShowConnectors] = useState(false)
  const [showReferenceBuilder, setShowReferenceBuilder] = useState(false)
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [showProjectBuilder, setShowProjectBuilder] = useState(false)
  const [showCredentialVault, setShowCredentialVault] = useState(false)
  const [showCommandCenter, setShowCommandCenter] = useState(false)
  const [auth, setAuth] = useState<AuthState>({ ready: false, configured: false, token: '', user: null })
  const [commandQuery, setCommandQuery] = useState('')
  const [showComposerTools, setShowComposerTools] = useState(false)
  const [voiceConvMode, setVoiceConvMode] = useState(false)
  const [taskOverdueCount, setTaskOverdueCount] = useState(0)
  const voiceConvRef = useRef(false)
  const draftRef = useRef('')
  const isStreamingRef = useRef(false)
  const voiceTranscriptRef = useRef(false)
  const [enhancing, setEnhancing] = useState(false)
  const [preEnhanceDraft, setPreEnhanceDraft] = useState<string | null>(null)
  const [recentChats, setRecentChats] = useState<HistoryMeta[]>([])
  const [feedback, setFeedback] = useState<Map<string, 'up' | 'down'>>(new Map())
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set())
  const [slashMenu, setSlashMenu] = useState<string | null>(null)
  const [slashIdx, setSlashIdx] = useState(0)
  const [showHelp, setShowHelp] = useState(false)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const sendTimeRef = useRef<number | null>(null)
  const telemetryRef = useRef<Map<string, PendingTelemetry>>(new Map())
  const sentHistoryRef = useRef<string[]>([])
  const historyIdxRef = useRef(-1)
  const currentSessionId = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const recognitionRef = useRef<unknown>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const wasStreamingRef = useRef(false)
  const messageListRef = useRef<HTMLDivElement | null>(null)
  const atBottomRef = useRef(true)
  const deferredMessages = useDeferredValue(messages)

  useEffect(() => {
    let cancelled = false
    async function loadAuth() {
      const token = localStorage.getItem(AUTH_TOKEN_KEY) ?? ''
      try {
        const statusResponse = await fetch(`${API_BASE}/api/auth/status`)
        const statusData = await statusResponse.json() as { configured?: boolean }
        let user: AuthUser | null = null
        if (token) {
          const meResponse = await fetch(`${API_BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
          if (meResponse.ok) user = ((await meResponse.json()) as { user: AuthUser | null }).user
        }
        if (!cancelled) setAuth({ ready: true, configured: Boolean(statusData.configured), token: user ? token : '', user })
      } catch {
        if (!cancelled) setAuth({ ready: true, configured: false, token: '', user: null })
      }
    }
    void loadAuth()
    return () => { cancelled = true }
  }, [])

  function handleAuthenticated(session: { token: string; user: AuthUser }) {
    localStorage.setItem(AUTH_TOKEN_KEY, session.token)
    setAuth({ ready: true, configured: true, token: session.token, user: session.user })
  }

  async function logout() {
    if (auth.token) {
      await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${auth.token}` } }).catch(() => undefined)
    }
    localStorage.removeItem(AUTH_TOKEN_KEY)
    setAuth(current => ({ ...current, token: '', user: null }))
  }

  useEffect(() => {
    let isMounted = true

    async function loadEngineState() {
      try {
        const response = await fetch(`${API_BASE}/api/health`)
        const payload = await response.json()

        if (!isMounted) {
          return
        }

        if (!response.ok || !payload.ok) {
          throw new Error(payload.error ?? 'Ollama is offline')
        }

        setStatus('online')
        setSelectedModel(payload.model ?? 'qwen2.5:14b')

        // Load available model names for settings panel
        const modelsRes = await fetch(`${API_BASE}/api/models`).catch(() => null)
        if (modelsRes?.ok) {
          const md = await modelsRes.json() as { models?: Array<{ name: string; vision?: boolean }> }
          setAvailableModels((md.models ?? []).map((m) => m.name))
          setVisionModels(new Set((md.models ?? []).filter(m => m.vision).map(m => m.name)))
        }
      } catch (loadError) {
        if (isMounted) {
          setStatus('offline')
          setSelectedModel('qwen2.5:14b')
          setEngineError(loadError instanceof Error ? loadError.message : 'Could not reach Ollama')
        }
      }
    }

    loadEngineState()

    // Poll observer status every 15 seconds and update the indicator
    const obsTimer = setInterval(async () => {
      try {
        const r = await fetch(`${API_BASE}/api/observer/status`)
        if (r.ok) setObserverStatus(await r.json() as ObserverStatus)
      } catch { /* offline */ }
    }, 15_000)
    // Initial fetch — also syncs saved settings to server
    fetch(`${API_BASE}/api/observer/status`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setObserverStatus(d as ObserverStatus) })
      .catch(() => {})

    // Sync persisted settings to server on startup (e.g. user disabled in last session)
    const saved = loadSettings()
    fetch(`${API_BASE}/api/observer/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: saved.observationEnabled,
        mode: saved.observationMode,
        intervalSec: saved.observationIntervalSec,
      }),
    }).catch(() => {})

    // Load recent chats for welcome screen
    fetch(`${API_BASE}/api/history`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { sessions?: HistoryMeta[] } | null) => {
        if (d?.sessions) setRecentChats(d.sessions.slice(0, 5))
      })
      .catch(() => {})

    // Load overdue task count for sidebar badge
    fetch(`${API_BASE}/api/tasks`)
      .then(r => r.ok ? r.json() : { tasks: [] })
      .then((d: { tasks?: Task[] }) => {
        const today = new Date().toISOString().split('T')[0]
        setTaskOverdueCount((d.tasks ?? []).filter(t => !t.done && !!t.due && t.due < today).length)
      })
      .catch(() => {})

    return () => {
      isMounted = false
      clearInterval(obsTimer)
    }
  }, [])

  // Keep refs in sync with state (avoids stale closures inside recognition callbacks)
  useEffect(() => { draftRef.current = draft }, [draft])
  useEffect(() => { isStreamingRef.current = isStreaming }, [isStreaming])
  useEffect(() => { voiceConvRef.current = voiceConvMode }, [voiceConvMode])

  useEffect(() => {
    if (atBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [deferredMessages])

  // Detect streaming-just-finished → trigger follow-ups + smart title
  useEffect(() => {
    if (!wasStreamingRef.current || isStreaming) {
      wasStreamingRef.current = isStreaming
      return
    }
    wasStreamingRef.current = false

    const lastMsg = messages[messages.length - 1]
    if (!lastMsg || lastMsg.role !== 'assistant' || !lastMsg.content) return

    // Auto-speak in voice conversation mode
    if (voiceConvRef.current) {
      const stripped = lastMsg.content
        .replace(/```[\s\S]*?```/g, 'code block')
        .replace(/[#*_`~>]/g, '')
        .trim()
        .slice(0, 2500)
      window.speechSynthesis.cancel()
      const utter = new SpeechSynthesisUtterance(stripped)
      utter.rate = 1.05
      setSpeakingId(lastMsg.id)
      const afterSpeak = () => {
        setSpeakingId(null)
        if (voiceConvRef.current && !isStreamingRef.current) {
          setTimeout(() => _startVoiceListen(), 600)
        }
      }
      utter.onend = afterSpeak
      utter.onerror = afterSpeak
      window.speechSynthesis.speak(utter)
    }

    // Generate follow-up suggestions + predictive actions (chat and agent mode)
    {
      const forFollowups = messages.slice(-4).map(m => ({ role: m.role as string, content: m.content.slice(0, 800) }))
      const assistantId = lastMsg.id
      void fetch(`${API_BASE}/api/followups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: forFollowups }),
      }).then(r => r.ok ? r.json() : null)
        .then((data: { suggestions?: string[] } | null) => {
          if (!data?.suggestions?.length) return
          const raw = data.suggestions
          const followupLines: string[] = []
          const predictionItems: Prediction[] = []

          for (const line of raw) {
            if (line.startsWith('PREDICT: ')) {
              const rest = line.slice(9)
              const pipeIdx = rest.indexOf(' | ')
              if (pipeIdx > 0) {
                const emojiLabel = rest.slice(0, pipeIdx).trim()
                const prompt = rest.slice(pipeIdx + 3).trim()
                const spaceIdx = emojiLabel.indexOf(' ')
                const emoji = spaceIdx > 0 ? emojiLabel.slice(0, spaceIdx) : '▶'
                const label = spaceIdx > 0 ? emojiLabel.slice(spaceIdx + 1).trim() : emojiLabel
                if (prompt && label) predictionItems.push({ emoji, label, prompt })
              }
            } else {
              followupLines.push(line)
            }
          }

          setMessages(prev => prev.map(m =>
            m.id === assistantId ? {
              ...m,
              followups: followupLines.length ? followupLines : undefined,
              predictions: predictionItems.length ? predictionItems : undefined,
            } : m,
          ))
        }).catch(() => {})
    }

    // Generate smart conversation title after first exchange
    if (messages.length === 2 && messages[0].role === 'user' && currentSessionId.current) {
      const firstTwo = messages.slice(0, 2).map(m => ({ role: m.role as string, content: m.content.slice(0, 400) }))
      const sessionId = currentSessionId.current
      void fetch(`${API_BASE}/api/title`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: firstTwo }),
      }).then(r => r.ok ? r.json() : null)
        .then((data: { title?: string } | null) => {
          if (data?.title && sessionId) {
            void fetch(`${API_BASE}/api/history`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: sessionId, title: data.title, model: selectedModel, messages }),
            }).catch(() => {})
          }
        }).catch(() => {})
    }
  }, [isStreaming]) // eslint-disable-line react-hooks/exhaustive-deps

  function autoResizeTextarea() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 300)}px`
  }

  // Apply / persist dark mode
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
    try { localStorage.setItem('ultron-dark', darkMode ? '1' : '0') } catch { /* ignore */ }
  }, [darkMode])

  // Detect artifact (previewable code) in the latest assistant message
  useEffect(() => {
    if (isStreaming) return
    const lastMsg = messages[messages.length - 1]
    if (lastMsg?.role !== 'assistant' || !lastMsg.content) return
    const match = lastMsg.content.match(/```(html|htm|svg|css|javascript|js)\n([\s\S]+?)```/)
    if (!match) return
    const lang = match[1]
    const code = match[2]
    const srcDoc = buildArtifactSrcDoc(lang, code)
    setArtifact({ lang, code, srcDoc })
  }, [isStreaming, messages])

  // Global keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (document.activeElement as HTMLElement)?.tagName
      const inInput = tag === 'TEXTAREA' || tag === 'INPUT'
      // Ctrl/Cmd+N → new chat (only when not in an input)
      if ((e.ctrlKey || e.metaKey) && e.key === 'n' && !e.shiftKey && !inInput) {
        e.preventDefault()
        abortRef.current?.abort()
        setMessages([])
        setDraft('')
        setEngineError('')
        currentSessionId.current = null
        atBottomRef.current = true
      }
      // Escape → stop streaming OR close menus
      if (e.key === 'Escape') {
        if (isStreaming) { abortRef.current?.abort(); setIsStreaming(false) }
        setLightboxUrl(null)
      }
      // Ctrl/Cmd+K → command center, Ctrl/Cmd+/ → focus composer
      if ((e.ctrlKey || e.metaKey) && e.key === 'k' && !inInput) {
        e.preventDefault()
        setShowCommandCenter(true)
        setCommandQuery('')
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '/' && !inInput) {
        e.preventDefault()
        textareaRef.current?.focus()
      }
      // Ctrl/Cmd+F → toggle search
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && !inInput) {
        e.preventDefault()
        setShowSearch(s => !s)
      }
      // Ctrl/Cmd+B → collapse sidebar
      if ((e.ctrlKey || e.metaKey) && e.key === 'b' && !inInput) {
        e.preventDefault()
        setSidebarCollapsed(c => !c)
      }
      // Ctrl/Cmd+M → model compare
      if ((e.ctrlKey || e.metaKey) && e.key === 'm' && !inInput) {
        e.preventDefault()
        setShowCompare(c => !c)
      }
      // ? → keyboard help modal
      if (e.key === '?' && !inInput && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        setShowHelp(s => !s)
      }
      // Escape also closes slash menu and help modal
      if (e.key === 'Escape') {
        setSlashMenu(null)
        setShowHelp(false)
        setShowCommandCenter(false)
        setShowComposerTools(false)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isStreaming]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load a history session by ID
  async function loadHistory(id: string) {
    try {
      const r = await fetch(`${API_BASE}/api/history/${id}`)
      const d = await r.json() as { session?: { messages: Message[]; model: string } }
      if (d.session) {
        currentSessionId.current = id
        setMessages(d.session.messages.map(m => ({ ...m, timestamp: m.timestamp ?? 0 })))
        if (d.session.model) setSelectedModel(d.session.model)
        atBottomRef.current = true
      }
    } catch { /* silent */ }
  }

  function toggleFeedback(msgId: string, vote: 'up' | 'down') {
    setFeedback(prev => {
      const next = new Map(prev)
      if (next.get(msgId) === vote) next.delete(msgId)
      else next.set(msgId, vote)
      return next
    })
  }

  function toggleDark() { setDarkMode(d => !d) }

  // Toast notifications
  function addToast(message: string, type: 'success' | 'error' | 'info' = 'info') {
    const id = crypto.randomUUID()
    setToasts(p => [...p.slice(-3), { id, message, type }])
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4000)
  }

  // Copy entire assistant message to clipboard
  const [copiedId, setCopiedId] = useState<string | null>(null)
  function copyMessage(id: string, content: string) {
    void navigator.clipboard.writeText(content).then(() => {
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
      addToast('Copied to clipboard', 'success')
    })
  }

  // Read Aloud — browser Web Speech API
  function speakMessage(id: string, content: string) {
    if (speakingId === id) {
      window.speechSynthesis.cancel()
      setSpeakingId(null)
      return
    }
    window.speechSynthesis.cancel()
    const stripped = content.replace(/```[\s\S]*?```/g, 'code block').replace(/[#*`_~>]/g, '').slice(0, 3000)
    const utterance = new SpeechSynthesisUtterance(stripped)
    utterance.rate = 1.05
    utterance.onend = () => setSpeakingId(null)
    utterance.onerror = () => setSpeakingId(null)
    setSpeakingId(id)
    window.speechSynthesis.speak(utterance)
  }

  // Edit a user message — restores it to composer and trims history
  function editMessage(msgId: string) {
    if (isStreaming) return
    const idx = messages.findIndex(m => m.id === msgId)
    if (idx === -1) return
    const msg = messages[idx]
    setDraft(msg.content)
    setMessages(messages.slice(0, idx))
    setTimeout(() => {
      textareaRef.current?.focus()
      autoResizeTextarea()
    }, 0)
  }

  // Export current conversation as Markdown
  function exportChat() {
    if (!messages.length) return
    const lines: string[] = [`# Ultron — Conversation Export\n*${new Date().toLocaleString()}*\n`]
    for (const m of messages) {
      lines.push(`\n---\n\n**${m.role === 'assistant' ? 'Ultron' : 'You'}**\n\n${m.content}`)
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ultron-chat-${Date.now()}.md`
    a.click()
    URL.revokeObjectURL(url)
    addToast('Chat exported as Markdown', 'success')
  }

  // ── File attachment helpers ───────────────────────────────────────────────
  async function readFileAsAttachment(file: File): Promise<AttachedFile | null> {
    const isImage = file.type.startsWith('image/')
    const isText = file.type.startsWith('text/') ||
      /\.(ts|tsx|js|jsx|py|md|json|yaml|yml|css|html|sh|ps1|go|rb|rs|java|c|cpp|h|sql|xml|txt|toml|env|gitignore|dockerfile)$/i.test(file.name)

    if (!isImage && !isText) return null
    if (file.size > 500_000 && !isImage) return null // skip very large non-image files

    return new Promise<AttachedFile | null>((resolve) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const content = e.target?.result as string
        resolve({
          id: crypto.randomUUID(),
          name: file.name,
          size: file.size,
          kind: isImage ? 'image' : 'text',
          content,
          mime: file.type || 'text/plain',
        })
      }
      reader.onerror = () => resolve(null)
      if (isImage) reader.readAsDataURL(file)
      else reader.readAsText(file)
    })
  }

  async function attachFiles(files: File[]) {
    const results = await Promise.all(files.map(readFileAsAttachment))
    const valid = results.filter((f): f is AttachedFile => f !== null)
    setAttachedFiles(prev => [...prev, ...valid])
  }

  function removeAttachment(id: string) {
    setAttachedFiles(prev => prev.filter(f => f.id !== id))
  }

  function buildMessageContent(text: string, files: AttachedFile[]): string {
    if (!files.length) return text
    const parts: string[] = []
    for (const f of files) {
      if (f.kind === 'text') {
        const ext = f.name.split('.').pop() ?? 'text'
        const preview = f.content.length > 8000 ? f.content.slice(0, 8000) + '\n... (truncated)' : f.content
        parts.push(`**[File: ${f.name}]**\n\`\`\`${ext}\n${preview}\n\`\`\``)
      } else {
        parts.push(`**[Image: ${f.name}]** *(${Math.round(f.size / 1024)} KB)*`)
      }
    }
    if (text) parts.push(text)
    return parts.join('\n\n')
  }

  // Paste handler — captures image pastes
  async function onComposerPaste(e: React.ClipboardEvent) {
    const items = Array.from(e.clipboardData.items)
    const imgItem = items.find(i => i.type.startsWith('image/'))
    if (imgItem) {
      const file = imgItem.getAsFile()
      if (file) {
        e.preventDefault()
        await attachFiles([file])
      }
    }
  }

  function appendAgentEvent(assistantId: string, event: AgentEvent) {
    setMessages((current) =>
      current.map((m) =>
        m.id === assistantId ? { ...m, agentEvents: [...m.agentEvents, event] } : m,
      ),
    )
  }

  const saveToHistory = useCallback(async (msgs: Message[], model: string) => {
    if (msgs.length < 2) return
    const userMsg = msgs.find((m) => m.role === 'user')
    const title = userMsg ? userMsg.content.slice(0, 70) : 'Conversation'
    try {
      const res = await fetch(`${API_BASE}/api/history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: currentSessionId.current ?? undefined, title, model, messages: msgs }),
      })
      const d = await res.json() as { id?: string }
      if (d.id) currentSessionId.current = d.id
    } catch { /* silent */ }
  }, [])

  // Internal single-shot voice toggle (used in normal mic mode)
  function _doToggleVoice() {
    type SpeechRecAny = new () => {
      continuous: boolean; interimResults: boolean; lang: string
      start(): void; stop(): void
      onresult: ((e: { results: Array<Array<{ transcript: string }>> }) => void) | null
      onend: (() => void) | null
    }
    const Win = window as unknown as { SpeechRecognition?: SpeechRecAny; webkitSpeechRecognition?: SpeechRecAny }
    const SpeechRec = Win.SpeechRecognition ?? Win.webkitSpeechRecognition
    if (!SpeechRec) { setEngineError('Voice input not supported in this browser'); return }

    if (isListening) {
      const rec = recognitionRef.current as { stop(): void } | null
      rec?.stop()
      setIsListening(false)
      return
    }

    const recognition = new SpeechRec()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = 'en-US'
    recognition.onresult = (e) => {
      const transcript = Array.from(e.results).map((r) => r[0].transcript).join('')
      setDraft(transcript)
    }
    recognition.onend = () => setIsListening(false)
    recognition.start()
    recognitionRef.current = recognition
    setIsListening(true)
  }

  // Start a single voice capture in conversation mode
  function _startVoiceListen() {
    if (!voiceConvRef.current || isStreamingRef.current) return
    type SpeechRecAny = new () => {
      continuous: boolean; interimResults: boolean; lang: string
      start(): void; stop(): void
      onresult: ((e: { results: Array<Array<{ transcript: string }>> }) => void) | null
      onend: (() => void) | null
    }
    const Win = window as unknown as { SpeechRecognition?: SpeechRecAny; webkitSpeechRecognition?: SpeechRecAny }
    const SpeechRec = Win.SpeechRecognition ?? Win.webkitSpeechRecognition
    if (!SpeechRec) return

    const recognition = new SpeechRec()
    recognition.continuous = false
    recognition.interimResults = false
    recognition.lang = 'en-US'
    recognition.onresult = (e) => {
      const transcript = Array.from(e.results).map((r) => r[0].transcript).join('')
      setDraft(transcript)
      draftRef.current = transcript
      voiceTranscriptRef.current = true
    }
    recognition.onend = () => {
      setIsListening(false)
      if (voiceConvRef.current && voiceTranscriptRef.current && draftRef.current.trim() && !isStreamingRef.current) {
        voiceTranscriptRef.current = false
        // Submit the form — lets sendMessage pick up the current draft state
        setTimeout(() => {
          const form = textareaRef.current?.closest('form')
          form?.requestSubmit()
        }, 150)
      } else if (voiceConvRef.current && !isStreamingRef.current) {
        voiceTranscriptRef.current = false
        setTimeout(() => _startVoiceListen(), 400)
      }
    }
    recognition.start()
    recognitionRef.current = recognition
    setIsListening(true)
  }

  // Toggle hands-free conversation mode
  function startConversation() {
    if (voiceConvRef.current) {
      voiceConvRef.current = false
      setVoiceConvMode(false)
      window.speechSynthesis.cancel()
      const rec = recognitionRef.current as { stop(): void } | null
      rec?.stop()
      setIsListening(false)
      return
    }
    voiceConvRef.current = true
    setVoiceConvMode(true)
    window.speechSynthesis.cancel()
    setTimeout(() => _startVoiceListen(), 200)
  }

  function updateSettings(next: AppSettings) {
    setSettings(next)
    try { localStorage.setItem('ultron-settings', JSON.stringify(next)) } catch { /* ignore */ }
  }

  function setIntelligenceMode(mode: IntelligenceMode) {
    updateSettings({ ...settings, intelligenceMode: mode })
  }

  function setAnswerStyle(answerStyle: AnswerStyle) {
    updateSettings({ ...settings, answerStyle })
  }

  function reloadTaskCount() {
    fetch(`${API_BASE}/api/tasks`)
      .then(r => r.ok ? r.json() : { tasks: [] })
      .then((d: { tasks?: Task[] }) => {
        const today = new Date().toISOString().split('T')[0]
        setTaskOverdueCount((d.tasks ?? []).filter(t => !t.done && !!t.due && t.due < today).length)
      })
      .catch(() => {})
  }

  async function enhancePrompt() {
    if (!draft.trim() || enhancing || isStreaming) return
    setEnhancing(true)
    const original = draft
    setPreEnhanceDraft(original)
    try {
      const res = await fetch(`${API_BASE}/api/enhance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: draft, model: selectedModel }),
      })
      if (!res.ok) throw new Error('Enhancement failed')
      const data = await res.json() as { enhanced?: string }
      if (data.enhanced) {
        setDraft(data.enhanced)
        setTimeout(() => autoResizeTextarea(), 0)
      } else {
        setPreEnhanceDraft(null)
      }
    } catch {
      setPreEnhanceDraft(null)
    } finally {
      setEnhancing(false)
    }
  }

  function undoEnhance() {
    if (preEnhanceDraft !== null) {
      setDraft(preEnhanceDraft)
      setPreEnhanceDraft(null)
      setTimeout(() => autoResizeTextarea(), 0)
    }
  }

  async function sendMessage(event?: FormEvent<HTMLFormElement>, promptOverride?: string, conversationOverride?: Message[], routeOverride?: Partial<PromptRoute>) {
    event?.preventDefault()
    const rawContent = (promptOverride ?? draft).trim()
    const imageFiles = promptOverride ? [] : attachedFiles.filter(f => f.kind === 'image')
    const content = buildMessageContent(rawContent, promptOverride ? [] : attachedFiles)

    if (!content || isStreaming) {
      return
    }

    // Push to prompt history (for ↑/↓ navigation)
    sentHistoryRef.current = [rawContent, ...sentHistoryRef.current.slice(0, 49)]
    historyIdxRef.current = -1

    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', content, agentEvents: [], timestamp: Date.now() }
    const assistantId = crypto.randomUUID()
    const baseHistory = conversationOverride ?? messages
    const conversation = [...baseHistory, userMessage]

    // Store image URLs for display in the message bubble (not persisted to history)
    if (imageFiles.length > 0) {
      const urls = imageFiles.map(f => f.content)
      setMessageImages(prev => new Map(prev).set(userMessage.id, urls))
    }

    const baseRoute = routePrompt(rawContent, attachedFiles.length > 0, imageFiles.length > 0, settings, agentMode)
    const route: PromptRoute = {
      ...baseRoute,
      ...routeOverride,
      scores: { ...baseRoute.scores, ...routeOverride?.scores },
      signals: routeOverride?.signals ?? baseRoute.signals,
    }

    setMessages([...conversation, { id: assistantId, role: 'assistant', content: '', agentEvents: [], timestamp: Date.now(), route }])
    setDraft('')
    setPreEnhanceDraft(null)
    setAttachedFiles([])
    if (textareaRef.current) { textareaRef.current.style.height = 'auto' }
    setEngineError('')
    setIsStreaming(true)
    wasStreamingRef.current = true
    atBottomRef.current = true // always scroll to bottom on new send
    sendTimeRef.current = Date.now()
    telemetryRef.current.set(assistantId, {
      id: assistantId,
      startedAt: sendTimeRef.current,
      route,
      promptLength: rawContent.length,
      requestedModel: selectedModel,
      toolCount: 0,
    })

    const controller = new AbortController()
    abortRef.current = controller

    const endpoint = route.useAgent ? `${API_BASE}/api/agent` : `${API_BASE}/api/chat`
    if (settings.autoRoute || settings.autoIntelligence) {
      addToast(`Auto: ${route.useAgent ? 'Agent' : 'Chat'} · ${INTELLIGENCE_LABEL[route.intelligenceMode]} · ${Math.round(route.confidence * 100)}% (${route.reason})`, 'info')
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: conversation.map(({ role, content: messageContent }) => ({ role, content: messageContent })),
          model: selectedModel,
          temperature: settings.temperature,
          maxIterations: settings.maxIterations,
          systemPrompt: settings.systemPrompt,
          fastModel: settings.fastModel || undefined,
          intelligenceMode: route.intelligenceMode,
          domainExpertise: settings.domainExpertise || undefined,
          numCtx: settings.numCtx,
          answerStyle: settings.answerStyle,
          // Strip "data:image/...;base64," prefix — Ollama expects raw base64
          images: imageFiles.length > 0
            ? imageFiles.map(f => f.content.replace(/^data:[^;]+;base64,/, ''))
            : undefined,
        }),
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({ error: 'The assistant engine did not respond.' }))
        throw new Error(payload.error ?? 'The assistant engine did not respond.')
      }

      await readAssistantStream(response.body, assistantId)
    } catch (sendError) {
      if (!controller.signal.aborted) {
        const msg = sendError instanceof Error ? sendError.message : 'The assistant failed to answer.'
        const pendingTelemetry = telemetryRef.current.get(assistantId)
        if (pendingTelemetry) pendingTelemetry.errorType = msg.slice(0, 120)
        addToast(msg, 'error')
        setMessages((current) =>
          current.map((chatMessage) =>
            chatMessage.id === assistantId
              ? { ...chatMessage, content: `Error: ${msg}` }
              : chatMessage,
          ),
        )
      }
    } finally {
      const pendingTelemetry = telemetryRef.current.get(assistantId)
      if (pendingTelemetry) {
        recordTelemetry(pendingTelemetry)
        telemetryRef.current.delete(assistantId)
      }
      setIsStreaming(false)
      abortRef.current = null
      // Auto-save conversation to history
      setMessages((current) => {
        void saveToHistory(current, selectedModel)
        return current
      })
    }
  }

  async function readAssistantStream(stream: ReadableStream<Uint8Array>, assistantId: string) {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const events = buffer.split('\n\n')
      buffer = events.pop() ?? ''

      for (const rawEvent of events) {
        handleStreamEvent(rawEvent, assistantId)
      }
    }
  }

  function handleStreamEvent(rawEvent: string, assistantId: string) {
    const eventName = rawEvent.match(/^event: (.+)$/m)?.[1]
    const dataLine = rawEvent.match(/^data: (.+)$/m)?.[1]

    if (!eventName || !dataLine) {
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = JSON.parse(dataLine) as any

    switch (eventName) {
      case 'token':
        {
          const pendingTelemetry = telemetryRef.current.get(assistantId)
          if (pendingTelemetry && !pendingTelemetry.firstTokenMs) {
            pendingTelemetry.firstTokenMs = Date.now() - pendingTelemetry.startedAt
          }
        }
        setMessages((current) =>
          current.map((chatMessage) => {
            if (chatMessage.id !== assistantId) return chatMessage
            const isFirst = !chatMessage.firstTokenMs && sendTimeRef.current !== null
            return {
              ...chatMessage,
              content: `${chatMessage.content}${payload.token as string}`,
              firstTokenMs: isFirst ? Date.now() - (sendTimeRef.current ?? Date.now()) : chatMessage.firstTokenMs,
            }
          }),
        )
        break

      case 'agent_step':
        appendAgentEvent(assistantId, {
          type: 'agent_step',
          step: payload.step as number,
          maxSteps: payload.maxSteps as number,
        })
        break

      case 'agent_plan':
        appendAgentEvent(assistantId, {
          type: 'agent_plan',
          plan: payload.plan,
        })
        break

      case 'agent_task_state':
        appendAgentEvent(assistantId, {
          type: 'agent_task_state',
          status: payload.status,
          detail: payload.detail as string,
        })
        break

      case 'stream_status':
        appendAgentEvent(assistantId, {
          type: 'stream_status',
          status: payload.status as string,
          detail: payload.detail as string | undefined,
          elapsedMs: payload.elapsedMs as number | undefined,
          firstTokenMs: payload.firstTokenMs as number | undefined,
          totalMs: payload.totalMs as number | undefined,
        })
        break

      case 'thinking':
        appendAgentEvent(assistantId, { type: 'thinking', content: payload.content as string })
        break

      case 'tool_call':
        {
          const pendingTelemetry = telemetryRef.current.get(assistantId)
          if (pendingTelemetry) pendingTelemetry.toolCount += 1
        }
        appendAgentEvent(assistantId, {
          type: 'tool_call',
          id: payload.id as string,
          name: payload.name as string,
          args: payload.args as Record<string, unknown>,
        })
        break

      case 'tool_result':
        appendAgentEvent(assistantId, {
          type: 'tool_result',
          id: payload.id as string,
          name: payload.name as string,
          result: payload.result as string,
        })
        break


      case 'question':
        setPendingQuestion({
          id: payload.id as string,
          question: payload.question as string,
          context: (payload.context as string) ?? '',
          kind: payload.kind === 'permission' ? 'permission' : 'question',
          mode: payload.mode === 'project_setup' ? 'project_setup' : undefined,
          defaultAnswer: typeof payload.defaultAnswer === 'string' ? payload.defaultAnswer : undefined,
        })
        setQuestionDraft(typeof payload.defaultAnswer === 'string' ? payload.defaultAnswer : '')
        appendAgentEvent(assistantId, {
          type: 'user_question',
          id: payload.id as string,
          question: payload.question as string,
          context: (payload.context as string) ?? '',
        })
        break

      case 'error':
        {
          const pendingTelemetry = telemetryRef.current.get(assistantId)
          if (pendingTelemetry) pendingTelemetry.errorType = (payload.error as string | undefined)?.slice(0, 120) ?? 'stream error'
        }
        throw new Error(payload.error ?? 'The assistant stream failed.')

      case 'set_content':
        // Replace message content (e.g. to strip tool-call JSON or think tags)
        setMessages((current) =>
          current.map((chatMessage) =>
            chatMessage.id === assistantId
              ? { ...chatMessage, content: payload.content as string }
              : chatMessage,
          ),
        )
        break

      case 'metrics':
        {
          const pendingTelemetry = telemetryRef.current.get(assistantId)
          if (pendingTelemetry) {
            pendingTelemetry.model = payload.model as string | undefined
            pendingTelemetry.promptTokens = payload.promptTokens as number | undefined
            pendingTelemetry.responseTokens = payload.responseTokens as number | undefined
            pendingTelemetry.tokensPerSec = payload.tokensPerSec as number | undefined
          }
        }
        setMessages((current) =>
          current.map((chatMessage) =>
            chatMessage.id === assistantId
              ? {
                  ...chatMessage,
                  metrics: {
                    model: payload.model as string,
                    iterations: payload.iterations as number | undefined,
                    promptTokens: payload.promptTokens as number | undefined,
                    responseTokens: payload.responseTokens as number | undefined,
                    tokensPerSec: payload.tokensPerSec as number | undefined,
                  },
                }
              : chatMessage,
          ),
        )
        break
    }
  }

  async function submitAnswer(event?: FormEvent<HTMLFormElement>, answerOverride?: string) {
    event?.preventDefault()
    if (!pendingQuestion) return
    const { id } = pendingQuestion
    const answer = (answerOverride ?? questionDraft).trim()
    if (!answer) return
    setPendingQuestion(null)
    setQuestionDraft('')
    try {
      await fetch(`${API_BASE}/api/agent/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, answer }),
      })
    } catch {
      // answer sent best-effort
    }
  }

  function answerWithDestinationPath(answer: string, destinationPath: string) {
    const withoutLocation = answer
      .replace(/\s+(?:at|in|inside|under|on)\s+.+$/i, '')
      .replace(/\s*[,;]\s*(?:location|path|folder)\s*[:=]\s*.+$/i, '')
      .trim()
    return `${withoutLocation || pendingQuestion?.defaultAnswer || 'my-project'} at ${destinationPath}`
  }

  async function chooseQuestionDestinationFolder() {
    if (!pendingQuestion || questionFolderLoading) return
    setQuestionFolderLoading(true)
    try {
      const response = await fetch(`${API_BASE}/api/project-builder/select-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ basePath: questionDraft }),
      })
      const data = await response.json() as { cancelled?: boolean; path?: string; error?: string }
      if (!response.ok) throw new Error(data.error ?? `Folder picker failed (${response.status})`)
      if (!data.cancelled && data.path) setQuestionDraft(current => answerWithDestinationPath(current, data.path as string))
    } catch (err) {
      setEngineError(err instanceof Error ? err.message : 'Could not choose destination folder')
    } finally {
      setQuestionFolderLoading(false)
    }
  }

  function regenerate() {
    if (isStreaming || messages.length < 2) return
    // Trim trailing assistant messages to find the last user message
    let cutIdx = messages.length
    while (cutIdx > 0 && messages[cutIdx - 1].role === 'assistant') cutIdx--
    if (cutIdx === 0) return
    const userMsg = messages[cutIdx - 1]
    if (userMsg.role !== 'user') return
    const historyBeforeUser = messages.slice(0, cutIdx - 1)
    setMessages(historyBeforeUser)
    void sendMessage(undefined, userMsg.content, historyBeforeUser)
  }

  function rerunFromAssistant(assistantId: string, routeOverride: Partial<PromptRoute>, promptPrefix?: string) {
    if (isStreaming) return
    const assistantIdx = messages.findIndex(m => m.id === assistantId)
    if (assistantIdx < 1) return
    let userIdx = assistantIdx - 1
    while (userIdx >= 0 && messages[userIdx].role !== 'user') userIdx--
    if (userIdx < 0) return
    const userMessage = messages[userIdx]
    const historyBeforeUser = messages.slice(0, userIdx)
    const nextPrompt = promptPrefix ? `${promptPrefix}\n\n${userMessage.content}` : userMessage.content
    setMessages(historyBeforeUser)
    void sendMessage(undefined, nextPrompt, historyBeforeUser, routeOverride)
  }

  function shortenAssistantMessage(message: Message) {
    if (isStreaming || !message.content.trim()) return
    const prompt = `Make this answer shorter while preserving the important details:\n\n${message.content}`
    void sendMessage(undefined, prompt)
  }

  function toggleMessageExpand(id: string) {
    setExpandedMessages(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleQuietMode() {
    setQuietMode(current => {
      const next = !current
      try { localStorage.setItem('ultron-quiet-ui', next ? '1' : '0') } catch { /* ignore */ }
      if (next) setSidebarCollapsed(true)
      return next
    })
  }

  function applyWorkspaceMode(mode: WorkspaceMode) {
    const meta = WORKSPACE_MODES.find(item => item.id === mode) ?? WORKSPACE_MODES[0]
    setWorkspaceMode(mode)
    setAgentMode(meta.agent)
    try { localStorage.setItem('ultron-workspace-mode', mode) } catch { /* ignore */ }
  }

  function stopStreaming() {
    abortRef.current?.abort()
    setIsStreaming(false)
    // Also exit voice conversation mode when the user stops a stream
    if (voiceConvRef.current) {
      voiceConvRef.current = false
      setVoiceConvMode(false)
      window.speechSynthesis.cancel()
    }
  }

  function resetChat() {
    abortRef.current?.abort()
    setMessages([])
    setDraft('')
    setEngineError('')
    currentSessionId.current = null
    atBottomRef.current = true
  }

  const statusLabel = status === 'online' ? 'Ollama online' : status === 'checking' ? 'Checking engine' : 'Ollama offline'
  const workspaceMeta = WORKSPACE_MODES.find(item => item.id === workspaceMode) ?? WORKSPACE_MODES[0]
  const activeQuickActions = WORKSPACE_QUICK_ACTIONS[workspaceMode]
  const commandItems = [
    { group: 'Navigate', label: 'Build Project', hint: 'Open Project Builder', action: () => { applyWorkspaceMode('build'); setShowProjectBuilder(true) } },
    { group: 'Navigate', label: 'Reference Builder', hint: 'Learn a website or screenshot', action: () => { applyWorkspaceMode('research'); setShowReferenceBuilder(true) } },
    { group: 'Navigate', label: 'Health Center', hint: 'Check UI, API, models, and tools', action: () => { applyWorkspaceMode('system'); setShowHealth(true) } },
    { group: 'Navigate', label: 'Tasks', hint: 'Open task dashboard', action: () => setShowTasks(true) },
    { group: 'Navigate', label: 'Memory', hint: 'Open long-term memory', action: () => setShowMemory(true) },
    { group: 'Navigate', label: 'Self-Healer', hint: 'Scan and repair Ultron', action: () => { applyWorkspaceMode('debug'); setShowHealer(true) } },
    { group: 'Navigate', label: 'Connectors', hint: 'Browser and account integrations', action: () => setShowConnectors(true) },
    { group: 'Navigate', label: 'Settings', hint: 'Models, router, context, observation', action: () => setShowSettings(true) },
    { group: 'Workspace', label: 'Chat Mode', hint: 'Clean general assistant workspace', action: () => applyWorkspaceMode('chat') },
    { group: 'Workspace', label: 'Build Mode', hint: 'Project creation and local code actions', action: () => applyWorkspaceMode('build') },
    { group: 'Workspace', label: 'Research Mode', hint: 'Web, reference, and source synthesis', action: () => applyWorkspaceMode('research') },
    { group: 'Workspace', label: 'Debug Mode', hint: 'Errors, tests, and repair loops', action: () => applyWorkspaceMode('debug') },
    { group: 'Workspace', label: 'Review Mode', hint: 'Code review and UX cleanup', action: () => applyWorkspaceMode('review') },
    { group: 'Workspace', label: 'System Mode', hint: 'Health, tasks, memory, connectors', action: () => applyWorkspaceMode('system') },
    { group: 'Compose', label: 'Attach File', hint: 'Add file, code, PDF, or image context', action: () => fileInputRef.current?.click() },
    { group: 'Compose', label: 'Templates', hint: 'Open prompt template library', action: () => setShowTemplates(true) },
    { group: 'Compose', label: 'Focus Composer', hint: 'Jump to the message box', action: () => textareaRef.current?.focus() },
    { group: 'Compose', label: 'Voice Conversation', hint: voiceConvMode ? 'Stop hands-free mode' : 'Start hands-free mode', action: startConversation },
    { group: 'View', label: quietMode ? 'Show Full UI' : 'Show Quiet UI', hint: quietMode ? 'Reveal secondary details' : 'Hide secondary details', action: toggleQuietMode },
    { group: 'View', label: sidebarCollapsed ? 'Show Tools Sidebar' : 'Hide Tools Sidebar', hint: 'Toggle the main tool rail', action: () => setSidebarCollapsed(c => !c) },
    { group: 'View', label: 'Model Compare', hint: 'Run one prompt across local models', action: () => setShowCompare(true), disabled: availableModels.filter(m => !m.includes('embed')).length < 2 },
    { group: 'Chat', label: 'New Chat', hint: 'Clear the current conversation', action: resetChat },
    { group: 'Chat', label: 'Search Conversation', hint: 'Find text in this chat', action: () => setShowSearch(true), disabled: messages.length === 0 },
    { group: 'Chat', label: 'Export Chat', hint: 'Download Markdown transcript', action: exportChat, disabled: messages.length === 0 },
  ]
  const filteredCommands = commandItems.filter(item => {
    const q = commandQuery.trim().toLowerCase()
    if (!q) return true
    return `${item.group} ${item.label} ${item.hint}`.toLowerCase().includes(q)
  })
  const runCommandItem = (item: typeof commandItems[number]) => {
    if (item.disabled) return
    item.action()
    setShowCommandCenter(false)
    setCommandQuery('')
  }
  const latestAgentEvents = [...messages].reverse().find(message => message.role === 'assistant' && message.agentEvents.length > 0)?.agentEvents.slice(-4) ?? []
  const timelineItems = latestAgentEvents.map(describeAgentEvent)
  const workspaceCards = (() => {
    switch (workspaceMode) {
      case 'build':
        return [
          { label: 'Project Builder', detail: 'Templates, plans, install, build, dev server', action: () => setShowProjectBuilder(true) },
          { label: 'Repair Loop', detail: 'Run build checks and feed failures back to Ultron', action: () => { setAgentMode(true); void sendMessage(undefined, 'Run the build, diagnose any errors, and fix them.') } },
          { label: 'Project Plan', detail: 'Turn the idea into files, milestones, and commands', action: () => void sendMessage(undefined, 'Create a concise project plan with file structure, templates, commands, and verification steps.') },
        ]
      case 'research':
        return [
          { label: 'Reference Builder', detail: 'Scan a website or screenshot into a build blueprint', action: () => setShowReferenceBuilder(true) },
          { label: 'Visual Compare', detail: 'Compare generated output against the reference', action: () => setShowReferenceBuilder(true) },
          { label: 'Source Brief', detail: 'Search, verify, and summarize with current context', action: () => { setAgentMode(true); void sendMessage(undefined, 'Research this topic with current sources and give me a verified brief:') } },
        ]
      case 'debug':
        return [
          { label: 'Self-Healer', detail: 'Scan Ultron for errors and propose fixes', action: () => setShowHealer(true) },
          { label: 'Health Center', detail: 'Check UI, API, model, and tool readiness', action: () => setShowHealth(true) },
          { label: 'Run Diagnosis', detail: 'Start with the cheapest failing check', action: () => { setAgentMode(true); void sendMessage(undefined, 'Diagnose the current problem. Start with the cheapest check that can disconfirm the likely cause.') } },
        ]
      case 'review':
        return [
          { label: 'Code Review', detail: 'Bugs, risks, regressions, missing tests', action: () => void sendMessage(undefined, 'Review this code. Lead with bugs, risks, and missing tests:\n\n') },
          { label: 'UX Cleanup', detail: 'Find and remove interface noise', action: () => void sendMessage(undefined, 'Review this UI and identify what to remove, collapse, or clarify:') },
          { label: 'Compare Models', detail: 'Ask every local model for a second opinion', action: () => setShowCompare(true) },
        ]
      case 'system':
        return [
          { label: 'Health', detail: 'API, models, tools, and local readiness', action: () => setShowHealth(true) },
          { label: 'Tasks', detail: 'Daily planner and open work', action: () => setShowTasks(true) },
          { label: 'Memory', detail: 'Long-term facts and project context', action: () => setShowMemory(true) },
        ]
      default:
        return [
          { label: 'Command Center', detail: 'Jump to any Ultron capability', action: () => { setShowCommandCenter(true); setCommandQuery('') } },
          { label: 'Build', detail: 'Create projects and run local checks', action: () => applyWorkspaceMode('build') },
          { label: 'Research', detail: 'Scan references and verify sources', action: () => applyWorkspaceMode('research') },
        ]
    }
  })()

  if (!auth.ready) {
    return <main className="auth-shell"><div className="auth-card"><Loader className="spin" /><p>Loading Ultron identity...</p></div></main>
  }

  if (!auth.user) {
    return <AuthPanel apiBase={API_BASE} configured={auth.configured} onAuthenticated={handleAuthenticated} />
  }

  return (
  <>
    <main className={`app-shell${quietMode ? ' quiet-ui' : ''}`}>
      <section className={`sidebar${sidebarCollapsed ? ' collapsed' : ''}`} aria-label="Assistant controls">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <Bot size={28} />
          </div>
          <div>
            <p className="eyebrow">Local Ollama Engine</p>
            <h1>Ultron</h1>
          </div>
          <button
            type="button"
            className="sidebar-collapse-btn"
            onClick={() => setSidebarCollapsed(c => !c)}
            title="Collapse sidebar (Ctrl+B)"
          >
            <ChevronLeft size={16} />
          </button>
        </div>

        <div className={`status-pill ${status}`}>
          <RadioTower size={16} />
          <span>{statusLabel}</span>
        </div>

        {engineError && <p className="notice">{engineError}</p>}

        {/* Agent mode toggle */}
        <label className="agent-toggle">
          <div className="toggle-track">
            <input
              type="checkbox"
              checked={agentMode}
              onChange={(e) => setAgentMode(e.target.checked)}
            />
            <span className="toggle-thumb" />
          </div>
          <div className="toggle-label">
            <span>
              <Wrench size={14} /> Agent mode
            </span>
            <small>Terminal · apps · files · browser · clipboard · screenshot</small>
          </div>
        </label>

        <div className="sidebar-actions">
          <button type="button" className="sidebar-action-btn" onClick={() => setShowHistory(true)}>
            <Clock size={13} /> History
          </button>
          <button type="button" className="sidebar-action-btn" onClick={() => setShowTemplates(true)}>
            <BookOpen size={13} /> Templates
          </button>
          <button type="button" className="sidebar-action-btn" onClick={() => setShowMemory(true)}>
            <Brain size={13} /> Memory
          </button>
          <button type="button" className="sidebar-action-btn" onClick={() => setShowCredentialVault(true)} title="Credential Vault — local encrypted usernames, emails, passwords, and tokens">
            <KeyRound size={13} /> Vault
          </button>
          <button
            type="button"
            className="sidebar-action-btn"
            onClick={() => setShowTasks(true)}
            title="Task manager — view and create tasks"
          >
            <ListTodo size={13} /> Tasks
            {taskOverdueCount > 0 && (
              <span className="sidebar-task-badge">{taskOverdueCount}</span>
            )}
          </button>
          <button type="button" className="sidebar-action-btn" onClick={() => setShowHealer(true)} title="Self-Healer — scan for TypeScript errors and auto-propose fixes">
            <Zap size={13} /> Heal
          </button>
          <button type="button" className="sidebar-action-btn" onClick={() => setShowHealth(true)} title="Health Command Center">
            <Activity size={13} /> Health
          </button>
          <button type="button" className="sidebar-action-btn" onClick={() => setShowConnectors(true)} title="External Connectors — browser and API integrations">
            <RadioTower size={13} /> Connect
          </button>
          <button type="button" className="sidebar-action-btn" onClick={() => setShowProjectBuilder(true)} title="Project Builder — scaffold, validate, and open programming projects">
            <Code2 size={13} /> Build
          </button>
          <button type="button" className="sidebar-action-btn" onClick={() => setShowReferenceBuilder(true)} title="Reference Builder — learn a public URL or screenshot and create an original build blueprint">
            <Search size={13} /> Learn
          </button>
          <button
            type="button"
            className={`sidebar-action-btn ${showUpgrade ? 'observer-active' : ''}`}
            onClick={() => setShowUpgrade(true)}
            title="Self-Upgrade — Ultron proposes improvements to its own code"
          >
            <Cpu size={13} /> Upgrade
          </button>
          <button
            type="button"
            className={`sidebar-action-btn ${observerStatus?.enabled ? 'observer-active' : ''}`}
            title={observerStatus?.enabled
              ? `Observing every ${observerStatus.intervalSec}s — ${observerStatus.context ? new Date(observerStatus.context.timestamp).toLocaleTimeString() : 'no capture yet'}`
              : 'Screen awareness off — enable in Settings'}
            onClick={() => setShowSettings(true)}
          >
            {observerStatus?.enabled ? <Eye size={13} /> : <EyeOff size={13} />}
            {observerStatus?.enabled ? 'Watching' : 'Blind'}
          </button>
          <button type="button" className="sidebar-action-btn" onClick={() => setShowSettings(true)}>
            <SlidersHorizontal size={13} /> Settings
          </button>
          <button type="button" className="sidebar-action-btn dark-toggle" onClick={toggleDark} title={darkMode ? 'Light mode' : 'Dark mode'}>
            {darkMode ? <Sun size={13} /> : <Moon size={13} />}
            {darkMode ? 'Light' : 'Dark'}
          </button>
        </div>

        {/* Model quick-selector */}
        {availableModels.length > 0 && (
          <div className="model-selector">
            <span className="model-selector-label">Model</span>
            <select
              className="model-select"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
            >
              {availableModels.map(m => {
                const isVision = visionModels.has(m)
                const sizeMatch = m.match(/[:\-](\d+\.?\d*)b/i)
                const sizeTag = sizeMatch ? `${sizeMatch[1]}B` : (m.toLowerCase().includes('embed') ? 'embed' : '')
                return (
                  <option key={m} value={m}>
                    {isVision ? '👁 ' : ''}{m}{sizeTag ? ` [${sizeTag}]` : ''}
                  </option>
                )
              })}
            </select>
            {attachedFiles.some(f => f.kind === 'image') && !visionModels.has(selectedModel) && (
              <p className="vision-hint">
                👁 Image detected — will auto-route to {[...visionModels][0] ?? 'a vision model'}
              </p>
            )}
          </div>
        )}

        <div className="profile-selector">
          <span className="model-selector-label">Intelligence</span>
          <select
            className="model-select"
            value={settings.intelligenceMode}
            onChange={(e) => setIntelligenceMode(e.target.value as IntelligenceMode)}
            disabled={settings.autoIntelligence}
          >
            <option value="instant">Instant — shortest path</option>
            <option value="balanced">Balanced — default</option>
            <option value="deep">Deep — deliberate analysis</option>
            <option value="research">Research — verify and synthesize</option>
          </select>
          {settings.autoIntelligence && <span className="auto-router-hint">Auto chooses per prompt</span>}
        </div>

        <div className="profile-selector">
          <span className="model-selector-label">Answer style</span>
          <div className="answer-style-control" role="group" aria-label="Answer style">
            {(Object.keys(ANSWER_STYLE_LABEL) as AnswerStyle[]).map(style => (
              <button
                key={style}
                type="button"
                className={settings.answerStyle === style ? 'active' : ''}
                onClick={() => setAnswerStyle(style)}
              >
                {ANSWER_STYLE_LABEL[style]}
              </button>
            ))}
          </div>
        </div>

        <div className="identity-card">
          <UserRound size={15} />
          <div>
            <strong>{auth.user.displayName}</strong>
            <span>{auth.user.email}</span>
          </div>
          <button type="button" onClick={() => void logout()} title="Sign out of Ultron" aria-label="Sign out of Ultron"><LogOut size={13} /></button>
        </div>

      </section>

      <section className="chat-panel" aria-label="Chat with Ultron">
        {!quietMode && observerStatus?.enabled && observerStatus.context && (
          <div className="observer-bar">
            <Eye size={11} />
            <span>
              <strong>{observerStatus.context.activeApp}</strong>
              {observerStatus.context.browserTabs.length > 0 && (
                <> &mdash; {observerStatus.context.browserTabs.slice(0, 4).map(t => t.title).join(' · ')}</>
              )}
              {observerStatus.context.visionSummary && (
                <> &mdash; {observerStatus.context.visionSummary.slice(0, 80)}&hellip;</>
              )}
            </span>
          </div>
        )}
        <header className="chat-header">
          <div>
            <p className="eyebrow">{agentMode ? 'Agent workspace' : 'Assistant workspace'}</p>
            <h2>{workspaceMeta.headline}</h2>
            <div className="workspace-switcher" role="tablist" aria-label="Workspace mode">
              {WORKSPACE_MODES.map(mode => (
                <button
                  key={mode.id}
                  type="button"
                  role="tab"
                  aria-selected={workspaceMode === mode.id}
                  className={workspaceMode === mode.id ? 'active' : ''}
                  onClick={() => applyWorkspaceMode(mode.id)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>
          <div className="chat-header-actions">
            <button type="button" className="export-btn command-trigger-btn" onClick={() => { setShowCommandCenter(true); setCommandQuery('') }} title="Command Center (Ctrl+K)">
              <Search size={14} />
              Command
            </button>
            {sidebarCollapsed && (
              <button type="button" className="export-btn" onClick={() => setSidebarCollapsed(false)} title="Show sidebar (Ctrl+B)" aria-label="Show tools sidebar">
                <ChevronRight size={14} />
                {quietMode && <span>Tools</span>}
              </button>
            )}
            {artifact && (
              <button type="button" className="export-btn artifact-btn" onClick={() => setArtifact(null)} title="Close artifact panel">
                <Code2 size={14} />
                Artifact ✕
              </button>
            )}
            {!quietMode && messages.length > 0 && (
              <button type="button" className="export-btn" onClick={() => setShowSearch(s => !s)} title="Search (Ctrl+F)">
                <Search size={14} />
              </button>
            )}
            {!quietMode && messages.length > 0 && (
              <button type="button" className="export-btn" onClick={exportChat} title="Export as Markdown">
                <Download size={14} />
                Export
              </button>
            )}
            {!quietMode && availableModels.filter(m => !m.includes('embed')).length > 1 && (
              <button
                type="button"
                className={`export-btn compare-trigger-btn ${showCompare ? 'active' : ''}`}
                onClick={() => setShowCompare(c => !c)}
                title="Model Compare (Ctrl+M) — run prompt on all models simultaneously"
              >
                <Scale size={14} />
                Compare
              </button>
            )}
            <button type="button" className={`export-btn quiet-toggle-btn ${quietMode ? 'active' : ''}`} onClick={toggleQuietMode} title={quietMode ? 'Show full interface detail' : 'Hide secondary interface detail'}>
              {quietMode ? <EyeOff size={14} /> : <Eye size={14} />}
              {quietMode ? 'Quiet' : 'Full'}
            </button>
            <button type="button" className="ghost-button" onClick={resetChat}>
              New chat
            </button>
          </div>
        </header>

        {timelineItems.length > 0 && (
          <div className="action-timeline" aria-label="Recent action timeline">
            {timelineItems.map((item, index) => (
              <div key={`${item.label}-${index}`} className="action-timeline-step">
                <span className="action-dot" />
                <div>
                  <strong>{item.label}</strong>
                  <span>{item.detail}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Search bar */}
        {showSearch && (
          <div className="search-bar">
            <Search size={14} className="search-icon" />
            <input
              autoFocus
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search in conversation..."
              className="search-input"
            />
            {searchQuery && (
              <span className="search-count">
                {deferredMessages.filter(m => m.content.toLowerCase().includes(searchQuery.toLowerCase())).length} match(es)
              </span>
            )}
            <button type="button" className="search-close" onClick={() => { setShowSearch(false); setSearchQuery('') }}>
              <X size={14} />
            </button>
          </div>
        )}

        <div
          className="message-list"
          ref={messageListRef}
          onScroll={() => {
            const el = messageListRef.current
            if (!el) return
            const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
            atBottomRef.current = atBottom
            setShowScrollBottom(!atBottom)
          }}
        >
          {deferredMessages.length === 0 ? (
            <div className="welcome-state">
              <div className="welcome-brand">
                <div className="welcome-icon-wrap"><Bot size={30} /></div>
                <div className="welcome-hero-text">
                  <h2>{getGreeting()} How can I help?</h2>
                  <div className="welcome-badges">
                    <span className="welcome-badge badge-private">🔒 Private</span>
                    <span className="welcome-badge badge-local">🧠 {selectedModel.split(':')[0] || 'Ollama'}</span>
                    <span className="welcome-badge badge-mode">{INTELLIGENCE_LABEL[settings.intelligenceMode]}</span>
                    {agentMode && <span className="welcome-badge badge-agent">⚡ Agent</span>}
                    {observerStatus?.enabled && <span className="welcome-badge badge-obs">👁 Watching</span>}
                  </div>
                </div>
              </div>
              <div className="workspace-dashboard" aria-label={`${workspaceMeta.label} dashboard`}>
                {workspaceCards.map(card => (
                  <button key={card.label} type="button" className="workspace-card" onClick={card.action}>
                    <span>{card.label}</span>
                    <small>{card.detail}</small>
                  </button>
                ))}
              </div>
              <div className="quick-actions">
                {activeQuickActions.map((action) => (
                  <button
                    key={`${workspaceMode}-${action.label}`}
                    type="button"
                    className="quick-action-card"
                    onClick={() => sendMessage(undefined, action.prompt)}
                  >
                    <span className="quick-action-emoji">{action.emoji}</span>
                    <div className="quick-action-text">
                      <span className="quick-action-label">{action.label}</span>
                      {'desc' in action && action.desc && <span className="quick-action-desc">{action.desc}</span>}
                    </div>
                  </button>
                ))}
              </div>
              {recentChats.length > 0 && (
                <div className="recent-chats">
                  <p className="recent-chats-label">Continue a conversation</p>
                  <div className="recent-chat-list">
                    {recentChats.map(s => (
                      <button key={s.id} type="button" className="recent-chat-card" onClick={() => void loadHistory(s.id)}>
                        <span className="recent-chat-title">{s.title}</span>
                        <div className="recent-chat-foot">
                          <span className="recent-chat-model">{s.model.split(':')[0]}</span>
                          <span className="recent-chat-time">{relativeTime(s.updatedAt)}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            deferredMessages.map((message, msgIdx) => (
              <article key={message.id} className={`message ${message.role}${searchQuery && !message.content.toLowerCase().includes(searchQuery.toLowerCase()) ? ' search-dimmed' : ''}${searchQuery && message.content.toLowerCase().includes(searchQuery.toLowerCase()) ? ' search-match' : ''}`}>
                <div className="avatar" aria-hidden="true">
                  {message.role === 'assistant' ? <Bot size={18} /> : <UserRound size={18} />}
                </div>
                <div className="message-bubble">
                  <span>{message.role === 'assistant' ? 'Ultron' : 'You'}</span>
                  {!quietMode && message.agentEvents.length > 0 && <AgentTrace events={message.agentEvents} />}
                  {!quietMode && message.role === 'assistant' && message.route && (
                    <details className="route-decision" title="Why Ultron chose this mode">
                      <summary className="route-decision-summary">
                        <span className={`route-mode ${message.route.useAgent ? 'agent' : 'chat'}`}>{message.route.useAgent ? 'Agent' : 'Chat'}</span>
                        <span>{INTELLIGENCE_LABEL[message.route.intelligenceMode]}</span>
                        <span>{Math.round(message.route.confidence * 100)}%</span>
                      </summary>
                      <div className="route-decision-detail">
                        <p>{message.route.reason}</p>
                        {message.route.signals.length > 0 && (
                          <div className="route-signals">
                            {message.route.signals.map(signal => <span key={signal}>{signal}</span>)}
                          </div>
                        )}
                        <div className="route-scores" aria-label="Router score breakdown">
                          {ROUTE_SCORE_LABELS.map(([scoreKey, label]) => (
                            <span key={scoreKey}>{label}: {message.route?.scores[scoreKey] ?? 0}</span>
                          ))}
                        </div>
                        <div className="route-actions">
                          <button type="button" onClick={() => rerunFromAssistant(message.id, { useAgent: true })} disabled={isStreaming}>Rerun as Agent</button>
                          <button type="button" onClick={() => rerunFromAssistant(message.id, { useAgent: false })} disabled={isStreaming}>Rerun as Chat</button>
                          <button type="button" onClick={() => rerunFromAssistant(message.id, { intelligenceMode: 'deep' })} disabled={isStreaming}>Rerun as Deep</button>
                          <button type="button" onClick={() => rerunFromAssistant(message.id, { useAgent: true, intelligenceMode: 'research' })} disabled={isStreaming}>Rerun as Research</button>
                          <button type="button" onClick={() => rerunFromAssistant(message.id, { useAgent: true, intelligenceMode: 'deep' }, 'Verify this with tools and correct anything uncertain:')} disabled={isStreaming}>Verify with tools</button>
                          <button type="button" onClick={() => shortenAssistantMessage(message)} disabled={isStreaming}>Make shorter</button>
                        </div>
                      </div>
                    </details>
                  )}
                  {message.role === 'assistant' && message.content ? (() => {
                    const lineCount = message.content.split('\n').length
                    const isLong = !isStreaming && (lineCount > 55 || message.content.length > 2800)
                    const expanded = expandedMessages.has(message.id)
                    return (
                      <>
                        <div className={`msg-body-wrap ${isLong && !expanded ? 'msg-body-collapsed' : ''}`}>
                          <MessageContent
                            content={message.content}
                            streaming={isStreaming && msgIdx === deferredMessages.length - 1}
                            onImageClick={url => setLightboxUrl(url)}
                          />
                          {isLong && !expanded && <div className="msg-body-fade" />}
                        </div>
                        {isLong && (
                          <button type="button" className="msg-expand-btn" onClick={() => toggleMessageExpand(message.id)}>
                            {expanded ? '\u2191 Collapse' : `\u2193 Show full response (${lineCount} lines)`}
                          </button>
                        )}
                      </>
                    )
                  })() : message.role === 'user' && message.content ? (() => {
                    const lineCount = message.content.split('\n').length
                    const isLong = lineCount > 12 || message.content.length > 500
                    const expanded = expandedMessages.has(message.id)
                    return (
                      <>
                        {messageImages.get(message.id)?.map((url, i) => (
                          <img key={i} src={url} alt="Attached" className="msg-image-thumb" onClick={() => setLightboxUrl(url)} style={{ cursor: 'zoom-in' }} />
                        ))}
                        <div className={`msg-body-wrap ${isLong && !expanded ? 'msg-body-collapsed msg-body-collapsed-user' : ''}`}>
                          <MessageContent content={message.content} onImageClick={url => setLightboxUrl(url)} />
                          {isLong && !expanded && <div className="msg-body-fade msg-body-fade-user" />}
                        </div>
                        {isLong && (
                          <button type="button" className="msg-expand-btn msg-expand-btn-user" onClick={() => toggleMessageExpand(message.id)}>
                            {expanded ? '\u2191 Collapse' : `\u2193 Show full message (${lineCount} lines)`}
                          </button>
                        )}
                      </>
                    )
                  })() : message.agentEvents.length === 0 ? (
                    <div className="typing-dots" aria-label="Thinking">
                      <span /><span /><span />
                    </div>
                  ) : null}

                  {/* Follow-up suggestions + Ultron's clarifying questions */}
                  {message.role === 'assistant' && message.followups && message.followups.filter(q => !quietMode || q.startsWith('ASK: ')).length > 0 && (
                    <div className="followup-chips">
                      {message.followups.filter(q => !quietMode || q.startsWith('ASK: ')).map((q) => {
                        const isAsk = q.startsWith('ASK: ')
                        const label = isAsk ? q.slice(5) : q
                        return isAsk ? (
                          <div key={q} className="ultron-question">
                            <span className="ultron-question-label">Ultron asks:</span>
                            <span className="ultron-question-text">{label}</span>
                          </div>
                        ) : (
                          <button
                            key={q}
                            type="button"
                            className="followup-chip"
                            onClick={() => sendMessage(undefined, q)}
                            disabled={isStreaming}
                          >
                            {q}
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {/* Predictive action cards — what Ultron can proactively do next */}
                  {!quietMode && message.role === 'assistant' && message.predictions && message.predictions.length > 0 && (
                    <div className="prediction-cards">
                      <span className="prediction-header">What I can do next</span>
                      {message.predictions.map(p => (
                        <button
                          key={p.label}
                          type="button"
                          className="prediction-card"
                          disabled={isStreaming}
                          title="Click to approve and run in agent mode"
                          onClick={() => {
                            if (!isStreaming) {
                              setAgentMode(true)
                              void sendMessage(undefined, p.prompt)
                            }
                          }}
                        >
                          <span className="prediction-emoji">{p.emoji}</span>
                          <div className="prediction-content">
                            <span className="prediction-name">{p.label}</span>
                            <span className="prediction-desc">{p.prompt}</span>
                          </div>
                          <span className="prediction-run">▶ Run</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Message action buttons */}
                  {message.content && (
                    <div className="message-actions">
                      {message.role === 'assistant' && (
                        <button
                          type="button"
                          className={`msg-action-btn ${copiedId === message.id ? 'copied' : ''}`}
                          onClick={() => copyMessage(message.id, message.content)}
                          title="Copy response"
                        >
                          <Copy size={11} />
                          {copiedId === message.id ? 'Copied!' : 'Copy'}
                        </button>
                      )}
                      {message.role === 'assistant' && (
                        <button
                          type="button"
                          className={`msg-action-btn ${speakingId === message.id ? 'active' : ''}`}
                          onClick={() => speakMessage(message.id, message.content)}
                          title={speakingId === message.id ? 'Stop reading' : 'Read aloud'}
                        >
                          {speakingId === message.id ? <VolumeX size={11} /> : <Volume2 size={11} />}
                          {speakingId === message.id ? 'Stop' : 'Read'}
                        </button>
                      )}
                      {message.role === 'user' && !isStreaming && (
                        <button
                          type="button"
                          className="msg-action-btn"
                          onClick={() => editMessage(message.id)}
                          title="Edit message"
                        >
                          <Pencil size={11} />
                          Edit
                        </button>
                      )}
                      {message.timestamp && (
                        <span className="msg-time">{relativeTime(message.timestamp)}</span>
                      )}
                    </div>
                  )}

                  {/* Message actions: feedback + regenerate (metrics removed for cleaner UI) */}
                  {message.role === 'assistant' && (message.metrics || (!isStreaming && msgIdx === deferredMessages.length - 1)) && (
                    <div className="message-footer">
                      <div style={{ display: 'flex', gap: 4, marginLeft: 'auto', alignItems: 'center' }}>
                        <button
                          type="button"
                          className={`feedback-btn ${feedback.get(message.id) === 'up' ? 'active-up' : ''}`}
                          onClick={() => toggleFeedback(message.id, 'up')}
                          title="Good response"
                        >
                          <ThumbsUp size={11} />
                        </button>
                        <button
                          type="button"
                          className={`feedback-btn ${feedback.get(message.id) === 'down' ? 'active-down' : ''}`}
                          onClick={() => toggleFeedback(message.id, 'down')}
                          title="Bad response"
                        >
                          <ThumbsDown size={11} />
                        </button>
                        {!isStreaming && msgIdx === deferredMessages.length - 1 && (
                          <button type="button" className="regen-btn" onClick={regenerate} title="Regenerate response">
                            <RefreshCw size={12} />
                            <span>Regenerate</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </article>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {pendingQuestion && (
          <div className={`question-prompt ${pendingQuestion.kind === 'permission' ? 'permission-prompt' : ''}`}>
            <p className="question-label">{pendingQuestion.kind === 'permission' ? 'Permission required' : 'Ultron is asking:'}</p>
            <p className="question-text">{pendingQuestion.question}</p>
            {pendingQuestion.context && <p className="question-context">{pendingQuestion.context}</p>}
            {pendingQuestion.kind === 'permission' ? (
              <div className="permission-actions">
                <button type="button" className="permission-allow" onClick={() => void submitAnswer(undefined, 'ALLOW')}>Allow</button>
                <button type="button" className="permission-deny" onClick={() => void submitAnswer(undefined, 'DENY')}>Deny</button>
              </div>
            ) : (
              <form className="question-form" onSubmit={(e) => { void submitAnswer(e) }}>
                <input
                  autoFocus
                  value={questionDraft}
                  onChange={(e) => setQuestionDraft(e.target.value)}
                  placeholder="Type your answer…"
                  className="question-input"
                />
                {pendingQuestion.mode === 'project_setup' && (
                  <button type="button" className="question-folder-button" onClick={() => void chooseQuestionDestinationFolder()} disabled={questionFolderLoading}>
                    {questionFolderLoading ? <Loader size={14} className="spin" /> : <FolderOpen size={14} />}
                    Choose folder
                  </button>
                )}
                <button type="submit" className="icon-button" disabled={!questionDraft.trim()}>
                  <Send size={16} />
                </button>
              </form>
            )}
          </div>
        )}
        <div style={{ position: 'relative' }}>
          {/* Voice conversation mode banner */}
          {voiceConvMode && (
            <div className="conv-mode-bar">
              <PhoneCall size={13} />
              {isListening ? 'Listening… speak now' : isStreaming ? 'Generating response…' : 'Voice conversation active — speak to send, Ultron replies aloud'}
              <button
                type="button"
                style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 14, padding: '0 2px' }}
                onClick={startConversation}
                title="Exit conversation mode"
              >
                ✕
              </button>
            </div>
          )}
          {/* Slash command menu */}
          {slashMenu !== null && (() => {
            const filtered = SLASH_COMMANDS.filter(c =>
              c.cmd.startsWith(slashMenu) || c.label.toLowerCase().includes(slashMenu.toLowerCase())
            )
            if (!filtered.length) return null
            return (
              <div className="slash-menu">
                {filtered.slice(0, 8).map((cmd, i) => (
                  <button
                    key={cmd.cmd}
                    type="button"
                    className={`slash-item ${i === slashIdx ? 'selected' : ''}`}
                    onMouseEnter={() => setSlashIdx(i)}
                    onClick={() => {
                      setDraft(cmd.prompt)
                      setSlashMenu(null)
                      setTimeout(() => { textareaRef.current?.focus(); autoResizeTextarea() }, 0)
                    }}
                  >
                    <span className="slash-emoji">{cmd.emoji}</span>
                    <span className="slash-label">{cmd.label}</span>
                    <span className="slash-cmd">/{cmd.cmd}</span>
                  </button>
                ))}
              </div>
            )
          })()}
          <form
            className={`composer ${isDragging ? 'drag-over' : ''}`}
            onSubmit={(event) => sendMessage(event)}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragging(false); void attachFiles(Array.from(e.dataTransfer.files)) }}
          >
          {/* Attachment pills */}
          {attachedFiles.length > 0 && (
            <div className="attachment-pills">
              {attachedFiles.map(f => (
                <div key={f.id} className="attachment-pill">
                  {f.kind === 'image'
                    ? <img src={f.content} alt={f.name} className="attachment-thumb" />
                    : <Paperclip size={11} />}
                  <span>{f.name}</span>
                  <button type="button" className="attachment-remove" onClick={() => removeAttachment(f.id)}>
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {quietMode && showComposerTools && (
            <div className="composer-tool-tray" role="toolbar" aria-label="Composer tools">
              <button type="button" onClick={() => setShowTemplates(true)}><BookOpen size={14} /> Templates</button>
              <button type="button" onClick={() => fileInputRef.current?.click()}><Paperclip size={14} /> Attach</button>
              {draft.trim().length > 8 && (
                <button type="button" onClick={preEnhanceDraft !== null ? undoEnhance : () => void enhancePrompt()} disabled={isStreaming || enhancing}>
                  {enhancing ? <Loader size={14} className="spin" /> : <Wand2 size={14} />}
                  {preEnhanceDraft !== null ? 'Undo' : 'Enhance'}
                </button>
              )}
              <button type="button" onClick={voiceConvMode ? startConversation : _doToggleVoice}>{isListening ? <MicOff size={14} /> : <Mic size={14} />} Voice</button>
              <button type="button" onClick={startConversation}>{voiceConvMode ? <PhoneOff size={14} /> : <PhoneCall size={14} />} Conversation</button>
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => {
              const v = event.target.value
              setDraft(v)
              autoResizeTextarea()
              // Slash command detection
              if (v.startsWith('/') && !v.includes('\n') && !v.includes(' ')) {
                setSlashMenu(v.slice(1).toLowerCase())
                setSlashIdx(0)
              } else {
                setSlashMenu(null)
              }
            }}
            onKeyDown={(event) => {
              // Slash menu navigation
              if (slashMenu !== null) {
                const filtered = SLASH_COMMANDS.filter(c =>
                  c.cmd.startsWith(slashMenu) || c.label.toLowerCase().includes(slashMenu.toLowerCase())
                ).slice(0, 8)
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setSlashIdx(i => Math.min(i + 1, filtered.length - 1))
                  return
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setSlashIdx(i => Math.max(i - 1, 0))
                  return
                }
                if (event.key === 'Enter' && filtered[slashIdx]) {
                  event.preventDefault()
                  setDraft(filtered[slashIdx].prompt)
                  setSlashMenu(null)
                  setTimeout(() => autoResizeTextarea(), 0)
                  return
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setSlashMenu(null)
                  return
                }
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void sendMessage()
              }
              // ↑/↓ to navigate prompt history (like terminal)
              if (event.key === 'ArrowUp' && !draft && slashMenu === null) {
                event.preventDefault()
                const next = historyIdxRef.current + 1
                if (next < sentHistoryRef.current.length) {
                  historyIdxRef.current = next
                  setDraft(sentHistoryRef.current[next])
                  setTimeout(() => autoResizeTextarea(), 0)
                }
              }
              if (event.key === 'ArrowDown' && historyIdxRef.current >= 0 && slashMenu === null) {
                event.preventDefault()
                const next = historyIdxRef.current - 1
                historyIdxRef.current = next
                setDraft(next >= 0 ? sentHistoryRef.current[next] : '')
                setTimeout(() => autoResizeTextarea(), 0)
              }
            }}
            onPaste={(e) => { void onComposerPaste(e) }}
            placeholder={`${workspaceMeta.placeholder} (Enter to send, Shift+Enter for newline)`}
            rows={1}
          />
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="text/*,.ts,.tsx,.js,.jsx,.py,.md,.json,.yaml,.yml,.css,.html,.sh,.ps1,.go,.rb,.rs,.java,.c,.cpp,.h,.sql,.xml,.toml,.env,.pdf,image/*"
            style={{ display: 'none' }}
            onChange={e => { void attachFiles(Array.from(e.target.files ?? [])); e.target.value = '' }}
          />
          {quietMode ? (
            <button
              type="button"
              className={`icon-button attach-btn composer-tools-toggle ${showComposerTools ? 'active' : ''}`}
              onClick={() => setShowComposerTools(v => !v)}
              aria-label="Composer tools"
              title="Composer tools"
            >
              <Wrench size={16} />
            </button>
          ) : (
            <>
          <button
            type="button"
            className="icon-button attach-btn"
            onClick={() => setShowTemplates(true)}
            aria-label="Templates"
            title="Prompt templates"
          >
            <BookOpen size={16} />
          </button>
          <button
            type="button"
            className="icon-button attach-btn"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach file"
            title="Attach file or drag &amp; drop"
          >
            <Paperclip size={16} />
          </button>
          {draft.trim().length > 8 && (
            <button
              type="button"
              className={`icon-button enhance-btn ${preEnhanceDraft !== null ? 'enhanced' : ''}`}
              onClick={preEnhanceDraft !== null ? undoEnhance : () => void enhancePrompt()}
              title={preEnhanceDraft !== null ? 'Undo enhancement — restore original draft' : 'Enhance prompt — AI improves your message for better results'}
              disabled={isStreaming || enhancing}
            >
              {enhancing ? <Loader size={15} className="spin" /> : <Wand2 size={15} />}
            </button>
          )}
          <button
            type="button"
            className={`icon-button voice-btn ${isListening ? 'listening' : ''}`}
            onClick={voiceConvMode ? startConversation : _doToggleVoice}
            aria-label={isListening ? 'Stop listening' : 'Voice input'}
          >
            {isListening ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
          <button
            type="button"
            className={`icon-button conv-btn ${voiceConvMode ? 'conv-active' : ''}`}
            onClick={startConversation}
            title={voiceConvMode ? 'Stop conversation mode' : 'Start voice conversation — Ultron listens, responds, and speaks back automatically'}
          >
            {voiceConvMode ? <PhoneOff size={16} /> : <PhoneCall size={16} />}
          </button>
            </>
          )}
          {isStreaming ? (
            <button type="button" className="icon-button stop" onClick={stopStreaming} aria-label="Stop response">
              <Square size={18} />
            </button>
          ) : (
            <button type="submit" className="icon-button" disabled={!draft.trim()} aria-label="Send message">
              <Send size={18} />
            </button>
          )}
        </form>
        {!quietMode && (
          <p className="kbd-hint">
            <kbd>Enter</kbd> send &nbsp;·&nbsp; <kbd>/</kbd> slash &nbsp;·&nbsp; <kbd>↑/↓</kbd> history &nbsp;·&nbsp; <kbd>Ctrl+N</kbd> new &nbsp;·&nbsp; <kbd>Ctrl+B</kbd> sidebar &nbsp;·&nbsp; <kbd>?</kbd> help
            {draft.length > 40 && <>&nbsp;·&nbsp;<span className="token-est">~{Math.ceil(draft.length / 4)} tok</span></>}
          </p>
        )}
        </div>
      </section>
    </main>

    {/* Scroll-to-bottom FAB */}
    {showScrollBottom && (
      <button
        type="button"
        className="scroll-bottom-fab"
        onClick={() => {
          atBottomRef.current = true
          setShowScrollBottom(false)
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
        }}
        aria-label="Scroll to bottom"
      >
        ↓
      </button>
    )}

    {/* Toast notifications */}
    {toasts.length > 0 && (
      <div className="toast-stack" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <span>{t.message}</span>
            <button type="button" onClick={() => setToasts(p => p.filter(x => x.id !== t.id))} aria-label="Dismiss">×</button>
          </div>
        ))}
      </div>
    )}

    {showCommandCenter && (
      <div className="command-overlay" onClick={() => setShowCommandCenter(false)}>
        <div className="command-center" onClick={e => e.stopPropagation()}>
          <div className="command-search-row">
            <Search size={16} />
            <input
              autoFocus
              value={commandQuery}
              onChange={event => setCommandQuery(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  const first = filteredCommands.find(item => !item.disabled)
                  if (first) runCommandItem(first)
                }
                if (event.key === 'Escape') setShowCommandCenter(false)
              }}
              placeholder="Command Center..."
            />
            <kbd>Ctrl K</kbd>
          </div>
          <div className="command-list">
            {filteredCommands.length > 0 ? filteredCommands.map(item => (
              <button key={`${item.group}-${item.label}`} type="button" className="command-item" disabled={item.disabled} onClick={() => runCommandItem(item)}>
                <span className="command-group">{item.group}</span>
                <span className="command-label">{item.label}</span>
                <span className="command-hint">{item.hint}</span>
              </button>
            )) : (
              <div className="command-empty">No command found</div>
            )}
          </div>
        </div>
      </div>
    )}

    {/* Keyboard help modal */}
    {showHelp && (
      <div className="help-overlay" onClick={() => setShowHelp(false)}>
        <div className="help-modal" onClick={e => e.stopPropagation()}>
          <div className="help-header">
            <span>⌨ Keyboard Shortcuts</span>
            <button type="button" onClick={() => setShowHelp(false)} className="help-close">×</button>
          </div>
          <table className="help-table">
            <tbody>
              {KEYBOARD_SHORTCUTS.map(s => (
                <tr key={s.key}>
                  <td><kbd className="help-kbd">{s.key}</kbd></td>
                  <td>{s.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="help-footer">
            <strong>/cmd</strong> — type <kbd className="help-kbd">/</kbd> to open the slash command menu with 15 prompt shortcuts
          </div>
        </div>
      </div>
    )}

    {/* Image lightbox */}
    {lightboxUrl && (
      <div className="lightbox-overlay" onClick={() => setLightboxUrl(null)}>
        <img src={lightboxUrl} alt="Full size preview" className="lightbox-image" onClick={e => e.stopPropagation()} />
        <button type="button" className="lightbox-close" onClick={() => setLightboxUrl(null)}>×</button>
      </div>
    )}

    {showHistory && (
      <HistoryPanel
        apiBase={API_BASE}
        onLoad={(msgs, model) => {
          currentSessionId.current = null
          // Back-fill timestamp for messages loaded from history
          setMessages(msgs.map(m => ({ ...m, timestamp: m.timestamp ?? 0 })))
          if (model) setSelectedModel(model)
        }}
        onClose={() => setShowHistory(false)}
      />
    )}
    {showTemplates && (
      <TemplatesPanel
        onSelect={(prompt) => {
          setDraft(prompt)
          setTimeout(() => { textareaRef.current?.focus(); autoResizeTextarea() }, 0)
        }}
        onClose={() => setShowTemplates(false)}
        currentDraft={draft}
      />
    )}
    {showMemory && (
      <MemoryPanel
        apiBase={API_BASE}
        onClose={() => setShowMemory(false)}
      />
    )}
    {showCredentialVault && (
      <CredentialVaultPanel
        apiBase={API_BASE}
        token={auth.token}
        onClose={() => setShowCredentialVault(false)}
      />
    )}
    {showHealer && (
      <HealerPanel
        apiBase={API_BASE}
        onClose={() => setShowHealer(false)}
      />
    )}
    {showHealth && (
      <HealthPanel
        apiBase={API_BASE}
        onClose={() => setShowHealth(false)}
      />
    )}
    {showCompare && (
      <ComparePanel
        models={availableModels}
        settings={settings}
        initialDraft={draft}
        onClose={() => setShowCompare(false)}
      />
    )}
    {showTasks && (
      <TaskPanel
        apiBase={API_BASE}
        onClose={() => { setShowTasks(false); reloadTaskCount() }}
      />
    )}
    {showConnectors && (
      <ConnectorsPanel
        apiBase={API_BASE}
        onClose={() => setShowConnectors(false)}
      />
    )}
    {showProjectBuilder && (
      <ProjectBuilderPanel
        apiBase={API_BASE}
        onClose={() => setShowProjectBuilder(false)}
      />
    )}
    {showReferenceBuilder && (
      <ReferenceBuilderPanel
        apiBase={API_BASE}
        onUsePrompt={(prompt) => {
          setDraft(prompt)
          setAgentMode(true)
          setTimeout(() => { textareaRef.current?.focus(); autoResizeTextarea() }, 0)
        }}
        onClose={() => setShowReferenceBuilder(false)}
      />
    )}
    {showUpgrade && (
      <SelfUpgradePanel
        currentModel={selectedModel}
        onClose={() => setShowUpgrade(false)}
      />
    )}
    {showSettings && (
      <SettingsPanel
        settings={settings}
        onChange={updateSettings}
        onClose={() => setShowSettings(false)}
        models={availableModels}
      />
    )}
    <PreviewPanel />

    {/* Artifacts panel */}
    {artifact && (
      <div className="artifact-panel">
        <div className="artifact-header">
          <div className="artifact-title">
            <Code2 size={14} />
            <span>Artifact — {artifact.lang}</span>
          </div>
          <div className="artifact-actions">
            <button
              type="button"
              className="artifact-action-btn"
              onClick={() => void navigator.clipboard.writeText(artifact.code)}
              title="Copy code"
            >
              <Copy size={12} /> Copy
            </button>
            <a
              className="artifact-action-btn"
              href={`data:text/html;charset=utf-8,${encodeURIComponent(artifact.srcDoc)}`}
              target="_blank"
              rel="noopener noreferrer"
              title="Open in new tab"
            >
              ↗ Open
            </a>
            <button type="button" className="artifact-action-btn artifact-close" onClick={() => setArtifact(null)}>
              <X size={12} /> Close
            </button>
          </div>
        </div>
        <iframe
          key={artifact.srcDoc}
          sandbox="allow-scripts allow-same-origin"
          srcDoc={artifact.srcDoc}
          title="Artifact preview"
          className="artifact-iframe"
        />
      </div>
    )}
  </>
  )
}

export default App
