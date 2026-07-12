export type AttachedFile = {
  id: string
  name: string
  size: number
  kind: 'text' | 'image'
  content: string  // text for text files; base64 data URL for images
  mime: string
}

export type AgentStepEvent = { type: 'agent_step'; step: number; maxSteps: number }
export type AgentTaskStatus = 'planning' | 'using_tools' | 'verifying' | 'done' | 'needs_user_input'
export type AgentPlan = {
  goal: string
  assumptions: string[]
  steps: string[]
  toolsNeeded: string[]
  verificationMethod: string
  doneCondition: string
  taskSize: 'simple' | 'normal' | 'deep'
  toolBudget: number
}
export type AgentPlanEvent = { type: 'agent_plan'; plan: AgentPlan }
export type AgentTaskStateEvent = { type: 'agent_task_state'; status: AgentTaskStatus; detail: string }
export type StreamStatusEvent = { type: 'stream_status'; status: string; detail?: string; elapsedMs?: number; firstTokenMs?: number; totalMs?: number }
export type ThinkingEvent = { type: 'thinking'; content: string }
export type ToolCallEvent = { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }
export type ToolResultEvent = { type: 'tool_result'; id: string; name: string; result: string }
export type UserQuestionEvent = { type: 'user_question'; id: string; question: string; context: string; kind?: 'question' | 'permission' }

export type AgentEvent = AgentStepEvent | AgentPlanEvent | AgentTaskStateEvent | StreamStatusEvent | ThinkingEvent | ToolCallEvent | ToolResultEvent | UserQuestionEvent

export type Role = 'user' | 'assistant'
export type AnswerStyle = 'concise' | 'detailed' | 'technical' | 'executive'

export type Message = {
  id: string
  role: Role
  content: string
  agentEvents: AgentEvent[]
  timestamp: number
  route?: PromptRoute
  firstTokenMs?: number
  metrics?: {
    model: string
    iterations?: number
    promptTokens?: number
    responseTokens?: number
    tokensPerSec?: number
  }
  followups?: string[]
  predictions?: Prediction[]
}

export type Prediction = {
  emoji: string
  label: string
  prompt: string
}

export type PendingQuestion = {
  id: string
  question: string
  context: string
  kind?: 'question' | 'permission'
  mode?: 'project_setup'
  defaultAnswer?: string
}

export type IntelligenceMode = 'instant' | 'balanced' | 'deep' | 'research'

export type PromptRoute = {
  useAgent: boolean
  intelligenceMode: IntelligenceMode
  reason: string
  confidence: number
  signals: string[]
  scores: {
    agent: number
    chat: number
    complexity: number
    freshness: number
  }
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
  intelligenceMode: IntelligenceMode
  autoRoute: boolean
  autoIntelligence: boolean
  observationEnabled: boolean
  observationMode: 'fast' | 'deep'
  observationIntervalSec: number
  domainExpertise: string
  numCtx: number
  answerStyle: AnswerStyle
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

export type CapabilityStatusRow = {
  id: string
  label: string
  ok: boolean
  detail: string
}

export type CapabilityStatus = {
  healthy: boolean
  checkedAt: number
  summary: string
  models: string[]
  defaultModel: string
  toolCount: number
  runtime: {
    database: {
      provider: 'sqlite' | 'postgresql'
      target: string
    }
    identity: {
      configured: boolean
      userCount: number
      organizationCount: number
      platformAdminCount: number
    }
    auth: {
      deliveryMode: 'debug' | 'smtp'
      deliveryDetail: string
      sessionCookie: string
      sameSite: 'lax' | 'strict' | 'none'
      secure: boolean
    }
    readiness: {
      ready: boolean
      summary: string
      checks: Array<{
        id: string
        label: string
        ok: boolean
        detail: string
      }>
    }
    localServices: Array<{
      id: string
      label: string
      url: string
      enabled: boolean
    }>
  }
  statuses: CapabilityStatusRow[]
}

export type EngineSearchResult = {
  id: string
  type: 'tool' | 'connector' | 'route' | 'template' | 'system'
  title: string
  detail: string
  keywords: string
  score: number
}

export type EngineSearchResponse = {
  query: string
  checkedAt: number
  inventory: {
    tools: number
    connectors: number
    routes: number
    templates: number
  }
  results: EngineSearchResult[]
}

export type EngineBenchmarkResult = {
  checkedAt: number
  model: string
  promptChars: number
  totalMs: number
  loadMs: number | null
  evalMs: number | null
  promptTokens: number | null
  responseTokens: number | null
  tokensPerSec: number | null
  sample: string
}

export type ConnectorStatus = {
  id: string
  label: string
  category: 'crm' | 'email' | 'spreadsheet' | 'video' | 'productivity' | 'commerce' | 'support' | 'developer' | 'database' | 'storage' | 'communications' | 'social' | 'marketing' | 'finance' | 'design' | 'cloud' | 'automation' | 'documents' | 'generic'
  aliases: string[]
  homeUrl: string
  authModes: Array<'browser' | 'api' | 'oauth'>
  capabilities: string[]
  sensitiveActions: string[]
  requiredTools: string[]
  apiEnvVars: string[]
  apiConfigured: boolean
  browserSupported: boolean
  missingTools: string[]
  status: 'api-ready' | 'browser-ready' | 'setup-needed'
  detail: string
}

export type ConnectorPermissionLevel = 'read-only' | 'draft-changes' | 'apply-with-approval' | 'safe-auto'

export type ConnectorSetupState = {
  connectorId: string
  preferredAuth: 'browser' | 'api' | 'oauth'
  permissionLevel: ConnectorPermissionLevel
  auditLogEnabled: boolean
  browserSessionReady: boolean
  apiTokenConfigured: boolean
  lastTestAt: number | null
  lastTestOk: boolean | null
  lastTestDetail: string
  updatedAt: number
}

export type ConnectorAuditEntry = {
  id: string
  connectorId: string
  action: 'setup_updated' | 'connection_test' | 'native_action_dry_run'
  summary: string
  approvalRequired: boolean
  at: number
}

export type ConnectorActionSchema = {
  connectorId: string
  actionId: string
  name: string
  label: string
  description: string
  mode: 'read' | 'draft' | 'write' | 'send' | 'financial'
  approvalRequired: boolean
  dryRunAvailable: boolean
  inputSchema: {
    required: string[]
    properties: Record<string, { type: string; description: string }>
  }
}

export type ConnectorActionPlan = {
  ok: boolean
  dryRun: true
  action: ConnectorActionSchema
  approvalRequired: boolean
  approvalReason: string
  permissionLevel: string
  readiness: ConnectorStatus['status']
  input: Record<string, unknown>
  missingInputs: string[]
  prerequisites: string[]
  planSteps: string[]
  warnings: string[]
  createdAt: number
}

export type ConnectorStatusSnapshot = {
  checkedAt: number
  total: number
  apiReady: number
  browserReady: number
  setupNeeded: number
  connectors: ConnectorStatus[]
  setupStates: Record<string, ConnectorSetupState>
  auditLog: ConnectorAuditEntry[]
  nativeActions: ConnectorActionSchema[]
}

export type Task = {
  id: string
  title: string
  done: boolean
  priority: 'low' | 'medium' | 'high'
  due?: string
  tags: string[]
  notes?: string
  createdAt: string
  completedAt?: string
}

export type MemoryScope = 'user' | 'project' | 'temporary'

export type LongMemoryEntry = {
  id: string
  timestamp: string
  content: string
  tags: string[]
  confidence: number
  source: string
  scope: MemoryScope
  expiresAt: string | null
  promotedFrom: string | null
}

export type MemoryConflict = {
  id: string
  content: string
  reason: string
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
