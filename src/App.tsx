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
import { HealerPanel } from './components/HealerPanel'
import { MessageContent } from './components/MessageContent'
import { HistoryPanel } from './components/HistoryPanel'
import { MemoryPanel } from './components/MemoryPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { TemplatesPanel } from './components/TemplatesPanel'
import { PreviewPanel } from './components/PreviewPanel'
import type { AgentEvent, AppSettings, AttachedFile, Message, ObserverStatus, PendingQuestion } from './types'
import './App.css'

type EngineStatus = 'checking' | 'online' | 'offline'

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem('ultron-settings')
    if (raw) {
      const parsed = JSON.parse(raw) as AppSettings
      // Back-fill defaults for fields added after initial save
      return { temperature: 0.35, maxIterations: 20, systemPrompt: '', fastModel: '', observationEnabled: true, observationMode: 'fast', observationIntervalSec: 45, domainExpertise: '', numCtx: 8192, ...parsed }
    }
  } catch { /* ignore */ }
  return { temperature: 0.35, maxIterations: 20, systemPrompt: '', fastModel: '', observationEnabled: true, observationMode: 'fast', observationIntervalSec: 45, domainExpertise: '', numCtx: 8192 }
}

function loadDarkMode(): boolean {
  try { return localStorage.getItem('ultron-dark') === '1' } catch { return false }
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
  { key: 'Ctrl+K',      desc: 'Focus composer' },
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

const QUICK_ACTIONS = [
  { emoji: '💻', label: 'Review my code', prompt: 'Review the code I\'m working on and suggest improvements.' },
  { emoji: '🔍', label: 'Search the web', prompt: 'Search the web for: ' },
  { emoji: '🐛', label: 'Debug an error', prompt: 'Help me debug this error:\n\n' },
  { emoji: '📝', label: 'Explain this', prompt: 'Explain this clearly:\n\n' },
  { emoji: '⚙️', label: 'System stats', prompt: 'Show my system stats (CPU, RAM, disk, running processes).' },
  { emoji: '🌐', label: 'Summarize URL', prompt: 'Fetch and summarize the content of: ' },
]

const AGENT_QUICK_ACTIONS = [
  { emoji: '📂', label: 'Explore project', prompt: 'List this project\'s files and summarise what each top-level folder does.' },
  { emoji: '🔨', label: 'Build & fix errors', prompt: 'Run the build, find any errors, and fix them.' },
  { emoji: '🌐', label: 'Latest Ollama news', prompt: 'Search the web for the latest Ollama model releases and tell me which ones to pull.' },
  { emoji: '📊', label: 'System monitor', prompt: 'Show my system stats and top CPU/RAM processes.' },
  { emoji: '🧠', label: 'Recall memories', prompt: 'List everything you remember about me and my projects.' },
  { emoji: '📋', label: 'Daily briefing', prompt: 'Give me my daily briefing — tasks, schedule, and anything I should know.' },
]

const starterPrompts: string[] = [] // kept for reference; welcome screen uses QUICK_ACTIONS
const agentStarterPrompts: string[] = []

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
  const [showHistory, setShowHistory] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
  const [isListening, setIsListening] = useState(false)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [visionModels, setVisionModels] = useState<Set<string>>(new Set())
  const [observerStatus, setObserverStatus] = useState<ObserverStatus | null>(null)
  const [darkMode, setDarkMode] = useState<boolean>(loadDarkMode)
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Array<{ id: string; message: string; type: 'success' | 'error' | 'info' }>>([])
  const [showScrollBottom, setShowScrollBottom] = useState(false)
  const [messageImages, setMessageImages] = useState<Map<string, string[]>>(new Map())
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [artifact, setArtifact] = useState<{ lang: string; code: string; srcDoc: string } | null>(null)
  const [showTemplates, setShowTemplates] = useState(false)
  const [showMemory, setShowMemory] = useState(false)
  const [showHealer, setShowHealer] = useState(false)
  const [recentChats, setRecentChats] = useState<HistoryMeta[]>([])
  const [feedback, setFeedback] = useState<Map<string, 'up' | 'down'>>(new Map())
  const [slashMenu, setSlashMenu] = useState<string | null>(null)
  const [slashIdx, setSlashIdx] = useState(0)
  const [showHelp, setShowHelp] = useState(false)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const sendTimeRef = useRef<number | null>(null)
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

    return () => {
      isMounted = false
      clearInterval(obsTimer)
    }
  }, [])

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

    // Generate follow-up suggestions (chat mode only, background)
    if (!agentMode) {
      const forFollowups = messages.slice(-4).map(m => ({ role: m.role as string, content: m.content.slice(0, 600) }))
      const assistantId = lastMsg.id
      void fetch(`${API_BASE}/api/followups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: forFollowups }),
      }).then(r => r.ok ? r.json() : null)
        .then((data: { suggestions?: string[] } | null) => {
          if (data?.suggestions?.length) {
            setMessages(prev => prev.map(m =>
              m.id === assistantId ? { ...m, followups: data.suggestions } : m,
            ))
          }
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
      // Ctrl/Cmd+/ → focus composer
      if ((e.ctrlKey || e.metaKey) && (e.key === '/' || e.key === 'k') && !inInput) {
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
      // ? → keyboard help modal
      if (e.key === '?' && !inInput && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        setShowHelp(s => !s)
      }
      // Escape also closes slash menu and help modal
      if (e.key === 'Escape') {
        setSlashMenu(null)
        setShowHelp(false)
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

  function toggleVoice() {
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

  async function sendMessage(event?: FormEvent<HTMLFormElement>, promptOverride?: string, conversationOverride?: Message[]) {
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

    setMessages([...conversation, { id: assistantId, role: 'assistant', content: '', agentEvents: [], timestamp: Date.now() }])
    setDraft('')
    setAttachedFiles([])
    if (textareaRef.current) { textareaRef.current.style.height = 'auto' }
    setEngineError('')
    setIsStreaming(true)
    wasStreamingRef.current = true
    atBottomRef.current = true // always scroll to bottom on new send
    sendTimeRef.current = Date.now()

    const controller = new AbortController()
    abortRef.current = controller

    const endpoint = agentMode ? `${API_BASE}/api/agent` : `${API_BASE}/api/chat`

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
          domainExpertise: settings.domainExpertise || undefined,
          numCtx: settings.numCtx,
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

      case 'thinking':
        appendAgentEvent(assistantId, { type: 'thinking', content: payload.content as string })
        break

      case 'tool_call':
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
        })
        appendAgentEvent(assistantId, {
          type: 'user_question',
          id: payload.id as string,
          question: payload.question as string,
          context: (payload.context as string) ?? '',
        })
        break

      case 'error':
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

  async function submitAnswer(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (!pendingQuestion || !questionDraft.trim()) return
    const { id } = pendingQuestion
    const answer = questionDraft.trim()
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

  function stopStreaming() {
    abortRef.current?.abort()
    setIsStreaming(false)
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

  return (
  <>
    <main className="app-shell">
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
          <button type="button" className="sidebar-action-btn" onClick={() => setShowHealer(true)} title="Self-Healer — scan for TypeScript errors and auto-propose fixes">
            <Zap size={13} /> Heal
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

      </section>

      <section className="chat-panel" aria-label="Chat with Ultron">
        {observerStatus?.enabled && observerStatus.context && (
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
            <h2>Ask, iterate, build</h2>
          </div>
          <div className="chat-header-actions">
            {sidebarCollapsed && (
              <button type="button" className="export-btn" onClick={() => setSidebarCollapsed(false)} title="Show sidebar (Ctrl+B)">
                <ChevronRight size={14} />
              </button>
            )}
            {artifact && (
              <button type="button" className="export-btn artifact-btn" onClick={() => setArtifact(null)} title="Close artifact panel">
                <Code2 size={14} />
                Artifact ✕
              </button>
            )}
            {messages.length > 0 && (
              <button type="button" className="export-btn" onClick={() => setShowSearch(s => !s)} title="Search (Ctrl+F)">
                <Search size={14} />
              </button>
            )}
            {messages.length > 0 && (
              <button type="button" className="export-btn" onClick={exportChat} title="Export as Markdown">
                <Download size={14} />
                Export
              </button>
            )}
            <button type="button" className="ghost-button" onClick={resetChat}>
              New chat
            </button>
          </div>
        </header>

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
                <div className="welcome-icon"><Bot size={32} /></div>
                <div>
                  <h2>{getGreeting()} How can I help?</h2>
                  <p className="welcome-sub">Private · Local · {selectedModel || 'Ollama'}</p>
                </div>
              </div>
              <div className="quick-actions">
                {(agentMode ? AGENT_QUICK_ACTIONS : QUICK_ACTIONS).map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    className="quick-action-card"
                    onClick={() => sendMessage(undefined, action.prompt)}
                  >
                    <span className="quick-action-emoji">{action.emoji}</span>
                    <span>{action.label}</span>
                  </button>
                ))}
              </div>
              {recentChats.length > 0 && (
                <div className="recent-chats">
                  <p className="recent-chats-label">Continue a conversation</p>
                  <div className="recent-chat-list" style={{ display: 'flex', flexDirection: 'column', gap: 5, width: '100%' }}>
                    {recentChats.map(s => (
                      <button key={s.id} type="button" className="recent-chat-card" style={{ display: 'block', width: '100%', textAlign: 'left' }} onClick={() => void loadHistory(s.id)}>
                        <span className="recent-chat-title">{s.title}</span>
                        <span className="recent-chat-meta">{s.model.split(':')[0]} · {relativeTime(s.updatedAt)}</span>
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
                  {message.agentEvents.length > 0 && <AgentTrace events={message.agentEvents} />}
                  {message.role === 'assistant' && message.content ? (
                    <MessageContent
                      content={message.content}
                      streaming={isStreaming && msgIdx === deferredMessages.length - 1}
                      onImageClick={url => setLightboxUrl(url)}
                    />
                  ) : message.role === 'user' && message.content ? (
                    <>
                      {messageImages.get(message.id)?.map((url, i) => (
                        <img key={i} src={url} alt="Attached" className="msg-image-thumb" onClick={() => setLightboxUrl(url)} style={{ cursor: 'zoom-in' }} />
                      ))}
                      <MessageContent content={message.content} onImageClick={url => setLightboxUrl(url)} />
                    </>
                  ) : message.agentEvents.length === 0 ? (
                    <div className="typing-dots" aria-label="Thinking">
                      <span /><span /><span />
                    </div>
                  ) : null}

                  {/* Follow-up suggestion chips */}
                  {message.role === 'assistant' && message.followups && message.followups.length > 0 && (
                    <div className="followup-chips">
                      {message.followups.map((q) => (
                        <button
                          key={q}
                          type="button"
                          className="followup-chip"
                          onClick={() => sendMessage(undefined, q)}
                          disabled={isStreaming}
                        >
                          {q}
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

                  {/* Message footer: metrics + feedback + regenerate */}
                  {message.role === 'assistant' && (message.metrics || (!isStreaming && msgIdx === deferredMessages.length - 1)) && (
                    <div className="message-footer">
                      {message.metrics && (
                        <span className="msg-meta">
                          {message.metrics.model.split(':')[0]}
                          {message.metrics.responseTokens ? ` · ${message.metrics.responseTokens} tok` : ''}
                          {message.metrics.tokensPerSec ? ` · ${message.metrics.tokensPerSec} tok/s` : ''}
                          {message.metrics.iterations && message.metrics.iterations > 1 ? ` · ${message.metrics.iterations} steps` : ''}
                          {message.metrics.promptTokens ? (() => {
                            const pct = Math.min(100, Math.round(message.metrics.promptTokens! / settings.numCtx * 100))
                            return (
                              <span className="ctx-bar-wrap" title={`Context: ${message.metrics.promptTokens} / ${settings.numCtx} tokens (${pct}%)`}>
                                <span className="ctx-bar-fill" style={{ width: `${pct}%`, background: pct > 80 ? '#f85149' : pct > 60 ? '#e3b341' : '#3fb950' }} />
                              </span>
                            )
                          })() : ''}
                          {message.firstTokenMs ? <> · ftt: {(message.firstTokenMs / 1000).toFixed(2)}s</> : ''}
                          {message.content && (() => {
                            const wc = message.content.split(/\s+/).filter(Boolean).length
                            return wc > 80 ? <> · {wc} words</> : null
                          })()}
                        </span>
                      )}
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
          <div className="question-prompt">
            <p className="question-label">Ultron is asking:</p>
            <p className="question-text">{pendingQuestion.question}</p>
            {pendingQuestion.context && <p className="question-context">{pendingQuestion.context}</p>}
            <form className="question-form" onSubmit={(e) => { void submitAnswer(e) }}>
              <input
                autoFocus
                value={questionDraft}
                onChange={(e) => setQuestionDraft(e.target.value)}
                placeholder="Type your answer…"
                className="question-input"
              />
              <button type="submit" className="icon-button" disabled={!questionDraft.trim()}>
                <Send size={16} />
              </button>
            </form>
          </div>
        )}
        <div style={{ position: 'relative' }}>
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
            placeholder={agentMode ? 'Give Ultron a task… (Enter to send, Shift+Enter for newline)' : 'Message Ultron… (Enter to send, Shift+Enter for newline)'}
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
          <button
            type="button"
            className={`icon-button voice-btn ${isListening ? 'listening' : ''}`}
            onClick={toggleVoice}
            aria-label={isListening ? 'Stop listening' : 'Voice input'}
          >
            {isListening ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
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
        <p className="kbd-hint">
          <kbd>Enter</kbd> send &nbsp;·&nbsp; <kbd>/</kbd> slash &nbsp;·&nbsp; <kbd>↑/↓</kbd> history &nbsp;·&nbsp; <kbd>Ctrl+N</kbd> new &nbsp;·&nbsp; <kbd>Ctrl+B</kbd> sidebar &nbsp;·&nbsp; <kbd>?</kbd> help
          {draft.length > 40 && <>&nbsp;·&nbsp;<span className="token-est">~{Math.ceil(draft.length / 4)} tok</span></>}
        </p>
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
    {showHealer && (
      <HealerPanel
        apiBase={API_BASE}
        onClose={() => setShowHealer(false)}
      />
    )}
    {showSettings && (
      <SettingsPanel
        settings={settings}
        onChange={setSettings}
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
