export type AttachedFile = {
  id: string
  name: string
  size: number
  kind: 'text' | 'image'
  content: string  // text for text files; base64 data URL for images
  mime: string
}

export type AgentStepEvent = { type: 'agent_step'; step: number; maxSteps: number }
export type ThinkingEvent = { type: 'thinking'; content: string }
export type ToolCallEvent = { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }
export type ToolResultEvent = { type: 'tool_result'; id: string; name: string; result: string }
export type UserQuestionEvent = { type: 'user_question'; id: string; question: string; context: string }

export type AgentEvent = AgentStepEvent | ThinkingEvent | ToolCallEvent | ToolResultEvent | UserQuestionEvent

export type Role = 'user' | 'assistant'

export type Message = {
  id: string
  role: Role
  content: string
  agentEvents: AgentEvent[]
  timestamp: number
  firstTokenMs?: number
  metrics?: {
    model: string
    iterations?: number
    promptTokens?: number
    responseTokens?: number
    tokensPerSec?: number
  }
  followups?: string[]
}

export type PendingQuestion = {
  id: string
  question: string
  context: string
}

export type HistoryMeta = {
  id: string
  title: string
  updatedAt: number
  model: string
}

export type AppSettings = {
  temperature: number
  maxIterations: number
  systemPrompt: string
  fastModel: string
  observationEnabled: boolean
  observationMode: 'fast' | 'deep'
  observationIntervalSec: number
  domainExpertise: string
  numCtx: number
}

export type PendingPreview = {
  id: string
  type: 'file' | 'exec'
  path?: string
  command?: string
  oldContent?: string | null
  newContent?: string
  description?: string
  lang?: string
  createdAt: number
}

export type ObserverStatus = {
  enabled: boolean
  mode: string
  intervalSec: number
  context: {
    timestamp: number
    activeApp: string
    windowTitles: Array<{ process: string; title: string }>
    browserTabs: Array<{ browser: string; title: string }>
    visionSummary: string | null
    mode: string
  } | null
}

// ── Self-Healer types ──────────────────────────────────────────────────────────
export type HealerIssue = {
  id: string
  type: 'typescript'
  severity: 'error' | 'warning'
  file: string
  relativePath: string
  line: number
  col: number
  code: string
  message: string
  detectedAt: number
}

export type HealerLogEntry = {
  id: string
  timestamp: number
  issue: Pick<HealerIssue, 'relativePath' | 'line' | 'code' | 'message'>
  agentSummary: string
  success: boolean
}

export type HealerState = {
  status: 'idle' | 'scanning' | 'healing'
  lastScanAt: number | null
  scanDurationMs: number | null
  issues: HealerIssue[]
  log: HealerLogEntry[]
  scanError: string | null
  healingIssueId: string | null
}
