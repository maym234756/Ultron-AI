import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { tmpdir } from 'node:os'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { sendEvent, pendingAnswers } from './shared.js'
import { backendRuntimeMiddleware, backendRuntimeSnapshot, collectBackendRoutes, recordRuntimeEvent } from './backendStatus.js'
import { authRateLimit } from './authRateLimit.js'
import { AUTH_COOKIE_DOMAIN, AUTH_COOKIE_SAME_SITE, AUTH_COOKIE_SECURE, AUTH_SESSION_COOKIE, clearSessionCookie, readSessionCookie, setSessionCookie } from './authCookies.js'
import { authDeliveryStatus } from './authMailer.js'
import { runAgent, runAgentHeadless } from './agent.js'
import type { AgentOptions } from './agent.js'
import { startScheduler } from './tools/scheduler.js'
import {
  startObserver, stopObserver, observerStatus, captureNow, formatContextForAgent, loadContext,
} from './observer.js'
import { initMultiAgent } from './tools/multiagent.js'
import { loadPlugins } from './plugins/loader.js'
import { registerPlugin, executeTool, toolDefinitions } from './tools/registry.js'
import { detectMemoryConflicts, listMemoryEntries, promoteMemoryEntry } from './tools/longmem.js'
import type { MemoryScope } from './tools/longmem.js'
import { transcribeAudio } from './tools/whisper.js'
import { getAutoContext } from './tools/rag.js'
import { getPreviews, applyPreview, discardPreview, getAppliedPreviews, rollbackPreview } from './tools/preview.js'
import { CONNECTOR_REGISTRY, buildExternalConnectorAnswer, findConnectorsForText, getConnectorStatusSnapshot } from './connectors.js'
import { addConnectorAuditEntry, getConnectorSetupSnapshot, getConnectorSetupState, updateConnectorSetup } from './connectorSetup.js'
import { getConnectorActionSchemas, planConnectorAction } from './connectorActions.js'
import { buildSelfUpgradePrompt, getSelfUpgradeSnapshot, getUpgradePack, recordSelfUpgradeRun, updateSelfUpgradeBacklogItem } from './selfUpgrade.js'
import { PROJECT_TEMPLATES, buildProject, getCodingToolchainStatus } from './projectBuilder.js'
import type { ProjectTemplateId } from './projectBuilder.js'
import { listProjectRecords, rememberProject, runProjectAction } from './projectMemory.js'
import type { ProjectAction } from './projectMemory.js'
import { buildReferenceProject, scanReference } from './referenceBuilder.js'
import { previewPromptRoute } from './promptRouter.js'
import {
  acceptIncomingOrganizationInvite,
  acceptOrganizationInvite,
  auditLogOverview,
  cancelOrganizationInvite,
  confirmEmailVerification,
  createCredential,
  createOrganizationInvite,
  currentUser,
  deleteCredential,
  identityOverview,
  identityStatus,
  leaveOrganization,
  listCredentials,
  listIncomingOrganizationInvites,
  loginUser,
  logoutUser,
  organizationOverview,
  previewOrganizationInvite,
  registerUser,
  removeOrganizationMember,
  renameOrganization,
  requestEmailVerification,
  requestPasswordReset,
  resetPassword,
  revealCredentialSecret,
  setOrganizationMemberRole,
  setPlatformAdmin,
  transferOrganizationOwnership,
} from './identityVault.js'
import { databaseProvider, databaseUrl } from './prisma.js'
import {
  scanForIssues, getHealerState, canHeal, setHealingStatus, addHealLog,
  buildHealerPrompt,
} from './selfhealer.js'

type ChatRole = 'system' | 'user' | 'assistant'

type ChatMessage = {
  role: ChatRole
  content: string
}

type AssistantRequest = {
  messages?: ChatMessage[]
  model?: string
  temperature?: number
  systemPrompt?: string
  maxIterations?: number
  fastModel?: string
  intelligenceMode?: 'instant' | 'balanced' | 'deep' | 'research'
  domainExpertise?: string
  numCtx?: number
  answerStyle?: 'concise' | 'detailed' | 'technical' | 'executive'
  images?: string[]  // base64 image data (no data: prefix) for vision
}

type OllamaModel = {
  name: string
  model?: string
  modified_at?: string
  size?: number
  details?: {
    parameter_size?: string
    quantization_level?: string
    family?: string
    format?: string
  }
}

function summarizeDatabaseTarget(url: string): string {
  if (/^postgres(ql)?:\/\//i.test(url)) {
    try {
      const target = new URL(url)
      const databaseName = target.pathname.replace(/^\//, '') || 'postgres'
      return `${target.hostname}:${target.port || '5432'}/${databaseName}`
    } catch {
      return 'Postgres configured'
    }
  }

  if (url.toLowerCase().startsWith('file:')) {
    const pathname = url.slice('file:'.length)
    const normalized = pathname.replace(/\\/g, '/').split('/').filter(Boolean)
    return normalized.at(-1) ?? 'lumivex.db'
  }

  return url
}

function isLocalHostname(value: string | null | undefined): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '0.0.0.0'
}

function isLocalOrigin(value: string | undefined): boolean {
  if (!value?.trim()) return true
  try {
    return isLocalHostname(new URL(value).hostname)
  } catch {
    return true
  }
}

function hasDeploySafeEncryptionKey(value: string | undefined): boolean {
  const key = value?.trim()
  if (!key) return false
  if (key.length < 24) return false
  return !/local-dev|change-before-deploy|replace-with-a-long-random-secret/i.test(key)
}

type OllamaTagsResponse = {
  models?: OllamaModel[]
}

type OllamaChatChunk = {
  model?: string
  message?: {
    role?: ChatRole
    content?: string
  }
  done?: boolean
  total_duration?: number
  load_duration?: number
  prompt_eval_count?: number
  eval_count?: number
  error?: string
}

const app = express()
app.set('trust proxy', true)
const port = Number(process.env.PORT ?? 8787)
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'
const defaultModel = process.env.MODEL_NAME ?? process.env.OPENAI_MODEL ?? process.env.OLLAMA_MODEL ?? 'qwen2.5:14b'
const modelProvider = normalizeModelProvider(process.env.MODEL_PROVIDER)
const hostedModelBaseUrl = trimTrailingSlash(
  process.env.MODEL_API_BASE_URL ?? process.env.OPENAI_API_BASE_URL ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
)
const hostedModelApiKey = process.env.MODEL_API_KEY ?? process.env.OPENAI_API_KEY ?? ''
const serverDir = path.dirname(fileURLToPath(import.meta.url))
const cwdDistDir = path.resolve(process.cwd(), 'dist')
const bundledDistDir = path.resolve(serverDir, '../dist')
const distDir = fs.existsSync(cwdDistDir) ? cwdDistDir : bundledDistDir

type ModelProvider = 'ollama' | 'openai-compatible'

function normalizeModelProvider(value: string | undefined): ModelProvider {
  const provider = value?.trim().toLowerCase()
  if (!provider || provider === 'ollama') return 'ollama'
  if (['openai', 'openai-compatible', 'groq', 'openrouter', 'together', 'fireworks'].includes(provider)) {
    return 'openai-compatible'
  }
  return 'ollama'
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function isHostedModelProvider(): boolean {
  return modelProvider === 'openai-compatible'
}

function modelProviderLabel(): string {
  return isHostedModelProvider() ? `openai-compatible:${hostedModelBaseUrl}` : `ollama:${ollamaBaseUrl}`
}

function hostedModelHeaders(): Record<string, string> {
  if (!hostedModelApiKey.trim()) {
    throw new Error('MODEL_API_KEY or OPENAI_API_KEY is required when MODEL_PROVIDER uses an OpenAI-compatible provider.')
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${hostedModelApiKey}`,
  }
  if (process.env.OPENROUTER_SITE_URL) headers['HTTP-Referer'] = process.env.OPENROUTER_SITE_URL
  if (process.env.OPENROUTER_APP_NAME) headers['X-Title'] = process.env.OPENROUTER_APP_NAME
  return headers
}

// Ranked preference list — first match wins
const MODEL_PREFERENCE = [
  'qwen2.5:14b',
  'qwen2.5:7b',
  'qwen2.5-coder:14b',
  'qwen2.5-coder:7b',
  'llama3.1:8b',
  'mistral:7b',
  'llama3.2:3b',
  'llama3.2',
]

// Vision-capable model patterns
const VISION_PATTERNS = ['llava', 'bakllava', 'minicpm-v', 'moondream', 'phi3v', 'llama3.2-vision', 'gemma3']
export function isVisionModel(name: string): boolean {
  return VISION_PATTERNS.some(p => name.toLowerCase().includes(p))
}

// Cache of currently available model names (populated on startup)
let cachedModelNames: string[] = []

const warmupStatus: {
  startedAt: number | null
  completedAt: number | null
  primaryModel: string | null
  primaryOk: boolean
  fastModel: string | null
  fastOk: boolean
  detail: string
} = {
  startedAt: null,
  completedAt: null,
  primaryModel: null,
  primaryOk: false,
  fastModel: null,
  fastOk: false,
  detail: 'Warmup has not started yet.',
}

function bestVisionModel(preferredModel: string): string {
  if (isVisionModel(preferredModel)) return preferredModel
  const visionModel = cachedModelNames.find(m => isVisionModel(m))
  return visionModel ?? preferredModel
}

function bestAvailableModel(models: OllamaModel[]): string {
  const names = models.map((m) => m.name)
  for (const preferred of MODEL_PREFERENCE) {
    const match = names.find((n) => n === preferred || n.startsWith(preferred.split(':')[0] + ':'))
    if (match) return match
  }
  return names[0] ?? defaultModel
}

const defaultSystemPrompt = [
  'You are Lumivex AI, a precise AI assistant running through Lumivex AI\'s configured model runtime.',
  'You have broad knowledge, strong reasoning, and full tool access on the user\'s Windows machine.',
  'Be direct, confident, and accurate: say what you know, hedge what is uncertain, state clearly when you do not know.',
  'Answer contract: direct answer first, then only the reasoning, caveats, or steps needed for the user to act.',
  'Critical thinking loop: identify intent, separate facts from assumptions, choose the simplest sufficient answer, then self-check for accuracy before finalizing.',
  'Latency discipline: do not produce long setup text. If a short answer is enough, stop early.',
  'Sound like a capable teammate, not a template. Do not answer action requests with generic how-to lectures.',
  'When the user asks to build/create/start something, identify the first missing decision and ask that one question, or use tools if enough information is available.',
  'Calibrate response depth to the request: one-sentence answers for simple lookups, structured explanations for complex topics.',
  'Never use sycophantic openers ("Certainly!", "Great question!", "Of course!") or hollow closers ("I hope this helps!", "Let me know!").',
  'Use markdown purposefully: code blocks for code, numbered lists for sequential steps, prose for explanations. Never add formatting for its own sake.',
  'For technical questions: lead with the direct answer, then reasoning, then examples if helpful.',
  'For analysis tasks: reach a clear conclusion rather than endlessly presenting "both sides" without a verdict.',
  'For code: write clean, idiomatic, production-ready code with clear naming. Comment non-obvious logic only.',
  'When uncertain: say so concisely ("I believe X, but verify this") rather than hedging every sentence.',
  'Prioritize correctness over comprehensiveness. A focused accurate answer beats a padded uncertain one.',
].join(' ')

type IntelligenceMode = NonNullable<AssistantRequest['intelligenceMode']>

const INTELLIGENCE_CHAT_INSTRUCTIONS: Record<IntelligenceMode, string> = {
  instant: `INTELLIGENCE PROFILE: Instant. Optimize for minimum latency and maximum directness.
  • Skip all background, preamble, and context-setting — answer directly.
  • Factual question → one sentence. Code request → code only. Steps → numbered list, nothing else.
  • Prefer 1-5 bullets or one short paragraph. Avoid explaining your reasoning unless asked.
  • Omit nuance only if it would make the answer misleading.`,

  balanced: `INTELLIGENCE PROFILE: Balanced. Complete and useful without padding.
  • Lead with the direct answer, then add essential context.
  • Match depth to complexity: casual questions get concise answers, technical questions get structure.
  • Include the practical next step when the user appears to be deciding or building.
  • Prefer one well-chosen example over three mediocre ones.`,

  deep: `INTELLIGENCE PROFILE: Deep. Apply rigorous analysis before answering.
  Internally work through these before writing — do NOT recite the steps verbatim:
    1. What is the actual question beneath the surface request?
    2. What are the strongest 2–3 approaches, and which wins and why?
    3. What edge cases, failure modes, or unstated assumptions are relevant?
    4. What would change the answer that the user may not have considered?
  
  Your answer must REFLECT this reasoning as substance, not as a numbered procedure.
  For code: design the interface and invariants before writing implementation.
  For analysis: state your evaluation criteria, then apply them consistently.
  Always include: conclusion, key reasoning, tradeoff/caveat, and recommended next action.
  If the answer depends on unknown runtime/file/web state, say what would verify it.`,

  research: `INTELLIGENCE PROFILE: Research. Evidence-based synthesis with explicit epistemic labels.
  • DISTINGUISH clearly: (established fact) vs (reasonable inference) vs (plausible speculation)
  • LEAD with the most important finding, not with background
  • CITE inline when drawing on retrieved documents, memories, or search: "Per [source]..."
  • QUANTIFY confidence: "strong evidence", "likely but unconfirmed", "speculative"
  • STATE the main limit or caveat of your answer near the top
  • SUGGEST one concrete validation step when stakes are high enough to warrant it
  • If no fresh source was actually retrieved, explicitly say the answer is from model knowledge/context, not live verification
  • Do not hedge every sentence — that buries signal. State clearly where confidence is high.`,
}

const PROFILE_CONTEXT_FLOORS: Record<IntelligenceMode, number> = {
  instant: 2048,
  balanced: 8192,
  deep: 12288,
  research: 16384,
}

function normalizeIntelligenceMode(mode?: string): IntelligenceMode {
  return mode === 'instant' || mode === 'deep' || mode === 'research' ? mode : 'balanced'
}

// ── Inference options builder ──────────────────────────────────────────────────
// Produces optimized Ollama inference parameters per intelligence profile.
// top_p (nucleus sampling) + repeat_penalty significantly improve output quality
// over temperature alone. Mirostat v2 provides adaptive perplexity targeting for
// Deep/Research modes, producing more coherent long-form answers.

type OllamaInferenceOptions = {
  temperature: number
  num_ctx: number
  top_p?: number
  repeat_penalty?: number
  num_predict?: number
  mirostat?: number
  mirostat_tau?: number
  mirostat_eta?: number
}

function buildInferenceOptions(
  temperature: number,
  numCtx: number,
  mode: IntelligenceMode = 'balanced',
): OllamaInferenceOptions {
  const base: OllamaInferenceOptions = { temperature, num_ctx: numCtx, top_p: 0.92, repeat_penalty: 1.12 }
  switch (mode) {
    case 'instant':
      return { ...base, temperature: Math.min(temperature, 0.22), top_p: 0.82, repeat_penalty: 1.08, num_predict: 512 }
    case 'balanced':
      return { ...base, top_p: 0.92, repeat_penalty: 1.12, num_predict: 1536 }
    case 'deep':
      return { ...base, top_p: 0.95, repeat_penalty: 1.15, num_predict: 3072, mirostat: 2, mirostat_tau: 5.0, mirostat_eta: 0.10 }
    case 'research':
      return { ...base, temperature: Math.min(temperature, 0.35), top_p: 0.96, repeat_penalty: 1.18, num_predict: 3072, mirostat: 2, mirostat_tau: 4.0, mirostat_eta: 0.08 }
  }
}

const configuredOrigins = (process.env.APP_ORIGIN ?? '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean)
const allowedOrigins = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  ...configuredOrigins,
])

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true)
      return
    }
    callback(new Error('Origin not allowed by Lumivex AI auth policy.'))
  },
  credentials: true,
}))
app.use(express.json({ limit: '8mb' }))
app.use(backendRuntimeMiddleware())

// ── Observer routes ────────────────────────────────────────────────────────────

app.get('/api/observer/status', (_req, res) => {
  res.json(observerStatus())
})

app.post('/api/observer/toggle', async (req, res) => {
  const user = await requireActionPermission(req, res, 'apply-with-approval')
  if (!user) return
  const { enabled, mode, intervalSec } = req.body as {
    enabled?: boolean; mode?: 'fast' | 'deep'; intervalSec?: number
  }
  const status = observerStatus()
  const newEnabled = enabled ?? !status.enabled
  const newMode = (mode === 'fast' || mode === 'deep') ? mode : (status.mode as 'fast' | 'deep')
  const newInterval = typeof intervalSec === 'number' ? intervalSec : status.intervalSec

  if (newEnabled) {
    startObserver(ollamaBaseUrl, newInterval, newMode)
  } else {
    stopObserver()
  }
  res.json(observerStatus())
})

app.post('/api/observer/capture', async (req, res) => {
  const user = await requireActionPermission(req, res, 'read-only')
  if (!user) return
  try {
    const ctx = await captureNow()
    res.json({ ok: true, context: ctx, formatted: formatContextForAgent(ctx) })
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
})

app.get('/api/health', async (_request, response) => {
  try {
    const tags = await fetchOllamaTags(1600)
    const best = bestAvailableModel(tags.models ?? [])
    response.json({
      ok: true,
      model: best,
      modelProvider: modelProviderLabel(),
      models: tags.models ?? [],
    })
  } catch (error) {
    response.status(503).json({
      ok: false,
      model: defaultModel,
      modelProvider: modelProviderLabel(),
      error: error instanceof Error ? error.message : 'The model provider is not reachable',
    })
  }
})

app.get('/api/backend/status', (_request, response) => {
  response.json(backendRuntimeSnapshot({
    routes: collectBackendRoutes(app),
    toolCount: toolDefinitions.length,
    modelCount: cachedModelNames.length,
    defaultModel,
    fastModel: cachedFastModel,
    warmupDetail: warmupStatus.detail,
  }))
})

app.get('/api/capabilities/status', async (_request, response) => {
  const checkedAt = Date.now()
  const requiredModels = [defaultModel, 'nomic-embed-text']
  const statusRows: Array<{ id: string; label: string; ok: boolean; detail: string }> = []

  let models: OllamaModel[] = []
  try {
    const tags = await fetchOllamaTags(2500)
    models = tags.models ?? []
    const names = models.map(m => m.name)
    const missing = requiredModels.filter(required => !names.some(name => name === required || name.startsWith(required.split(':')[0] + ':')))
    statusRows.push({
      id: 'ollama',
      label: 'Ollama engine',
      ok: true,
      detail: `${models.length} model(s) available${missing.length ? `; missing ${missing.join(', ')}` : ''}`,
    })
  } catch (err) {
    statusRows.push({
      id: 'ollama',
      label: 'Ollama engine',
      ok: false,
      detail: err instanceof Error ? err.message : 'Ollama is unreachable',
    })
  }

  const modelNames = models.map(m => m.name)
  const visionCount = modelNames.filter(isVisionModel).length
  statusRows.push({
    id: 'vision',
    label: 'Vision routing',
    ok: visionCount > 0,
    detail: visionCount > 0 ? `${visionCount} vision-capable model(s) detected` : 'No local vision model detected',
  })

  statusRows.push({
    id: 'tools',
    label: 'Tool registry',
    ok: toolDefinitions.length > 0,
    detail: `${toolDefinitions.length} callable tool definition(s) loaded`,
  })

  statusRows.push({
    id: 'latency',
    label: 'Speed + latency system',
    ok: warmupStatus.primaryOk || Boolean(cachedFastModel),
    detail: `${warmupStatus.primaryModel ?? defaultModel} ${warmupStatus.primaryOk ? 'warm' : 'warming/unknown'} · fast model ${cachedFastModel ?? 'not detected'}`,
  })

  const runtime = backendRuntimeSnapshot({
    routes: collectBackendRoutes(app),
    toolCount: toolDefinitions.length,
    modelCount: modelNames.length || cachedModelNames.length,
    defaultModel,
    fastModel: cachedFastModel,
    warmupDetail: warmupStatus.detail,
  })
  statusRows.push({
    id: 'backend-runtime',
    label: 'Backend runtime supervisor',
    ok: runtime.healthy,
    detail: `${runtime.traffic.activeRequests} active request(s), ${runtime.traffic.activeStreams} stream(s), ${runtime.traffic.recentErrorCount} recent error(s), ${runtime.inventory.apiRoutes} route(s) tracked`,
  })

  const delivery = authDeliveryStatus()
  const identity = await identityStatus()
  const databaseLabel = databaseProvider === 'postgresql' ? 'Postgres runtime' : 'SQLite runtime'
  statusRows.push({
    id: 'database',
    label: 'Database engine',
    ok: true,
    detail: `${databaseLabel} · ${summarizeDatabaseTarget(databaseUrl)}`,
  })
  statusRows.push({
    id: 'identity',
    label: 'Identity vault',
    ok: true,
    detail: `${identity.userCount} account(s) · ${identity.organizationCount} organization(s) · ${identity.platformAdminCount} platform admin(s)${identity.configured ? '' : ' · first account not created yet'}`,
  })
  statusRows.push({
    id: 'auth-delivery',
    label: 'Auth delivery',
    ok: delivery.ok,
    detail: delivery.detail,
  })
  statusRows.push({
    id: 'auth-session',
    label: 'Session cookie',
    ok: true,
    detail: `${AUTH_SESSION_COOKIE} · SameSite=${AUTH_COOKIE_SAME_SITE} · ${AUTH_COOKIE_SECURE ? 'Secure' : 'Not secure'}${AUTH_COOKIE_DOMAIN ? ` · domain ${AUTH_COOKIE_DOMAIN}` : ''}`,
  })

  const connectorSnapshot = getConnectorStatusSnapshot(toolDefinitions.map(tool => tool.function.name), process.env)
  statusRows.push({
    id: 'connectors',
    label: 'External connectors',
    ok: connectorSnapshot.browserReady + connectorSnapshot.apiReady > 0,
    detail: `${connectorSnapshot.total} registered · ${connectorSnapshot.apiReady} API-ready · ${connectorSnapshot.browserReady} browser-ready`,
  })

  const observer = observerStatus()
  statusRows.push({
    id: 'observer',
    label: 'Screen observer',
    ok: observer.enabled,
    detail: observer.enabled ? `${observer.mode} mode every ${observer.intervalSec}s` : 'Observer disabled',
  })

  const healer = getHealerState()
  statusRows.push({
    id: 'healer',
    label: 'Self-healer',
    ok: healer.status !== 'healing' && !healer.scanError,
    detail: healer.scanError ?? `${healer.issues.length} issue(s) from last scan`,
  })

  const stores = [
    { id: 'rag', label: 'RAG knowledge base', file: path.resolve(process.cwd(), '.rag-store.jsonl') },
    { id: 'memory', label: 'Long-term memory', file: path.resolve(process.cwd(), '.long-memory.jsonl') },
    { id: 'dist', label: 'Production build', file: distDir },
  ]
  for (const store of stores) {
    const exists = fs.existsSync(store.file)
    const stat = exists ? fs.statSync(store.file) : null
    const detail = stat?.isDirectory()
      ? `${fs.readdirSync(store.file, { recursive: true }).length.toLocaleString()} artifact(s) present`
      : stat
        ? `${Math.max(1, Math.round(stat.size / 1024)).toLocaleString()} KB present`
        : store.id === 'dist' ? 'No production build found' : 'Ready; no store created yet'
    statusRows.push({
      id: store.id,
      label: store.label,
      ok: store.id === 'dist' ? exists : true,
      detail,
    })
  }

  const healthy = statusRows.every(row => row.ok)
  const localServices = [
    { id: 'adminer', label: 'Adminer', url: `http://127.0.0.1:${process.env.LUMIVEX_ADMINER_PORT ?? '8088'}`, enabled: databaseProvider === 'postgresql' },
    {
      id: 'mailpit',
      label: 'Mailpit',
      url: `http://127.0.0.1:${process.env.LUMIVEX_MAILPIT_UI_PORT ?? '8025'}`,
      enabled: delivery.resolvedMode === 'smtp' && (delivery.host === '127.0.0.1' || delivery.host === 'localhost'),
    },
  ]
  const readinessChecks = [
    {
      id: 'database',
      label: 'Production database',
      ok: databaseProvider === 'postgresql',
      detail: databaseProvider === 'postgresql'
        ? `Postgres configured at ${summarizeDatabaseTarget(databaseUrl)}.`
        : 'SQLite is still configured; switch DATABASE_URL to Postgres for deployed multi-user use.',
    },
    {
      id: 'cookie-secure',
      label: 'Secure session cookie',
      ok: AUTH_COOKIE_SECURE,
      detail: AUTH_COOKIE_SECURE
        ? 'Secure cookie mode is enabled.'
        : 'AUTH_COOKIE_SECURE is off; enable secure cookies behind HTTPS before public deployment.',
    },
    {
      id: 'auth-delivery',
      label: 'Public auth email delivery',
      ok: delivery.resolvedMode === 'smtp' && !isLocalHostname(delivery.host),
      detail: delivery.resolvedMode !== 'smtp'
        ? 'Auth codes are not using SMTP; configure a mail provider before public launch.'
        : isLocalHostname(delivery.host)
          ? `SMTP is pointing to local inbox ${delivery.host}:${delivery.port ?? 1025}; switch to a real external provider.`
          : delivery.detail,
    },
    {
      id: 'app-origin',
      label: 'Public app origin',
      ok: !isLocalOrigin(process.env.APP_ORIGIN),
      detail: !isLocalOrigin(process.env.APP_ORIGIN)
        ? `APP_ORIGIN is set to ${process.env.APP_ORIGIN}.`
        : 'APP_ORIGIN is local or unset; point it to your deployed app URL.',
    },
    {
      id: 'encryption-key',
      label: 'Credential encryption key',
      ok: hasDeploySafeEncryptionKey(process.env.CREDENTIAL_ENCRYPTION_KEY),
      detail: hasDeploySafeEncryptionKey(process.env.CREDENTIAL_ENCRYPTION_KEY)
        ? 'Custom credential encryption key is configured.'
        : 'CREDENTIAL_ENCRYPTION_KEY is missing or still using a local/dev placeholder.',
    },
  ]
  const deploymentReady = readinessChecks.every(check => check.ok)
  response.json({
    healthy,
    checkedAt,
    summary: healthy ? 'Lumivex AI is operational.' : 'Lumivex AI needs attention.',
    models: modelNames,
    defaultModel,
    toolCount: toolDefinitions.length,
    runtime: {
      database: {
        provider: databaseProvider,
        target: summarizeDatabaseTarget(databaseUrl),
      },
      identity: {
        configured: identity.configured,
        userCount: identity.userCount,
        organizationCount: identity.organizationCount,
        platformAdminCount: identity.platformAdminCount,
      },
      auth: {
        deliveryMode: delivery.resolvedMode,
        deliveryDetail: delivery.detail,
        sessionCookie: AUTH_SESSION_COOKIE,
        sameSite: AUTH_COOKIE_SAME_SITE,
        secure: AUTH_COOKIE_SECURE,
      },
      readiness: {
        ready: deploymentReady,
        summary: deploymentReady
          ? 'Core deployment checks are satisfied.'
          : `${readinessChecks.filter(check => !check.ok).length} deployment check(s) still need work.`,
        checks: readinessChecks,
      },
      localServices,
    },
    statuses: statusRows,
  })
})

app.get('/api/connectors/status', (_request, response) => {
  const snapshot = getConnectorStatusSnapshot(toolDefinitions.map(tool => tool.function.name), process.env)
  const setup = getConnectorSetupSnapshot()
  response.json({
    ...snapshot,
    setupStates: setup.states,
    auditLog: setup.auditLog,
    nativeActions: getConnectorActionSchemas(),
  })
})

app.get('/api/connectors/actions', (_request, response) => {
  response.json({ actions: getConnectorActionSchemas() })
})

app.post('/api/connectors/actions/dry-run', async (request, response) => {
  const user = await requireActionPermission(request, response, 'read-only')
  if (!user) return
  const { actionName, input } = request.body as { actionName?: string; input?: Record<string, unknown> }
  if (!actionName?.trim()) {
    response.status(400).json({ error: 'actionName is required.' })
    return
  }

  const plan = planConnectorAction(actionName, input ?? {}, toolDefinitions.map(tool => tool.function.name), process.env)
  if (!plan) {
    response.status(404).json({ error: 'Connector action not found.' })
    return
  }

  const setup = getConnectorSetupState(plan.action.connectorId)
  if (setup.auditLogEnabled) {
    addConnectorAuditEntry({
      connectorId: plan.action.connectorId,
      action: 'native_action_dry_run',
      summary: `Dry-run planned for ${plan.action.name}: ${plan.approvalRequired ? 'approval required' : 'read-only'}.`,
      approvalRequired: plan.approvalRequired,
    })
  }

  response.json({ plan })
})

app.get('/api/latency/status', (_request, response) => {
  response.json({
    checkedAt: Date.now(),
    defaultModel,
    fastModel: cachedFastModel,
    warmup: warmupStatus,
    modelCache: cachedModelNames,
  })
})

type EngineSearchItem = {
  id: string
  type: 'tool' | 'connector' | 'route' | 'template' | 'system'
  title: string
  detail: string
  keywords: string
}

function engineSearchItems(): EngineSearchItem[] {
  const tools = toolDefinitions.map(tool => ({
    id: `tool:${tool.function.name}`,
    type: 'tool' as const,
    title: tool.function.name,
    detail: tool.function.description,
    keywords: [tool.function.name, tool.function.description, Object.keys(tool.function.parameters.properties).join(' ')].join(' '),
  }))
  const connectors = CONNECTOR_REGISTRY.map(connector => ({
    id: `connector:${connector.id}`,
    type: 'connector' as const,
    title: connector.label,
    detail: `${connector.category} · ${connector.capabilities.join('; ')}`,
    keywords: [connector.label, connector.id, connector.category, connector.aliases.join(' '), connector.capabilities.join(' '), connector.sensitiveActions.join(' ')].join(' '),
  }))
  const routes = collectBackendRoutes(app).map(route => ({
    id: `route:${route.method}:${route.path}`,
    type: 'route' as const,
    title: `${route.method} ${route.path}`,
    detail: route.path.startsWith('/v1') ? 'OpenAI-compatible API route' : 'Lumivex AI backend API route',
    keywords: `${route.method} ${route.path}`,
  }))
  const templates = PROJECT_TEMPLATES.map(template => ({
    id: `template:${template.id}`,
    type: 'template' as const,
    title: template.label,
    detail: `${template.description} · ${template.stack}`,
    keywords: [template.id, template.label, template.description, template.stack].join(' '),
  }))
  const system: EngineSearchItem[] = [
    {
      id: 'system:latency',
      type: 'system',
      title: 'Response speed and latency tuning',
      detail: 'Warm models, fast-model routing, first-token telemetry, benchmark endpoint, and local response metrics.',
      keywords: 'speed latency benchmark response time first token tokens per second warmup fast model',
    },
    {
      id: 'system:trust',
      type: 'system',
      title: 'Action trust layer',
      detail: 'Server-side session checks, action permissions, credential vault, audit logs, previews, and rollback workflows.',
      keywords: 'auth permission audit credential vault approval preview rollback trust security',
    },
    {
      id: 'system:mobile',
      type: 'system',
      title: 'Mobile/iPad PWA and Run Tracker',
      detail: 'Installable PWA shell, service worker API-skip safety, browser geolocation run tracking, and GPX export.',
      keywords: 'mobile ipad pwa service worker run tracker geolocation gps gpx',
    },
  ]
  return [...system, ...tools, ...connectors, ...templates, ...routes]
}

function scoreEngineSearch(item: EngineSearchItem, tokens: string[]): number {
  const title = item.title.toLowerCase()
  const detail = item.detail.toLowerCase()
  const keywords = item.keywords.toLowerCase()
  let score = 0
  for (const token of tokens) {
    if (title === token) score += 80
    if (title.includes(token)) score += 35
    if (keywords.includes(token)) score += 16
    if (detail.includes(token)) score += 10
  }
  if (item.type === 'system') score += 4
  if (item.type === 'tool') score += 3
  return score
}

app.get('/api/engine/search', (request, response) => {
  const query = String(request.query.q ?? '').trim().slice(0, 120)
  const limit = Math.min(50, Math.max(5, Number(request.query.limit ?? 20) || 20))
  const items = engineSearchItems()
  const tokens = query.toLowerCase().split(/\s+/).map(token => token.trim()).filter(token => token.length >= 2)
  const results = tokens.length
    ? items
        .map(item => ({ ...item, score: scoreEngineSearch(item, tokens) }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
        .slice(0, limit)
    : items
        .filter(item => item.type === 'system')
        .map(item => ({ ...item, score: 1 }))

  response.json({
    query,
    checkedAt: Date.now(),
    inventory: {
      tools: toolDefinitions.length,
      connectors: CONNECTOR_REGISTRY.length,
      routes: collectBackendRoutes(app).length,
      templates: PROJECT_TEMPLATES.length,
    },
    results,
  })
})

app.post('/api/engine/benchmark', async (request, response) => {
  const user = await requireActionPermission(request, response, 'read-only')
  if (!user) return

  const body = request.body as { model?: string; prompt?: string; maxTokens?: number }
  const prompt = (body.prompt ?? 'Reply with one concise sentence: Lumivex AI engine benchmark complete.').trim().slice(0, 1000)
  const maxTokens = Math.min(256, Math.max(16, Number(body.maxTokens ?? 64) || 64))
  let selectedModel = sanitizeModel(body.model)
  try {
    const tags = await fetchOllamaTags(2500)
    const models = tags.models ?? []
    if (!body.model || !models.some(model => model.name === selectedModel)) selectedModel = bestAvailableModel(models)
  } catch {
    selectedModel = sanitizeModel(body.model) || defaultModel
  }

  const startedAt = Date.now()
  try {
    const data = await runModelBenchmark(selectedModel, prompt, maxTokens)
    const totalMs = Date.now() - startedAt
    const evalMs = data.eval_duration ? Math.round(data.eval_duration / 1e6) : null
    const loadMs = data.load_duration ? Math.round(data.load_duration / 1e6) : null
    const tokensPerSec = data.eval_count && data.eval_duration
      ? Math.round(data.eval_count / (data.eval_duration / 1e9))
      : null

    response.json({
      checkedAt: Date.now(),
      provider: modelProviderLabel(),
      model: selectedModel,
      promptChars: prompt.length,
      totalMs,
      loadMs,
      evalMs,
      promptTokens: data.prompt_eval_count ?? null,
      responseTokens: data.eval_count ?? null,
      tokensPerSec,
      sample: (data.response ?? '').trim().slice(0, 600),
    })
  } catch (err) {
    response.status(500).json({ error: err instanceof Error ? err.message : 'Benchmark failed' })
  }
})

function bearerToken(request: express.Request): string | undefined {
  const header = request.header('authorization') ?? ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]
}

function authToken(request: express.Request): string | undefined {
  return bearerToken(request) ?? readSessionCookie(request)
}

function sendSession(response: express.Response, session: { token: string; user: unknown; expiresAt: string }, extra: Record<string, unknown> = {}) {
  setSessionCookie(response, session.token, new Date(session.expiresAt))
  response.json({ user: session.user, expiresAt: session.expiresAt, ...extra })
}

async function finalizeSessionInvite(session: { token: string; user: { id: string }; expiresAt: string }, inviteTokenInput: unknown): Promise<{ session: { token: string; user: unknown; expiresAt: string }; inviteAccepted?: boolean; inviteError?: string }> {
  const inviteToken = typeof inviteTokenInput === 'string' ? inviteTokenInput.trim() : ''
  if (!inviteToken) return { session }

  try {
    await acceptOrganizationInvite(session.user.id, { token: inviteToken })
    const user = await currentUser(session.token)
    return {
      session: { ...session, user: user ?? session.user },
      inviteAccepted: true,
    }
  } catch (error) {
    return {
      session,
      inviteAccepted: false,
      inviteError: error instanceof Error ? error.message : 'Could not accept workspace invite.',
    }
  }
}

const registerRateLimit = authRateLimit({
  id: 'register',
  windowMs: 15 * 60_000,
  max: 8,
  key: request => String((request.body as { email?: string } | undefined)?.email ?? ''),
})
const loginRateLimit = authRateLimit({
  id: 'login',
  windowMs: 10 * 60_000,
  max: 10,
  key: request => String((request.body as { emailOrUsername?: string } | undefined)?.emailOrUsername ?? ''),
})
const verifyRateLimit = authRateLimit({
  id: 'verify',
  windowMs: 15 * 60_000,
  max: 12,
  key: request => String((request.body as { email?: string; emailOrUsername?: string } | undefined)?.email ?? (request.body as { emailOrUsername?: string } | undefined)?.emailOrUsername ?? ''),
})
const resetRateLimit = authRateLimit({
  id: 'reset',
  windowMs: 15 * 60_000,
  max: 8,
  key: request => String((request.body as { email?: string } | undefined)?.email ?? ''),
})

app.get('/api/auth/status', async (_request, response) => {
  response.json(await identityStatus())
})

app.get('/api/auth/me', async (request, response) => {
  response.json({ user: await currentUser(authToken(request)) })
})

app.post('/api/auth/register', registerRateLimit, async (request, response) => {
  try {
    const result = await registerUser(request.body ?? {})
    response.status(202).json({
      next: result.next,
      email: result.email,
      expiresAt: result.expiresAt,
      delivery: result.delivery,
      message: 'Enter the verification code to finish creating your account.',
    })
  } catch (err) {
    response.status(400).json({ error: err instanceof Error ? err.message : 'Could not create Lumivex AI identity' })
  }
})

app.post('/api/auth/login', loginRateLimit, async (request, response) => {
  try {
    const result = await loginUser(request.body ?? {})
    if (result.next === 'verify_email') {
      response.status(403).json({
        next: result.next,
        email: result.email,
        expiresAt: result.expiresAt,
        delivery: result.delivery,
        error: 'Verify your email before signing in.',
      })
      return
    }
    const finalized = await finalizeSessionInvite(result.session, (request.body as { inviteToken?: string } | undefined)?.inviteToken)
    sendSession(response, finalized.session, {
      inviteAccepted: finalized.inviteAccepted,
      inviteError: finalized.inviteError,
    })
  } catch (err) {
    response.status(401).json({ error: err instanceof Error ? err.message : 'Login failed' })
  }
})

app.post('/api/auth/verify/request', verifyRateLimit, async (request, response) => {
  try {
    const challenge = await requestEmailVerification(request.body ?? {})
    response.json({
      ok: true,
      delivery: challenge?.delivery ?? null,
      email: challenge?.email ?? null,
      expiresAt: challenge?.expiresAt ?? null,
      message: 'If the account exists and still needs verification, a code is ready.',
    })
  } catch (err) {
    response.status(400).json({ error: err instanceof Error ? err.message : 'Could not issue verification code' })
  }
})

app.post('/api/auth/verify/confirm', verifyRateLimit, async (request, response) => {
  try {
    const session = await confirmEmailVerification(request.body ?? {})
    const finalized = await finalizeSessionInvite(session, (request.body as { inviteToken?: string } | undefined)?.inviteToken)
    sendSession(response, finalized.session, {
      inviteAccepted: finalized.inviteAccepted,
      inviteError: finalized.inviteError,
    })
  } catch (err) {
    response.status(400).json({ error: err instanceof Error ? err.message : 'Verification failed' })
  }
})

app.post('/api/auth/password/request-reset', resetRateLimit, async (request, response) => {
  try {
    const challenge = await requestPasswordReset(request.body ?? {})
    response.json({
      ok: true,
      delivery: challenge?.delivery ?? null,
      email: challenge?.email ?? null,
      expiresAt: challenge?.expiresAt ?? null,
      message: 'If that email exists, a password reset code is ready.',
    })
  } catch (err) {
    response.status(400).json({ error: err instanceof Error ? err.message : 'Could not issue password reset code' })
  }
})

app.post('/api/auth/password/reset', resetRateLimit, async (request, response) => {
  try {
    const session = await resetPassword(request.body ?? {})
    const finalized = await finalizeSessionInvite(session, (request.body as { inviteToken?: string } | undefined)?.inviteToken)
    sendSession(response, finalized.session, {
      inviteAccepted: finalized.inviteAccepted,
      inviteError: finalized.inviteError,
    })
  } catch (err) {
    response.status(400).json({ error: err instanceof Error ? err.message : 'Could not reset password' })
  }
})

app.post('/api/auth/logout', async (request, response) => {
  await logoutUser(authToken(request))
  clearSessionCookie(response)
  response.json({ ok: true })
})

async function requireAuth(request: express.Request, response: express.Response): Promise<Awaited<ReturnType<typeof currentUser>> | null> {
  const user = await currentUser(authToken(request))
  if (!user) response.status(401).json({ error: 'Sign in to Lumivex AI first.' })
  return user
}

type ActionPermissionLevel = 'read-only' | 'draft-changes' | 'apply-with-approval' | 'admin-only'

async function requireActionPermission(request: express.Request, response: express.Response, level: ActionPermissionLevel): Promise<NonNullable<Awaited<ReturnType<typeof currentUser>>> | null> {
  const user = await requireAuth(request, response)
  if (!user) return null
  if (level === 'admin-only' && !user.isPlatformAdmin) {
    response.status(403).json({ error: 'Platform admin access is required.' })
    return null
  }
  return user
}

function canManageOrganization(user: NonNullable<Awaited<ReturnType<typeof currentUser>>>): boolean {
  return Boolean(user.organizationId) && (user.isPlatformAdmin || user.organizationRole === 'owner')
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && /not found/i.test(error.message)
}

function isPermissionError(error: unknown): boolean {
  return error instanceof Error && /platform admin access is required|only organization owners or platform admins|only a current workspace owner|you can only /i.test(error.message)
}

app.post('/api/org/invites/preview', async (request, response) => {
  try {
    response.json({ invite: await previewOrganizationInvite(request.body ?? {}) })
  } catch (err) {
    response.status(400).json({ error: err instanceof Error ? err.message : 'Could not preview invite' })
  }
})

async function requireOrganizationManager(request: express.Request, response: express.Response): Promise<NonNullable<Awaited<ReturnType<typeof currentUser>>> | null> {
  const user = await requireAuth(request, response)
  if (!user) return null
  if (!canManageOrganization(user)) {
    response.status(403).json({ error: 'Organization owner or platform admin access is required.' })
    return null
  }
  return user
}

async function requirePlatformAdmin(request: express.Request, response: express.Response): Promise<NonNullable<Awaited<ReturnType<typeof currentUser>>> | null> {
  const user = await requireAuth(request, response)
  if (!user) return null
  if (!user.isPlatformAdmin) {
    response.status(403).json({ error: 'Platform admin access is required.' })
    return null
  }
  return user
}

app.get('/api/org', async (request, response) => {
  const user = await requireAuth(request, response)
  if (!user) return
  try {
    response.json(await organizationOverview(user.id))
  } catch (err) {
    response.status(isNotFoundError(err) ? 404 : 400).json({ error: err instanceof Error ? err.message : 'Could not load organization' })
  }
})

app.patch('/api/org', async (request, response) => {
  const user = await requireOrganizationManager(request, response)
  if (!user) return
  try {
    response.json(await renameOrganization(user.id, request.body ?? {}))
  } catch (err) {
    response.status(isNotFoundError(err) ? 404 : 400).json({ error: err instanceof Error ? err.message : 'Could not update organization' })
  }
})

app.post('/api/org/leave', async (request, response) => {
  const user = await requireAuth(request, response)
  if (!user) return
  try {
    const organization = await leaveOrganization(user.id)
    response.json({
      organization,
      user: await currentUser(authToken(request)),
    })
  } catch (err) {
    response.status(400).json({ error: err instanceof Error ? err.message : 'Could not leave organization' })
  }
})

app.post('/api/org/invites', async (request, response) => {
  const user = await requireOrganizationManager(request, response)
  if (!user) return
  try {
    response.status(201).json(await createOrganizationInvite(user.id, request.body ?? {}))
  } catch (err) {
    response.status(400).json({ error: err instanceof Error ? err.message : 'Could not create invite' })
  }
})

app.delete('/api/org/invites/:id', async (request, response) => {
  const user = await requireOrganizationManager(request, response)
  if (!user) return
  try {
    response.json(await cancelOrganizationInvite(user.id, request.params.id))
  } catch (err) {
    const status = isPermissionError(err) ? 403 : isNotFoundError(err) ? 404 : 400
    response.status(status).json({ error: err instanceof Error ? err.message : 'Could not cancel invite' })
  }
})

app.delete('/api/org/members/:id', async (request, response) => {
  const user = await requireOrganizationManager(request, response)
  if (!user) return
  try {
    response.json(await removeOrganizationMember(user.id, request.params.id))
  } catch (err) {
    const status = isPermissionError(err) ? 403 : isNotFoundError(err) ? 404 : 400
    response.status(status).json({ error: err instanceof Error ? err.message : 'Could not remove member' })
  }
})

app.post('/api/org/members/:id/transfer-ownership', async (request, response) => {
  const user = await requireOrganizationManager(request, response)
  if (!user) return
  try {
    const organization = await transferOrganizationOwnership(user.id, request.params.id)
    response.json({
      organization,
      user: await currentUser(authToken(request)),
    })
  } catch (err) {
    const status = isPermissionError(err) ? 403 : isNotFoundError(err) ? 404 : 400
    response.status(status).json({ error: err instanceof Error ? err.message : 'Could not transfer ownership' })
  }
})

app.get('/api/org/invites/incoming', async (request, response) => {
  const user = await requireAuth(request, response)
  if (!user) return
  try {
    response.json({ invites: await listIncomingOrganizationInvites(user.id) })
  } catch (err) {
    response.status(isNotFoundError(err) ? 404 : 400).json({ error: err instanceof Error ? err.message : 'Could not load incoming invites' })
  }
})

app.post('/api/org/invites/accept', async (request, response) => {
  const user = await requireAuth(request, response)
  if (!user) return
  try {
    const organization = await acceptOrganizationInvite(user.id, request.body ?? {})
    response.json({
      organization,
      user: await currentUser(authToken(request)),
    })
  } catch (err) {
    response.status(400).json({ error: err instanceof Error ? err.message : 'Could not accept invite' })
  }
})

app.post('/api/org/invites/:id/accept', async (request, response) => {
  const user = await requireAuth(request, response)
  if (!user) return
  try {
    const organization = await acceptIncomingOrganizationInvite(user.id, request.params.id)
    response.json({
      organization,
      user: await currentUser(authToken(request)),
    })
  } catch (err) {
    const status = isNotFoundError(err) ? 404 : 400
    response.status(status).json({ error: err instanceof Error ? err.message : 'Could not accept invite' })
  }
})

app.patch('/api/org/members/:id/role', async (request, response) => {
  const user = await requireOrganizationManager(request, response)
  if (!user) return
  try {
    response.json({ member: await setOrganizationMemberRole(user.id, request.params.id, request.body ?? {}) })
  } catch (err) {
    const status = isPermissionError(err) ? 403 : isNotFoundError(err) ? 404 : 400
    response.status(status).json({ error: err instanceof Error ? err.message : 'Could not update member role' })
  }
})

app.get('/api/admin/identity', async (request, response) => {
  const user = await requirePlatformAdmin(request, response)
  if (!user) return
  try {
    response.json(await identityOverview(user.id))
  } catch (err) {
    response.status(400).json({ error: err instanceof Error ? err.message : 'Could not load identity overview' })
  }
})

app.get('/api/admin/audit', async (request, response) => {
  const user = await requirePlatformAdmin(request, response)
  if (!user) return
  try {
    const limit = Number(request.query.limit ?? 80)
    response.json({ entries: await auditLogOverview(user.id, limit) })
  } catch (err) {
    response.status(400).json({ error: err instanceof Error ? err.message : 'Could not load audit log' })
  }
})

app.patch('/api/admin/users/:id/platform-admin', async (request, response) => {
  const user = await requirePlatformAdmin(request, response)
  if (!user) return
  try {
    response.json({ member: await setPlatformAdmin(user.id, request.params.id, request.body ?? {}) })
  } catch (err) {
    const status = isNotFoundError(err) ? 404 : 400
    response.status(status).json({ error: err instanceof Error ? err.message : 'Could not update platform admin access' })
  }
})

app.get('/api/credentials', async (request, response) => {
  const user = await requireAuth(request, response)
  if (!user) return
  response.json({ credentials: await listCredentials(user.id) })
})

app.post('/api/credentials', async (request, response) => {
  const user = await requireAuth(request, response)
  if (!user) return
  try {
    response.json({ id: await createCredential(user.id, request.body ?? {}) })
  } catch (err) {
    response.status(400).json({ error: err instanceof Error ? err.message : 'Could not save credential' })
  }
})

app.post('/api/credentials/:id/reveal', async (request, response) => {
  const user = await requireAuth(request, response)
  if (!user) return
  try {
    response.json(await revealCredentialSecret(user.id, request.params.id))
  } catch (err) {
    response.status(404).json({ error: err instanceof Error ? err.message : 'Credential not found' })
  }
})

app.delete('/api/credentials/:id', async (request, response) => {
  const user = await requireAuth(request, response)
  if (!user) return
  await deleteCredential(user.id, request.params.id)
  response.json({ ok: true })
})

app.get('/api/project-builder/templates', (_request, response) => {
  response.json({ templates: PROJECT_TEMPLATES })
})

app.get('/api/project-builder/toolchain', async (_request, response) => {
  response.json(await getCodingToolchainStatus())
})

app.post('/api/project-builder/select-folder', async (request, response) => {
  const user = await requireActionPermission(request, response, 'apply-with-approval')
  if (!user) return
  try {
    const body = request.body as { basePath?: string } | undefined
    const selectedPath = await selectProjectDestinationFolder(body?.basePath)
    response.json(selectedPath ? { cancelled: false, path: selectedPath } : { cancelled: true })
  } catch (err) {
    response.status(500).json({ error: err instanceof Error ? err.message : 'Folder picker failed' })
  }
})

app.post('/api/project-builder/build', async (request, response) => {
  const user = await requireActionPermission(request, response, 'apply-with-approval')
  if (!user) return
  try {
    const result = await buildProject(request.body ?? {})
    await rememberProject(result)
    response.json(result)
  } catch (err) {
    response.status(400).json({ error: err instanceof Error ? err.message : 'Project build failed' })
  }
})

app.get('/api/project-builder/projects', async (request, response) => {
  const user = await requireActionPermission(request, response, 'read-only')
  if (!user) return
  response.json({ projects: await listProjectRecords() })
})

app.post('/api/reference-builder/scan', async (request, response) => {
  const user = await requireActionPermission(request, response, 'draft-changes')
  if (!user) return
  try {
    const visionModel = cachedModelNames.find(isVisionModel)
    const result = await scanReference(request.body ?? {}, {
      ollamaBaseUrl,
      model: defaultModel,
      visionModel,
    })
    response.json(result)
  } catch (err) {
    response.status(400).json({ error: err instanceof Error ? err.message : 'Reference scan failed' })
  }
})

app.post('/api/reference-builder/build', async (request, response) => {
  const user = await requireActionPermission(request, response, 'apply-with-approval')
  if (!user) return
  try {
    const visionModel = cachedModelNames.find(isVisionModel)
    const result = await buildReferenceProject(request.body ?? {}, {
      ollamaBaseUrl,
      model: defaultModel,
      visionModel,
    })
    await rememberProject(result.project)
    response.json(result)
  } catch (err) {
    response.status(400).json({ error: err instanceof Error ? err.message : 'Reference build failed' })
  }
})

app.post('/api/project-builder/projects/:id/actions', async (request, response) => {
  const user = await requireActionPermission(request, response, 'apply-with-approval')
  if (!user) return
  const action = String((request.body as { action?: string } | undefined)?.action ?? '') as ProjectAction
  const approved = Boolean((request.body as { approved?: boolean } | undefined)?.approved)
  if (!approved) {
    response.status(403).json({ error: 'Approval is required before Lumivex AI runs project actions.' })
    return
  }
  try {
    response.json(await runProjectAction(request.params.id, action))
  } catch (err) {
    response.status(400).json({ error: err instanceof Error ? err.message : 'Project action failed' })
  }
})

app.post('/api/connectors/:id/setup', async (request, response) => {
  const user = await requireActionPermission(request, response, 'apply-with-approval')
  if (!user) return
  const connectorId = request.params.id
  const snapshot = getConnectorStatusSnapshot(toolDefinitions.map(tool => tool.function.name), process.env)
  const connector = snapshot.connectors.find(item => item.id === connectorId)
  if (!connector) {
    response.status(404).json({ error: 'Connector not found.' })
    return
  }

  const next = updateConnectorSetup(connectorId, request.body as Parameters<typeof updateConnectorSetup>[1])
  addConnectorAuditEntry({
    connectorId,
    action: 'setup_updated',
    summary: `${connector.label} setup updated: ${next.preferredAuth}, ${next.permissionLevel}, audit ${next.auditLogEnabled ? 'on' : 'off'}.`,
    approvalRequired: false,
  })
  response.json({ state: next })
})

app.post('/api/connectors/:id/test', async (request, response) => {
  const user = await requireActionPermission(request, response, 'read-only')
  if (!user) return
  const connectorId = request.params.id
  const snapshot = getConnectorStatusSnapshot(toolDefinitions.map(tool => tool.function.name), process.env)
  const connector = snapshot.connectors.find(item => item.id === connectorId)
  if (!connector) {
    response.status(404).json({ error: 'Connector not found.' })
    return
  }

  const state = getConnectorSetupState(connectorId)
  const preferredAuth = state.preferredAuth
  const ok = preferredAuth === 'browser'
    ? connector.browserSupported
    : connector.apiConfigured
  const detail = ok
    ? preferredAuth === 'browser'
      ? `Browser tools are ready. Open ${connector.label}, sign in normally, then use browser session actions.`
      : 'API/OAuth environment variables are configured.'
    : preferredAuth === 'browser'
      ? `Browser setup is blocked by missing tools: ${connector.missingTools.join(', ') || 'unknown'}.`
      : `API/OAuth setup needs one of: ${connector.apiEnvVars.join(', ') || 'no API mode is defined for this connector'}.`
  const next = updateConnectorSetup(connectorId, {
    lastTestAt: Date.now(),
    lastTestOk: ok,
    lastTestDetail: detail,
    browserSessionReady: preferredAuth === 'browser' ? ok : state.browserSessionReady,
    apiTokenConfigured: preferredAuth !== 'browser' ? ok : state.apiTokenConfigured,
  })
  addConnectorAuditEntry({
    connectorId,
    action: 'connection_test',
    summary: `${connector.label} ${preferredAuth} test ${ok ? 'passed' : 'needs setup'}: ${detail}`,
    approvalRequired: false,
  })
  response.json({ ok, detail, state: next })
})

app.post('/api/router/preview', (request, response) => {
  const body = request.body as {
    text?: string
    hasFiles?: boolean
    hasImages?: boolean
    settings?: {
      intelligenceMode?: 'instant' | 'balanced' | 'deep' | 'research'
      autoRoute?: boolean
      autoIntelligence?: boolean
    }
    manualAgentMode?: boolean
  }
  const text = typeof body.text === 'string' ? body.text : ''
  if (!text.trim()) {
    response.status(400).json({ error: 'Text is required.' })
    return
  }
  response.json(previewPromptRoute(
    text,
    Boolean(body.hasFiles),
    Boolean(body.hasImages),
    body.settings ?? {},
    Boolean(body.manualAgentMode),
  ))
})

app.get('/api/models', async (_request, response) => {
  try {
    const tags = await fetchOllamaTags(4000)
    const models = tags.models ?? []
    // Annotate each model with vision capability
    response.json({
      models: models.map(m => ({ ...m, vision: isVisionModel(m.name) })),
    })
  } catch (error) {
    response.status(503).json({
      models: [],
      error: error instanceof Error ? error.message : 'Could not list Ollama models',
    })
  }
})

app.post('/api/chat', async (request, response) => {
  const user = await requireActionPermission(request, response, 'read-only')
  if (!user) return
  const body = request.body as AssistantRequest
  const messages = normalizeMessages(body.messages)
  const intelligenceMode = normalizeIntelligenceMode(body.intelligenceMode)

  if (messages.length === 0) {
    response.status(400).json({ error: 'At least one user message is required.' })
    return
  }

  response.writeHead(200, {
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Content-Type': 'text/event-stream',
    'X-Accel-Buffering': 'no',
  })
  response.flushHeaders()
  if (response.socket) response.socket.setTimeout(0)

  const abortController = new AbortController()
  const detectDisconnect = response.socket ?? request
  detectDisconnect.once('close', () => { if (!response.writableEnded) abortController.abort() })

  // Inject RAG + long-term memory context into the last user message
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content ?? ''
  const skipAutoContext = intelligenceMode === 'instant' && isKnowledgeOnlyQuery(lastUserMsg)
  sendEvent(response, 'stream_status', {
    status: skipAutoContext ? 'fast_factual_path' : 'preparing_context',
    detail: skipAutoContext ? 'Answering as a short factual question.' : 'Preparing context.',
  })
  const autoCtx = !skipAutoContext && lastUserMsg.length > 12
    ? await getAutoContext(lastUserMsg).catch(() => null)
    : null

  let enrichedMessages = messages
  if (autoCtx) {
    const lastIdx = messages.findLastIndex(m => m.role === 'user')
    if (lastIdx >= 0) {
      enrichedMessages = messages.map((m, i) =>
        i === lastIdx
          ? { ...m, content: `[RECALLED CONTEXT — use if relevant, cite source]:\n${autoCtx}\n\n---\n\n${m.content}` }
          : m,
      )
    }
  }

  const selectedModel = routeModel(body, messages, intelligenceMode)
  const requestedCtx = typeof body.numCtx === 'number' ? Math.min(32768, Math.max(512, body.numCtx)) : 8192
  const profiledCtx = Math.min(32768, Math.max(requestedCtx, PROFILE_CONTEXT_FLOORS[intelligenceMode]))
  const numCtx = selectedModel !== sanitizeModel(body.model) && intelligenceMode === 'instant'
    ? Math.min(profiledCtx, 3072)
    : profiledCtx

  try {
    const modelResponse = await fetchModelChat({
      model: selectedModel,
      messages: skipAutoContext
        ? buildLeanKnowledgePrompt(enrichedMessages, body.answerStyle)
        : buildPrompt(enrichedMessages, body.systemPrompt, intelligenceMode, body.answerStyle),
      stream: true,
      temperature: clampTemperature(body.temperature),
      options: buildInferenceOptions(clampTemperature(body.temperature), numCtx, intelligenceMode),
      signal: abortController.signal,
    })

    if (!modelResponse.ok || !modelResponse.body) {
      const details = await modelResponse.text()
      sendEvent(response, 'error', {
        error: details || `Model provider returned ${modelResponse.status}`,
      })
      response.end()
      return
    }

    await streamModelResponse(modelResponse, response)
  } catch (error) {
    if (!abortController.signal.aborted) {
      sendEvent(response, 'error', {
        error: error instanceof Error ? error.message : 'The assistant engine failed.',
      })
      response.end()
    }
  }
})

app.post('/api/agent', async (request, response) => {
  const user = await requireActionPermission(request, response, 'apply-with-approval')
  if (!user) return
  const body = request.body as AssistantRequest
  const messages = normalizeMessages(body.messages)
  const intelligenceMode = normalizeIntelligenceMode(body.intelligenceMode)

  if (messages.length === 0) {
    response.status(400).json({ error: 'At least one user message is required.' })
    return
  }

  response.writeHead(200, {
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Content-Type': 'text/event-stream',
    'X-Accel-Buffering': 'no',
  })
  // Flush headers immediately so the browser sees the SSE stream start
  response.flushHeaders()
  // Prevent socket from being destroyed during long Ollama inference
  if (response.socket) response.socket.setTimeout(0)

  const abortController = new AbortController()
  // Use the response socket (not request) for disconnect detection —
  // request fires 'close' as soon as the request body is consumed in some Node versions
  const detectDisconnect = response.socket ?? request
  detectDisconnect.once('close', () => {
    if (!response.writableEnded) {
      console.log('[agent] socket closed — aborting')
      abortController.abort()
    }
  })

  // Detect simple imperative commands — skip expensive context lookups for them
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content ?? ''
  const simpleCommand = isCommandLike(lastUserMsg)

  if (isProjectBuilderKickoff(lastUserMsg) && !Array.isArray(body.images)) {
    await streamProjectBuilderKickoff(response, lastUserMsg)
    return
  }

  const directConnectorOpen = getDirectConnectorOpenTarget(lastUserMsg)
  if (directConnectorOpen && !Array.isArray(body.images)) {
    await streamDirectConnectorOpen(response, directConnectorOpen)
    return
  }

  const directAppOpen = getDirectWindowsAppOpenTarget(lastUserMsg)
  if (directAppOpen && !Array.isArray(body.images)) {
    await streamDirectWindowsAppOpen(response, directAppOpen)
    return
  }

  // Inject ambient screen context only when potentially relevant (not for simple file/folder commands)
  const needsScreen = !simpleCommand || /\b(screen|window|see|look|visible|open app|what.?s (on|showing)|desktop)\b/i.test(lastUserMsg)
  const screenCtx = needsScreen ? loadContext() : null
  const screenContextStr = screenCtx && (Date.now() - screenCtx.timestamp) < 300_000
    ? formatContextForAgent(screenCtx)
    : null

  // Auto-inject RAG knowledge + long-term memory — skip for short commands (saves ~300ms embedding call)
  const autoCtx = !simpleCommand && lastUserMsg.length > 12
    ? await getAutoContext(lastUserMsg).catch(() => null)
    : null

  // ── STATIC system content (KV-cacheable by Ollama across agent steps) ──────
  const userSystemPrompt = typeof body.systemPrompt === 'string' ? body.systemPrompt.trim() : ''
  const stylePrompt = answerStylePrompt(body.answerStyle)
  const domainExpertise = typeof body.domainExpertise === 'string' && body.domainExpertise.trim()
    ? `USER CONTEXT: ${body.domainExpertise.trim()}`
    : null
  const systemContent = [domainExpertise, stylePrompt, userSystemPrompt].filter(Boolean).join('\n\n')

  // ── DYNAMIC context injected into the last user message (not system) ────────
  // Keeping dynamic content out of the system message allows Ollama to KV-cache
  // the static system prompt, cutting prefill cost on every agent step.
  const dynamicPreamble = [
    screenContextStr,
    autoCtx ? `RECALLED CONTEXT (use if relevant, cite source):\n${autoCtx}` : null,
  ].filter(Boolean).join('\n\n')

  // Auto-compress very long conversations to stay within context window
  const compressedMessages = messages.length > 18 ? await compressContext(messages) : messages

  let enrichedMessages = compressedMessages as Array<{ role: 'user' | 'assistant'; content: string }>
  if (dynamicPreamble) {
    const lastIdx = enrichedMessages.findLastIndex(m => m.role === 'user')
    if (lastIdx >= 0) {
      enrichedMessages = enrichedMessages.map((m, i) =>
        i === lastIdx
          ? { ...m, content: `[Context — use if relevant]:\n${dynamicPreamble}\n\n---\n\n${m.content}` }
          : m,
      )
    }
  }

  // If images are attached, route to a vision-capable model
  const hasImages = Array.isArray(body.images) && body.images.length > 0
  const baseModel = routeModel(body, messages, intelligenceMode)
  const selectedModel = hasImages ? bestVisionModel(baseModel) : baseModel
  const requestedMaxIterations = body.maxIterations ?? 15
  const profileMaxIterations = intelligenceMode === 'instant'
    ? Math.min(requestedMaxIterations, 8)
    : intelligenceMode === 'deep'
      ? Math.max(requestedMaxIterations, 20)
      : intelligenceMode === 'research'
        ? Math.max(requestedMaxIterations, 24)
        : requestedMaxIterations

  const agentOptions: AgentOptions = {
    model: selectedModel,
    temperature: clampTemperature(body.temperature),
    systemContent,
    ollamaBaseUrl,
    maxIterations: Math.min(30, Math.max(1, profileMaxIterations)),
    // Use a smaller context window for fast-model simple commands to cut prefill time
    numCtx: (() => {
      const requested = typeof body.numCtx === 'number' ? Math.min(32768, Math.max(512, body.numCtx)) : 8192
      const profiled = Math.min(32768, Math.max(requested, PROFILE_CONTEXT_FLOORS[intelligenceMode]))
      return selectedModel !== sanitizeModel(body.model) && simpleCommand && intelligenceMode === 'instant' ? 3072 : profiled
    })(),
    images: hasImages ? body.images : undefined,
    intelligenceMode,
  }

  console.log('[agent] starting, model:', agentOptions.model)
  const connectorAnswer = buildExternalConnectorAnswer(lastUserMsg)
  if (!hasImages && connectorAnswer && !simpleCommand) {
    console.log('[agent] external connector fast-path activated')
    streamStaticAssistantResponse(response, connectorAnswer)
    return
  }

  // ── Knowledge fast-path ───────────────────────────────────────────────────
  // For pure knowledge/explanation queries, skip the 3,000-token tool catalog
  // and stream a direct chat response. This cuts first-token latency by 6-10x.
  // The model is still the same; only the system prompt is shorter.
  if (!hasImages && isKnowledgeOnlyQuery(lastUserMsg) && !simpleCommand) {
    console.log('[agent] knowledge fast-path activated')
    try {
      const numCtxFast = agentOptions.numCtx ?? 8192
      const leanMessages = buildPrompt(
        enrichedMessages as ChatMessage[],
        agentOptions.systemContent || undefined,
        intelligenceMode,
        body.answerStyle,
      )
      const ollamaRes = await fetch(`${ollamaBaseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: agentOptions.model,
          messages: leanMessages,
          stream: true,
          keep_alive: '60m',
          options: buildInferenceOptions(agentOptions.temperature, numCtxFast, intelligenceMode),
        }),
        signal: abortController.signal,
      })
      if (ollamaRes.ok && ollamaRes.body) {
        await streamOllamaResponse(ollamaRes, response)
        return
      }
      // Fall through to full agent if fast path fails
      console.log('[agent] fast-path failed, falling back to agent loop')
    } catch (fastErr) {
      if (abortController.signal.aborted) { response.end(); return }
      console.log('[agent] fast-path error, falling back:', fastErr instanceof Error ? fastErr.message : fastErr)
    }
  }

  try {
    await runAgent(enrichedMessages, agentOptions, response, abortController.signal)
    console.log('[agent] runAgent completed')
  } catch (agentError) {
    if (!abortController.signal.aborted) {
      sendEvent(response, 'error', {
        error: agentError instanceof Error ? agentError.message : 'Agent loop failed',
      })
    }
  } finally {
    if (!response.writableEnded) response.end()
  }
})

// ── Model Compare ──────────────────────────────────────────────────────────────
// Run the same prompt against multiple Ollama models simultaneously, streaming
// all responses concurrently. Each token is tagged with the originating model.
app.post('/api/compare', async (request, response) => {
  const user = await requireActionPermission(request, response, 'read-only')
  if (!user) return
  const body = request.body as {
    messages?: Array<{ role: string; content: string }>
    models?: string[]
    temperature?: number
    systemPrompt?: string
    numCtx?: number
  }

  const rawMessages = normalizeMessages(body.messages as ChatMessage[] | undefined)
  const modelsToCompare = Array.isArray(body.models)
    ? body.models
        .filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
        .slice(0, 4)
        .map(m => sanitizeModel(m))
    : [defaultModel]

  if (rawMessages.length === 0 || modelsToCompare.length === 0) {
    response.status(400).json({ error: 'messages and at least one model are required.' })
    return
  }

  response.writeHead(200, {
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Content-Type': 'text/event-stream',
    'X-Accel-Buffering': 'no',
  })
  response.flushHeaders()
  if (response.socket) response.socket.setTimeout(0)

  const abortController = new AbortController()
  const detectDisconnect = response.socket ?? request
  detectDisconnect.once('close', () => { if (!response.writableEnded) abortController.abort() })

  const temperature = clampTemperature(body.temperature)
  const numCtx = typeof body.numCtx === 'number' ? Math.min(32768, Math.max(512, body.numCtx)) : 8192
  const builtMessages = buildPrompt(rawMessages, body.systemPrompt)

  await Promise.allSettled(modelsToCompare.map(async (model, idx) => {
    if (abortController.signal.aborted) return
    const startTime = Date.now()
    let firstTokenMs: number | null = null

    const keepAlive = setInterval(() => {
      if (!response.writableEnded) response.write(': \n\n')
    }, 5_000)

    try {
      const ollamaRes = await fetch(`${ollamaBaseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: builtMessages,
          stream: true,
          keep_alive: '60m',
          options: { temperature, num_ctx: numCtx },
        }),
        signal: abortController.signal,
      })

      if (!ollamaRes.ok || !ollamaRes.body) {
        const errText = await ollamaRes.text().catch(() => '')
        if (!response.writableEnded)
          sendEvent(response, 'model_error', { idx, model, error: errText || `Ollama returned ${ollamaRes.status}` })
        return
      }

      const reader = ollamaRes.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let finalData: OllamaChatChunk | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const chunk = JSON.parse(line) as OllamaChatChunk
            if (chunk.message?.content) {
              if (firstTokenMs === null) firstTokenMs = Date.now() - startTime
              if (!response.writableEnded)
                sendEvent(response, 'token', { idx, model, token: chunk.message.content })
            }
            if (chunk.done) finalData = chunk
          } catch { /* skip malformed */ }
        }
      }

      const tokensPerSec = finalData?.eval_count && finalData?.total_duration
        ? Math.round(finalData.eval_count / (finalData.total_duration / 1e9))
        : undefined

      if (!response.writableEnded) {
        sendEvent(response, 'model_done', {
          idx, model, firstTokenMs,
          promptTokens: finalData?.prompt_eval_count,
          responseTokens: finalData?.eval_count,
          tokensPerSec,
        })
      }
    } catch (err) {
      if (!abortController.signal.aborted && !response.writableEnded) {
        sendEvent(response, 'model_error', { idx, model, error: err instanceof Error ? err.message : 'Failed' })
      }
    } finally {
      clearInterval(keepAlive)
    }
  }))

  if (!response.writableEnded) {
    sendEvent(response, 'all_done', {})
    response.end()
  }
})

app.post('/api/pull-model', async (request, response) => {
  const user = await requireActionPermission(request, response, 'apply-with-approval')
  if (!user) return
  const { name } = request.body as { name?: string }
  if (!name?.trim()) {
    response.status(400).json({ error: 'Model name is required' })
    return
  }

  response.writeHead(200, {
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Content-Type': 'text/event-stream',
    'X-Accel-Buffering': 'no',
  })

  const abortController = new AbortController()
  request.on('close', () => abortController.abort())

  try {
    const pullResponse = await fetch(`${ollamaBaseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), stream: true }),
      signal: abortController.signal,
    })

    if (!pullResponse.ok || !pullResponse.body) {
      const errorText = await pullResponse.text()
      sendEvent(response, 'error', { message: errorText || `Ollama returned ${pullResponse.status}` })
      response.end()
      return
    }

    const reader = pullResponse.body.getReader()
    const decoder = new TextDecoder()
    let lineBuffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      lineBuffer += decoder.decode(value, { stream: true })
      const lines = lineBuffer.split('\n')
      lineBuffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const data = JSON.parse(trimmed) as {
            status?: string
            digest?: string
            total?: number
            completed?: number
            error?: string
          }
          if (data.error) {
            sendEvent(response, 'error', { message: data.error })
            response.end()
            return
          }
          sendEvent(response, 'progress', {
            status: data.status ?? '',
            digest: data.digest,
            total: data.total,
            completed: data.completed,
          })
        } catch {
          // skip malformed NDJSON lines
        }
      }
    }

    sendEvent(response, 'done', { model: name.trim() })
  } catch (err) {
    if (!abortController.signal.aborted) {
      sendEvent(response, 'error', {
        message: err instanceof Error ? err.message : 'Pull failed',
      })
    }
  } finally {
    if (!response.writableEnded) response.end()
  }
})

// ── ask_user answer injection ──────────────────────────────────────────────────
// Called by the frontend when the user answers a question the agent posed
app.post('/api/agent/answer', async (request, response) => {
  const user = await requireActionPermission(request, response, 'apply-with-approval')
  if (!user) return
  const { id, answer } = request.body as { id?: string; answer?: string }
  if (!id || typeof answer !== 'string') {
    response.status(400).json({ error: 'id and answer are required' })
    return
  }
  const resolve = pendingAnswers.get(id)
  if (resolve) {
    pendingAnswers.delete(id)
    resolve(answer)
    response.json({ ok: true })
  } else {
    response.status(404).json({ error: 'No pending question with that id — may have timed out' })
  }
})

// ── chat history ───────────────────────────────────────────────────────────────

const HISTORY_DIR = path.resolve(process.cwd(), '.chat-history')

type HistoryMeta = { id: string; title: string; updatedAt: number; model: string }
type HistorySession = HistoryMeta & { messages: unknown[] }

function ensureHistoryDir(): void {
  if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true })
}

app.get('/api/history', async (request, response) => {
  const user = await requireActionPermission(request, response, 'read-only')
  if (!user) return
  try {
    ensureHistoryDir()
    const files = fs.readdirSync(HISTORY_DIR).filter((f) => f.endsWith('.json'))
    const sessions: HistoryMeta[] = []
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(HISTORY_DIR, file), 'utf-8')
        const s = JSON.parse(raw) as HistorySession
        sessions.push({ id: s.id, title: s.title, updatedAt: s.updatedAt, model: s.model })
      } catch { /* skip corrupt files */ }
    }
    sessions.sort((a, b) => b.updatedAt - a.updatedAt)
    response.json({ sessions })
  } catch (err) {
    response.status(500).json({ error: err instanceof Error ? err.message : 'History read failed' })
  }
})

// Global history search — MUST be registered before /api/history/:id
app.get('/api/history/search', async (request, response) => {
  const user = await requireActionPermission(request, response, 'read-only')
  if (!user) return
  const q = ((request.query.q as string) ?? '').toLowerCase().trim()
  if (!q) { response.json({ results: [] }); return }
  try {
    ensureHistoryDir()
    const files = fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith('.json'))
    const results: Array<{ id: string; title: string; updatedAt: number; model: string; snippet: string }> = []
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(HISTORY_DIR, file), 'utf-8')
        const s = JSON.parse(raw) as HistorySession
        const msgs = Array.isArray(s.messages) ? s.messages as Array<{ role: string; content: string }> : []
        for (const msg of msgs) {
          if (typeof msg.content === 'string' && msg.content.toLowerCase().includes(q)) {
            const idx = msg.content.toLowerCase().indexOf(q)
            const snippet = msg.content.slice(Math.max(0, idx - 60), idx + 120).replace(/\n/g, ' ')
            results.push({ id: s.id, title: s.title, updatedAt: s.updatedAt, model: s.model, snippet })
            break
          }
        }
      } catch { /* skip corrupt */ }
    }
    results.sort((a, b) => b.updatedAt - a.updatedAt)
    response.json({ results: results.slice(0, 40) })
  } catch (err) {
    response.status(500).json({ error: err instanceof Error ? err.message : 'Search failed' })
  }
})

app.get('/api/history/:id', async (request, response) => {
  const user = await requireActionPermission(request, response, 'read-only')
  if (!user) return
  try {
    ensureHistoryDir()
    const id = request.params.id.replace(/[^a-zA-Z0-9_-]/g, '')
    const filePath = path.join(HISTORY_DIR, `${id}.json`)
    if (!fs.existsSync(filePath)) { response.status(404).json({ error: 'Session not found' }); return }
    const session = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as HistorySession
    response.json({ session })
  } catch (err) {
    response.status(500).json({ error: err instanceof Error ? err.message : 'Read failed' })
  }
})

app.post('/api/history', async (request, response) => {
  const user = await requireActionPermission(request, response, 'apply-with-approval')
  if (!user) return
  try {
    ensureHistoryDir()
    const body = request.body as Partial<HistorySession>
    const id = body.id ?? crypto.randomUUID()
    const session: HistorySession = {
      id,
      title: (body.title ?? 'Untitled').slice(0, 80),
      updatedAt: Date.now(),
      model: body.model ?? '',
      messages: body.messages ?? [],
    }
    const filePath = path.join(HISTORY_DIR, `${id}.json`)
    await fsPromises.writeFile(filePath, JSON.stringify(session), 'utf-8')
    response.json({ id })
  } catch (err) {
    response.status(500).json({ error: err instanceof Error ? err.message : 'Save failed' })
  }
})

// Rename a history session
app.patch('/api/history/:id', async (request, response) => {
  const user = await requireActionPermission(request, response, 'apply-with-approval')
  if (!user) return
  try {
    ensureHistoryDir()
    const id = request.params.id.replace(/[^a-zA-Z0-9_-]/g, '')
    const { title } = request.body as { title?: string }
    if (!title?.trim()) { response.status(400).json({ error: 'title required' }); return }
    const filePath = path.join(HISTORY_DIR, `${id}.json`)
    if (!fs.existsSync(filePath)) { response.status(404).json({ error: 'Session not found' }); return }
    const session = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as HistorySession
    const updated = { ...session, title: title.trim().slice(0, 80), updatedAt: Date.now() }
    await fsPromises.writeFile(filePath, JSON.stringify(updated), 'utf-8')
    response.json({ ok: true })
  } catch (err) {
    response.status(500).json({ error: err instanceof Error ? err.message : 'Rename failed' })
  }
})

app.delete('/api/history/:id', async (request, response) => {
  const user = await requireActionPermission(request, response, 'apply-with-approval')
  if (!user) return
  try {
    ensureHistoryDir()
    const id = request.params.id.replace(/[^a-zA-Z0-9_-]/g, '')
    const filePath = path.join(HISTORY_DIR, `${id}.json`)
    if (fs.existsSync(filePath)) await fsPromises.unlink(filePath)
    response.json({ ok: true })
  } catch (err) {
    response.status(500).json({ error: err instanceof Error ? err.message : 'Delete failed' })
  }
})



if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.use((request, response, next) => {
    if (request.method === 'GET' && !request.path.startsWith('/api') && !request.path.startsWith('/v1')) {
      response.sendFile(path.join(distDir, 'index.html'))
      return
    }

    next()
  })
}

// ── Preview panel API ─────────────────────────────────────────────────────────

app.get('/api/previews', async (req, res) => {
  const user = await requireActionPermission(req, res, 'read-only')
  if (!user) return
  res.json(getPreviews())
})

app.get('/api/previews/applied', async (req, res) => {
  const user = await requireActionPermission(req, res, 'read-only')
  if (!user) return
  res.json(getAppliedPreviews())
})

app.post('/api/previews/:id/apply', async (req, res) => {
  const user = await requireActionPermission(req, res, 'apply-with-approval')
  if (!user) return
  const id = req.params.id.replace(/[^a-zA-Z0-9_-]/g, '')
  const result = await applyPreview(id)
  res.json(JSON.parse(result))
})

app.post('/api/previews/:id/rollback', async (req, res) => {
  const user = await requireActionPermission(req, res, 'apply-with-approval')
  if (!user) return
  const id = req.params.id.replace(/[^a-zA-Z0-9_-]/g, '')
  const result = await rollbackPreview(id)
  res.json(JSON.parse(result))
})

app.delete('/api/previews/:id', async (req, res) => {
  const user = await requireActionPermission(req, res, 'apply-with-approval')
  if (!user) return
  const id = req.params.id.replace(/[^a-zA-Z0-9_-]/g, '')
  const removed = discardPreview(id)
  res.json({ ok: removed })
})

// ── Voice transcription endpoint ───────────────────────────────────────────────
// Accepts raw audio binary (webm/ogg/mp4) from browser MediaRecorder
app.post('/api/transcribe', express.raw({ type: '*/*', limit: '25mb' }), async (req, res) => {
  const user = await requireActionPermission(req, res, 'read-only')
  if (!user) return
  try {
    const ext = (req.headers['x-audio-format'] as string) ?? 'webm'
    const tmpFile = path.join(tmpdir(), `lumivex-voice-${Date.now()}.${ext}`)
    await fsPromises.writeFile(tmpFile, req.body as Buffer)
    const result = await transcribeAudio({ file: tmpFile })
    await fsPromises.unlink(tmpFile).catch(() => {})
    res.json({ transcript: result })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// ── Smart conversation title ────────────────────────────────────────────────────
// Uses the first user+assistant turn to generate a concise 4-6 word title
app.post('/api/title', async (req, res) => {
  const user = await requireActionPermission(req, res, 'read-only')
  if (!user) return
  const { messages } = req.body as { messages?: Array<{ role: string; content: string }> }
  if (!messages?.length) { res.json({ title: 'Conversation' }); return }
  try {
    const r = await fetch(`${ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: auxiliaryModel(),
        messages: [
          { role: 'system', content: 'Generate a concise 4-6 word title for this conversation. Output ONLY the title, no quotes, no punctuation at the end, no explanation.' },
          ...messages.slice(0, 2).map(m => ({ ...m, content: m.content.slice(0, 400) })),
        ],
        stream: false,
        options: { temperature: 0.3, num_ctx: 1024, num_predict: 20 },
      }),
      signal: AbortSignal.timeout(12_000),
    })
    if (!r.ok) throw new Error()
    const data = await r.json() as { message?: { content?: string } }
    const title = (data.message?.content ?? '').trim().replace(/^["'`]|["'`]$/g, '').slice(0, 80)
    res.json({ title: title || 'Conversation' })
  } catch {
    res.json({ title: 'Conversation' })
  }
})

// -- Follow-up + Predictive action generation ---------------------------------
// Returns SUGGEST questions, optional ASK clarifiers, and PREDICT agent actions.
app.post('/api/followups', async (req, res) => {
  const user = await requireActionPermission(req, res, 'read-only')
  if (!user) return
  const { messages } = req.body as { messages?: Array<{ role: string; content: string }> }
  if (!messages?.length) { res.json({ suggestions: [] }); return }
  try {
    const r = await fetch(`${ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: auxiliaryModel(),
        messages: [
          {
            role: 'system',
            content: [
              'Analyze this conversation and produce follow-up content in this exact format:',
              '',
              'SUGGEST: [question the user might ask next, max 12 words]',
              'SUGGEST: [another useful question, max 12 words]',
              '',
              'Then add ONE of these (not both) only when clearly applicable:',
              'ASK: [a clarifying question Lumivex AI needs to give a better answer]',
              'PREDICT: [emoji] [label] | [specific task Lumivex AI can execute with tools, max 20 words]',
              '',
              'WHEN TO ADD PREDICT � only when the response involved something actionable:',
              '- Code written/reviewed ? test it, lint it, find edge cases, document it',
              '- Image analyzed ? enhance, describe in detail, apply style changes',
              '- File or path mentioned ? read it, diff it, open in editor',
              '- Complex analysis done ? verify sources, go deeper, save findings',
              '- Simple Q&A or casual chat ? NO PREDICT, NO ASK',
              '',
              'PREDICT format examples:',
              '  PREDICT: ?? Test this code | Run in sandbox and show output and any errors',
              '  PREDICT: ?? Find edge cases | Analyze for null handling and runtime failures',
              '  PREDICT: ?? Add documentation | Write docstrings and inline comments',
              '  PREDICT: ? Enhance this image | Apply AI improvements for quality and clarity',
              '  PREDICT: ?? Save to memory | Store these findings in long-term memory',
              '  PREDICT: ?? Run tests | Execute the test suite and report pass/fail results',
              '  PREDICT: ?? Research deeper | Web-search for sources and supporting evidence',
              '  PREDICT: ?? Open the file | Read and display the full file contents',
              '',
              'Output ONLY the tagged lines. No extra text, no numbering, no bullets.',
            ].join('\n'),
          },
          ...messages.slice(-4).map(m => ({ ...m, content: m.content.slice(0, 800) })),
        ],
        stream: false,
        options: { temperature: 0.65, num_ctx: 3072, num_predict: 150, repeat_penalty: 1.1, top_p: 0.9 },
      }),
      signal: AbortSignal.timeout(22_000),
    })
    if (!r.ok) throw new Error()
    const data = await r.json() as { message?: { content?: string } }
    const text = data.message?.content ?? ''
    const suggestions = text.split('\n')
      .map(l => l.trim().replace(/^["']|["']$/g, ''))
      .filter(l => l.length > 4 && l.length < 160 &&
        (l.startsWith('SUGGEST: ') || l.startsWith('ASK: ') || l.startsWith('PREDICT: ')))
      .map(l => l.startsWith('SUGGEST: ') ? l.slice(9) : l)
      .slice(0, 4)
    res.json({ suggestions })
  } catch {
    res.json({ suggestions: [] })
  }
})

// ── Run code directly from a chat code block ────────────────────────────────
// Supports: Python, JavaScript, TypeScript, Bash, PowerShell
const execAsync = promisify(exec)

type ExecError = Error & { code?: number | string; stdout?: string; stderr?: string }

function expandLocalPath(value: string | undefined): string {
  const fallback = os.homedir()
  if (!value?.trim()) return fallback
  return path.resolve(value.trim().replace(/^~(?=[/\\]|$)/, fallback))
}

function nearestExistingDirectory(value: string | undefined): string {
  let candidate = expandLocalPath(value)
  while (!fs.existsSync(candidate) && path.dirname(candidate) !== candidate) candidate = path.dirname(candidate)
  if (!fs.existsSync(candidate)) return os.homedir()
  const stat = fs.statSync(candidate)
  return stat.isDirectory() ? candidate : path.dirname(candidate)
}

async function selectProjectDestinationFolder(basePath: string | undefined): Promise<string | null> {
  const initialPath = nearestExistingDirectory(basePath)
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Choose where Lumivex AI should create the project folder'
$dialog.ShowNewFolderButton = $true
if ($env:LUMIVEX_INITIAL_DIR -and (Test-Path -LiteralPath $env:LUMIVEX_INITIAL_DIR)) {
  $dialog.SelectedPath = (Resolve-Path -LiteralPath $env:LUMIVEX_INITIAL_DIR).Path
}
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK -and $dialog.SelectedPath) {
  [Console]::Out.WriteLine($dialog.SelectedPath)
  exit 0
}
exit 2
`
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  try {
    const { stdout } = await execAsync(`powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -EncodedCommand ${encoded}`, {
      env: { ...process.env, LUMIVEX_INITIAL_DIR: initialPath },
      timeout: 5 * 60 * 1000,
      windowsHide: false,
    })
    return stdout.trim().split(/\r?\n/).find(Boolean) ?? null
  } catch (err) {
    const execError = err as ExecError
    if (Number(execError.code) === 2) return null
    const detail = (execError.stderr || execError.stdout || execError.message).trim()
    throw new Error(detail || 'Could not open the Windows folder picker')
  }
}

// ── Serve local image files (Desktop screenshots, generated images) ──────────
// Security: restricted to home directory, image extensions only
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp',
}

app.get('/api/local-file', async (req, res) => {
  const rawPath = req.query.path as string
  if (!rawPath) { res.status(400).send('path required'); return }
  const home = os.homedir()
  const resolved = path.resolve(rawPath)
  // Only allow files within the user's home directory
  if (!resolved.startsWith(home)) {
    res.status(403).send('Access denied')
    return
  }
  const ext = path.extname(resolved).toLowerCase()
  const mime = IMAGE_MIME[ext]
  if (!mime) { res.status(400).send('Not an image file'); return }
  try {
    const buf = await fsPromises.readFile(resolved)
    res.setHeader('Content-Type', mime)
    res.setHeader('Cache-Control', 'public, max-age=300')
    res.send(buf)
  } catch {
    res.status(404).send('File not found')
  }
})

// ── Memory management endpoints ──────────────────────────────────────────────// These proxy the long-term memory tools so the frontend can list/delete memories

app.get('/api/memories', async (req, res) => {
  const user = await requireActionPermission(req, res, 'read-only')
  if (!user) return
  try {
    const result = await executeTool('mem_list', { limit: '200' })
    const entries = await listMemoryEntries()
    res.json({ memories: result, entries })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.delete('/api/memories/:id', async (req, res) => {
  const user = await requireActionPermission(req, res, 'apply-with-approval')
  if (!user) return
  const id = req.params.id.replace(/[^a-zA-Z0-9_-]/g, '')
  if (!id) { res.status(400).json({ error: 'Invalid id' }); return }
  try {
    const result = await executeTool('mem_forget', { id })
    res.json({ ok: true, result })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.post('/api/memories', async (req, res) => {
  const user = await requireActionPermission(req, res, 'apply-with-approval')
  if (!user) return
  const { content, tags, confidence, source, scope, expiresAt } = req.body as {
    content?: string
    tags?: string
    confidence?: string | number
    source?: string
    scope?: MemoryScope
    expiresAt?: string
  }
  if (!content?.trim()) { res.status(400).json({ error: 'content is required' }); return }
  try {
    const conflicts = detectMemoryConflicts(content.trim(), await listMemoryEntries())
    const result = await executeTool('mem_save', {
      content: content.trim(),
      tags: tags ?? '',
      confidence: confidence?.toString() ?? '0.85',
      source: source ?? 'user',
      scope: scope ?? 'user',
      expiresAt: expiresAt ?? '',
    })
    const entries = await listMemoryEntries()
    res.json({ ok: true, result, conflicts, entries })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.post('/api/memories/:id/promote', async (req, res) => {
  const user = await requireActionPermission(req, res, 'apply-with-approval')
  if (!user) return
  const id = req.params.id.replace(/[^a-zA-Z0-9_-]/g, '')
  const body = req.body as { scope?: MemoryScope }
  if (!id) { res.status(400).json({ error: 'Invalid id' }); return }
  try {
    const entry = await promoteMemoryEntry(id, body.scope === 'project' ? 'project' : 'user')
    if (!entry) { res.status(404).json({ error: 'Memory not found' }); return }
    res.json({ ok: true, entry, entries: await listMemoryEntries() })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// ── Task management ────────────────────────────────────────────────────────────

app.get('/api/tasks', async (req, res) => {
  const user = await requireActionPermission(req, res, 'read-only')
  if (!user) return
  const tasksPath = path.join(os.homedir(), '.lumivex-tasks.json')
  try {
    if (!fs.existsSync(tasksPath)) { res.json({ tasks: [] }); return }
    const tasks = JSON.parse(fs.readFileSync(tasksPath, 'utf-8'))
    res.json({ tasks: Array.isArray(tasks) ? tasks : [] })
  } catch { res.json({ tasks: [] }) }
})

app.post('/api/tasks', async (req, res) => {
  const user = await requireActionPermission(req, res, 'apply-with-approval')
  if (!user) return
  const { title, due, priority, tags, notes } = req.body as Record<string, string | undefined>
  if (!title?.trim()) { res.status(400).json({ error: 'title is required' }); return }
  try {
    const result = await executeTool('task_add', {
      title: title.trim(),
      ...(due?.trim() && { due: due.trim() }),
      priority: priority || 'medium',
      ...(tags?.trim() && { tags: tags.trim() }),
      ...(notes?.trim() && { notes: notes.trim() }),
    })
    res.json({ ok: true, message: result })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

app.patch('/api/tasks/:id/done', async (req, res) => {
  const user = await requireActionPermission(req, res, 'apply-with-approval')
  if (!user) return
  const id = req.params.id.replace(/[^a-zA-Z0-9_-]/g, '')
  try {
    const result = await executeTool('task_done', { id })
    res.json({ ok: true, message: result })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

app.delete('/api/tasks/:id', async (req, res) => {
  const user = await requireActionPermission(req, res, 'apply-with-approval')
  if (!user) return
  const id = req.params.id.replace(/[^a-zA-Z0-9_-]/g, '')
  try {
    const result = await executeTool('task_delete', { id })
    res.json({ ok: true, message: result })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

// ── Prompt enhancement ─────────────────────────────────────────────────────────
// AI-rewrites the user's draft for clarity, precision, and specificity

app.post('/api/enhance', async (req, res) => {
  const user = await requireActionPermission(req, res, 'read-only')
  if (!user) return
  const { prompt, model } = req.body as { prompt?: string; model?: string }
  if (!prompt?.trim()) { res.status(400).json({ error: 'prompt is required' }); return }
  try {
    const r = await fetch(`${ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: auxiliaryModel(model),
        messages: [
          {
            role: 'system',
            content: 'You are a prompt optimization expert. Rewrite the user\'s input as a clear, specific, well-structured AI prompt. Improve precision, remove ambiguity, add relevant constraints, and specify the desired output format when helpful. Preserve the original intent exactly. Output ONLY the improved prompt — no commentary, no explanation, no surrounding quotes.',
          },
          { role: 'user', content: prompt.trim() },
        ],
        stream: false,
        options: { temperature: 0.3, num_ctx: 2048, num_predict: 600 },
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!r.ok) throw new Error(`Ollama returned ${r.status}`)
    const data = await r.json() as { message?: { content?: string } }
    const enhanced = data.message?.content?.trim()
    if (!enhanced) throw new Error('Model returned no output')
    res.json({ enhanced })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Enhancement failed' })
  }
})

// ── Self-Upgrade ────────────────────────────────────────────────────────────
// Lumivex AI reads its own codebase and proposes changes via preview_write.
// ALL writes go through the preview/approval flow — nothing is applied automatically.

const SELF_UPGRADE_ALLOWED_TOOLS = [
  'read_file', 'list_directory', 'code_search',
  'diff_files', 'lint_code', 'preview_write',
]

const SELF_UPGRADE_SYSTEM = `You are Lumivex AI's self-improvement agent. Analyze the Lumivex AI codebase and implement the requested improvement.

WORKSPACE: ${process.cwd()}

MANDATORY GUARDRAILS — NEVER VIOLATE:
1. You may ONLY call these tools: read_file, list_directory, code_search, diff_files, lint_code, preview_write
2. ALL file modifications MUST use preview_write. The user reviews and approves changes in the Preview panel.
3. ONLY modify files in src/ or server/ subdirectories. Never touch: package.json, tsconfig*.json, node_modules, .env, dist/, .chat-history, *.jsonl, vite.config.ts, electron/
4. Edits must be minimal and surgical. Never rewrite entire files.
5. After each preview_write, call lint_code on the modified file to check for TypeScript errors.
6. If lint shows new errors from your edit, fix them with another preview_write before continuing.
7. Stay within the requested scope. Do not expand beyond what was asked.
8. Treat each task as a backlog item. Report risk, impact, files affected, validation performed, and rollback notes.

ARCHITECTURE OVERVIEW:
- src/App.tsx — main React app (chat, panels, streaming handlers)
- src/components/ — UI panels: AgentTrace, TaskPanel, ComparePanel, SelfUpgradePanel, etc.
- src/types.ts — shared TypeScript types
- src/App.css / src/index.css — all styles (CSS variables for theming)
- server/index.ts — Express server, all REST and SSE endpoints
- server/agent.ts — ReAct agent loop with streaming and tool execution
- server/tools/ — 150 individual tool modules
- server/observer.ts — passive screen awareness
- server/selfhealer.ts — TypeScript error detection and healing

When finished: summarize what you proposed and remind the user to check the Preview panel.`

function selfUpgradeSafetySnapshot(stage: 'before' | 'after') {
  return {
    stage,
    checkedAt: Date.now(),
    pendingPreviews: getPreviews().length,
    appliedPreviews: getAppliedPreviews().filter(preview => !preview.rolledBackAt).length,
    rollbackablePreviews: getAppliedPreviews().filter(preview => preview.rollbackAvailable && !preview.rolledBackAt).length,
    toolCount: toolDefinitions.length,
  }
}

app.get('/api/self-upgrade', async (request, response) => {
  const user = await requireActionPermission(request, response, 'read-only')
  if (!user) return
  response.json({ ...getSelfUpgradeSnapshot(), appliedPreviews: getAppliedPreviews(), safety: selfUpgradeSafetySnapshot('before') })
})

app.patch('/api/self-upgrade/backlog/:id', async (request, response) => {
  const user = await requireActionPermission(request, response, 'apply-with-approval')
  if (!user) return
  const id = request.params.id.replace(/[^a-zA-Z0-9_-]/g, '')
  const item = updateSelfUpgradeBacklogItem(id, request.body ?? {})
  if (!item) { response.status(404).json({ error: 'Backlog item not found' }); return }
  response.json({ item, snapshot: getSelfUpgradeSnapshot() })
})

app.post('/api/self-upgrade', async (request, response) => {
  const user = await requireActionPermission(request, response, 'draft-changes')
  if (!user) return
  const { task, model, packId } = request.body as { task?: string; model?: string; packId?: string }
  const pack = getUpgradePack(packId)
  const taskText = task?.trim() || pack?.task || ''
  if (!taskText) {
    response.status(400).json({ error: 'task is required' })
    return
  }

  const backlogItem = recordSelfUpgradeRun(taskText, pack?.id)

  response.writeHead(200, {
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Content-Type': 'text/event-stream',
    'X-Accel-Buffering': 'no',
  })
  response.flushHeaders()
  if (response.socket) response.socket.setTimeout(0)

  const abortController = new AbortController()
  const detectDisconnect = response.socket ?? request
  detectDisconnect.once('close', () => { if (!response.writableEnded) abortController.abort() })

  sendEvent(response, 'self_upgrade_status', {
    stage: 'backlog_recorded',
    item: backlogItem,
    pack,
    health: selfUpgradeSafetySnapshot('before'),
  })

  const agentOptions: import('./agent.js').AgentOptions = {
    model: sanitizeModel(model) || defaultModel,
    temperature: 0.2,
    systemContent: SELF_UPGRADE_SYSTEM,
    ollamaBaseUrl,
    maxIterations: 15,
    numCtx: 16384,
    allowedTools: SELF_UPGRADE_ALLOWED_TOOLS,
  }

  try {
    await runAgent(
      [{ role: 'user', content: buildSelfUpgradePrompt(taskText, backlogItem, pack) }],
      agentOptions,
      response,
      abortController.signal,
    )
    updateSelfUpgradeBacklogItem(backlogItem.id, { status: getPreviews().length > 0 ? 'previewed' : 'pending' })
    sendEvent(response, 'self_upgrade_status', {
      stage: 'after_run',
      item: updateSelfUpgradeBacklogItem(backlogItem.id, { status: getPreviews().length > 0 ? 'previewed' : 'pending' }),
      health: selfUpgradeSafetySnapshot('after'),
      appliedPreviews: getAppliedPreviews().slice(0, 8),
    })
  } catch (err) {
    if (!abortController.signal.aborted && !response.writableEnded) {
      updateSelfUpgradeBacklogItem(backlogItem.id, { status: 'pending' })
      sendEvent(response, 'error', { error: err instanceof Error ? err.message : 'Self-upgrade failed' })
    }
  } finally {
    if (!response.writableEnded) response.end()
  }
})

app.post('/api/run-code', async (req, res) => {
  const user = await requireActionPermission(req, res, 'apply-with-approval')
  if (!user) return
  const { code, lang } = req.body as { code?: string; lang?: string }
  if (!code?.trim()) { res.json({ output: '', error: false }); return }

  const extMap: Record<string, string> = {
    python: '.py', py: '.py',
    javascript: '.js', js: '.js',
    typescript: '.ts', ts: '.ts',
    bash: '.sh', sh: '.sh',
    powershell: '.ps1', ps1: '.ps1',
  }
  const l = (lang ?? '').toLowerCase()
  const ext = extMap[l] ?? '.js'
  const tmpFile = path.join(tmpdir(), `lumivex-run-${Date.now()}${ext}`)

  const cmdMap: Record<string, string> = {
    '.py': `python "${tmpFile}"`,
    '.js': `node "${tmpFile}"`,
    '.ts': `npx --yes tsx "${tmpFile}"`,
    '.sh': `bash "${tmpFile}"`,
    '.ps1': `powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`,
  }
  const cmd = cmdMap[ext] ?? `node "${tmpFile}"`

  try {
    await fsPromises.writeFile(tmpFile, code)
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: 30_000,
      cwd: process.cwd(),
      maxBuffer: 1024 * 512,
    })
    const output = (stdout + (stderr ? `\nstderr: ${stderr}` : '')).slice(0, 8000)
    res.json({ output: output || '(no output)', error: false })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.json({ output: msg.slice(0, 4000), error: true })
  } finally {
    await fsPromises.unlink(tmpFile).catch(() => {})
  }
})

// ── Self-Healer API ───────────────────────────────────────────────────────────

app.get('/api/healer/status', (_req, res) => {
  res.json(getHealerState())
})

app.post('/api/healer/scan', async (req, res) => {
  const user = await requireActionPermission(req, res, 'read-only')
  if (!user) return
  const issues = await scanForIssues(process.cwd())
  res.json({ issues, count: issues.length, errors: issues.filter(i => i.severity === 'error').length })
})

// Analyze and propose a fix via SSE (streams progress to the frontend)
app.post('/api/healer/analyze', async (req, res) => {
  const user = await requireActionPermission(req, res, 'draft-changes')
  if (!user) return
  const { issueId } = req.body as { issueId?: string }
  const state = getHealerState()
  const issue = state.issues.find(i => i.id === issueId)

  if (!issue) { res.status(404).json({ error: 'Issue not found — run a scan first' }); return }

  const check = canHeal()
  if (!check.allowed) { res.status(429).json({ error: check.reason }); return }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders()

  const write = (event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  setHealingStatus(true, issue.id)
  write('status', { message: `Analyzing ${issue.relativePath}:${issue.line}…` })

  const HEALER_TOOLS = ['read_file', 'code_search', 'lint_code', 'preview_write']

  try {
    const agentOutput = await runAgentHeadless(
      buildHealerPrompt(issue),
      {
        model: defaultModel,
        temperature: 0.1,
        systemContent: '',
        ollamaBaseUrl,
        maxIterations: 6,
        numCtx: 4096,
        allowedTools: HEALER_TOOLS,
      },
    )

    const cannotHeal = agentOutput.startsWith('CANNOT_HEAL:')
    const success = !cannotHeal && !agentOutput.toLowerCase().includes('unable to fix')

    const logEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      issue: {
        relativePath: issue.relativePath,
        line: issue.line,
        code: issue.code,
        message: issue.message,
      },
      agentSummary: agentOutput.slice(0, 300),
      success,
    }
    addHealLog(logEntry)

    write('result', {
      success,
      cannotHeal,
      summary: agentOutput,
      message: success
        ? 'Fix proposed — check the Preview panel to review and apply.'
        : cannotHeal
          ? agentOutput
          : 'The agent could not produce a fix. Try fixing manually.',
    })
  } catch (err) {
    write('error', { message: err instanceof Error ? err.message : 'Heal failed' })
  } finally {
    setHealingStatus(false)
    res.end()
  }
})
// Drop-in replacement for the OpenAI API — lets any OpenAI-compatible client
// (Python openai library, Continue.dev, LangChain, curl, etc.) use Lumivex AI/Ollama.
// Usage:  openai.base_url = "http://localhost:8787/v1"
//         Authorization header is accepted but ignored (local server)

// Accept any bearer token (local — no auth needed)
app.use('/v1', (_req, _res, next) => next())

// GET /v1/models — list available Ollama models in OpenAI format
app.get('/v1/models', async (_req, res) => {
  try {
    const tags = await fetchOllamaTags(4000)
    const models = (tags.models ?? []).map(m => ({
      id: m.name,
      object: 'model',
      created: m.modified_at ? Math.floor(new Date(m.modified_at).getTime() / 1000) : Math.floor(Date.now() / 1000),
      owned_by: 'ollama',
      permission: [],
      root: m.name,
      parent: null,
    }))
    res.json({ object: 'list', data: models })
  } catch (err) {
    res.status(503).json({ error: { message: 'Could not list models', type: 'server_error' } })
  }
})

// GET /v1/models/:model — single model info
app.get('/v1/models/:model', async (req, res) => {
  const modelId = req.params.model
  res.json({
    id: modelId,
    object: 'model',
    created: Math.floor(Date.now() / 1000),
    owned_by: 'ollama',
  })
})

type OpenAIMessage = { role: 'system' | 'user' | 'assistant'; content: string }
type OpenAIChatRequest = {
  model?: string
  messages?: OpenAIMessage[]
  stream?: boolean
  temperature?: number
  max_tokens?: number
  top_p?: number
  frequency_penalty?: number
  presence_penalty?: number
  stop?: string | string[]
  n?: number
}

// POST /v1/chat/completions — main completions endpoint
app.post('/v1/chat/completions', async (req, res) => {
  const body = req.body as OpenAIChatRequest
  const messages = (body.messages ?? []).filter(
    m => ['system', 'user', 'assistant'].includes(m.role) && typeof m.content === 'string',
  )

  if (!messages.length) {
    res.status(400).json({ error: { message: 'messages is required', type: 'invalid_request_error' } })
    return
  }

  const model = sanitizeModel(body.model)
  const temperature = clampTemperature(body.temperature)
  const stream = body.stream === true
  const completionId = `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const created = Math.floor(Date.now() / 1000)

  const abortController = new AbortController()
  // Use response close, not request close — req fires after POST body is sent,
  // res fires only when the client actually disconnects.
  res.on('close', () => { if (!res.writableEnded) abortController.abort() })

  if (stream) {
    // ── Streaming response (SSE in OpenAI delta format) ──────────────────────
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.flushHeaders()

    if (isHostedModelProvider()) {
      try {
        const providerRes = await fetchModelChat({
          model,
          messages,
          stream: true,
          temperature,
          maxTokens: body.max_tokens,
          signal: abortController.signal,
        })

        if (!providerRes.ok || !providerRes.body) {
          const errText = await providerRes.text().catch(() => '')
          res.write(`data: ${JSON.stringify({ error: { message: errText || 'Model provider error', type: 'server_error' } })}\n\n`)
          res.write('data: [DONE]\n\n')
          res.end()
          return
        }

        const reader = providerRes.body.getReader()
        const decoder = new TextDecoder()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          res.write(decoder.decode(value, { stream: true }))
        }
        res.write(decoder.decode())
      } catch (err) {
        if (!abortController.signal.aborted) {
          const msg = err instanceof Error ? err.message : 'Stream failed'
          res.write(`data: ${JSON.stringify({ error: { message: msg, type: 'server_error' } })}\n\n`)
          res.write('data: [DONE]\n\n')
        }
      } finally {
        if (!res.writableEnded) res.end()
      }
      return
    }

    // Send the initial role delta (OpenAI convention)
    const roleChunk = {
      id: completionId, object: 'chat.completion.chunk', created, model,
      choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null, logprobs: null }],
    }
    res.write(`data: ${JSON.stringify(roleChunk)}\n\n`)

    try {
      const ollamaRes = await fetch(`${ollamaBaseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          keep_alive: '60m',
          options: { temperature, num_ctx: 8192 },
        }),
        signal: abortController.signal,
      })

      if (!ollamaRes.ok || !ollamaRes.body) {
        const errText = await ollamaRes.text().catch(() => '')
        res.write(`data: ${JSON.stringify({ error: { message: errText || 'Ollama error', type: 'server_error' } })}\n\n`)
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }

      const reader = ollamaRes.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let promptTokens = 0
      let completionTokens = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const chunk = JSON.parse(line) as OllamaChatChunk
            if (chunk.message?.content) {
              const c = { id: completionId, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content: chunk.message.content }, finish_reason: null, logprobs: null }] }
              res.write(`data: ${JSON.stringify(c)}\n\n`)
            }
            if (chunk.done) {
              promptTokens = chunk.prompt_eval_count ?? 0
              completionTokens = chunk.eval_count ?? 0
            }
          } catch { /* skip malformed */ }
        }
      }

      // Send finish chunk
      const finishChunk = { id: completionId, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop', logprobs: null }] }
      res.write(`data: ${JSON.stringify(finishChunk)}\n\n`)
      res.write('data: [DONE]\n\n')
      console.log(`[openai] stream complete — model=${model} prompt=${promptTokens} completion=${completionTokens}`)
    } catch (err) {
      if (!abortController.signal.aborted) {
        const msg = err instanceof Error ? err.message : 'Stream failed'
        res.write(`data: ${JSON.stringify({ error: { message: msg, type: 'server_error' } })}\n\n`)
        res.write('data: [DONE]\n\n')
      }
    } finally {
      if (!res.writableEnded) res.end()
    }

  } else {
    // ── Non-streaming response ────────────────────────────────────────────────
    try {
      if (isHostedModelProvider()) {
        const providerRes = await fetchModelChat({
          model,
          messages,
          stream: false,
          temperature,
          maxTokens: body.max_tokens,
          signal: AbortSignal.timeout(180_000),
        })
        const raw = await providerRes.text()
        res.status(providerRes.ok ? 200 : providerRes.status)
          .type(providerRes.headers.get('content-type') ?? 'application/json')
          .send(raw)
        return
      }

      const ollamaRes = await fetch(`${ollamaBaseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          keep_alive: '60m',
          options: { temperature, num_ctx: 8192 },
        }),
        signal: AbortSignal.timeout(180_000),
      })

      if (!ollamaRes.ok) {
        const errText = await ollamaRes.text().catch(() => '')
        res.status(503).json({ error: { message: errText || `Ollama returned ${ollamaRes.status}`, type: 'server_error' } })
        return
      }

      const data = await ollamaRes.json() as {
        message?: { role?: string; content?: string }
        prompt_eval_count?: number
        eval_count?: number
        model?: string
      }

      res.json({
        id: completionId,
        object: 'chat.completion',
        created,
        model: data.model ?? model,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: data.message?.content ?? '',
          },
          logprobs: null,
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: data.prompt_eval_count ?? 0,
          completion_tokens: data.eval_count ?? 0,
          total_tokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
        },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Request failed'
      res.status(503).json({ error: { message: msg, type: 'server_error' } })
    }
  }
})

// Legacy OpenAI completions endpoint (some older tools still use this)
app.post('/v1/completions', async (req, res) => {
  const { model: m, prompt, stream, temperature: t } = req.body as {
    model?: string; prompt?: string; stream?: boolean; temperature?: number
  }
  // Wrap as a single-user-message chat request and forward
  req.body = { model: m, messages: [{ role: 'user', content: prompt ?? '' }], stream, temperature: t }
  // Re-invoke via internal redirect
  res.redirect(307, '/v1/chat/completions')
})

app.listen(port, async () => {
  console.log(`Lumivex AI assistant server listening on http://localhost:${port}`)
  console.log(`Model provider: ${modelProviderLabel()}`)

  // Start background scheduler — uses headless agent runner
  startScheduler((task: string, model: string) =>
    runAgentHeadless(task, {
      model,
      temperature: 0.7,
      systemContent: '',
      ollamaBaseUrl,
      maxIterations: 20,
    }),
  )

  // Init multi-agent with headless runner
  initMultiAgent(
    (prompt, opts) => runAgentHeadless(prompt, {
      model: opts.model,
      temperature: opts.temperature ?? 0.7,
      systemContent: opts.systemContent ?? '',
      ollamaBaseUrl: opts.ollamaBaseUrl,
      maxIterations: opts.maxIterations,
    }),
    { model: defaultModel, ollamaBaseUrl },
  )

  // Load plugins from plugins/ directory
  try {
    const plugins = await loadPlugins()
    for (const p of plugins) registerPlugin(p.definitions, p.handlers)
    if (plugins.length) console.log(`[plugins] ${plugins.length} plugin(s) loaded`)
  } catch (err) {
    console.error('[plugins] load error:', err instanceof Error ? err.message : String(err))
    recordRuntimeEvent('plugins', err instanceof Error ? err.message : String(err), 'error')
  }

  // Auto-start passive screen observer (fast mode, every 45s)
  startObserver(ollamaBaseUrl, 45, 'fast')

  // Pre-warm: load model into VRAM now so the first user request is fast.
  // Also sets keep_alive=30m to prevent unloading between conversations.
  // Simultaneously detect a fast model for simple one-shot tool commands.
  void (async () => {
    warmupStatus.startedAt = Date.now()
    warmupStatus.detail = isHostedModelProvider() ? 'Hosted model provider configured.' : 'Loading Ollama model cache.'
    try {
      const tags = await fetchOllamaTags(3000).catch(() => ({ models: [] as OllamaModel[] }))
      const availableNames = (tags.models ?? []).map(m => m.name)

      // Cache available model names for vision routing and other features
      cachedModelNames = availableNames

      // Detect fast model (for simple commands)
      for (const candidate of FAST_MODEL_CANDIDATES) {
        const found = availableNames.find(n => n === candidate || n.startsWith(candidate.split(':')[0] + ':'))
        if (found) { cachedFastModel = found; break }
      }

      const warmModel = bestAvailableModel(tags.models ?? [])
      warmupStatus.primaryModel = warmModel
      warmupStatus.fastModel = cachedFastModel
      if (isHostedModelProvider()) {
        warmupStatus.primaryOk = true
        warmupStatus.completedAt = Date.now()
        warmupStatus.detail = `Hosted model provider ready: ${warmModel}.`
        return
      }
      await fetch(`${ollamaBaseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: warmModel, prompt: '', keep_alive: '60m', stream: false }),
        signal: AbortSignal.timeout(60_000),
      })
      warmupStatus.primaryOk = true
      warmupStatus.completedAt = Date.now()
      warmupStatus.detail = `${warmModel} is warm.`
      console.log(`[warmup] ${warmModel} loaded and kept alive for 30 min`)
      if (cachedFastModel && cachedFastModel !== warmModel) {
        // Also warm the fast model so it's ready immediately
        void fetch(`${ollamaBaseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: cachedFastModel, prompt: '', keep_alive: '60m', stream: false }),
          signal: AbortSignal.timeout(60_000),
        }).then(() => {
          warmupStatus.fastOk = true
          warmupStatus.fastModel = cachedFastModel
          warmupStatus.detail = `${warmModel} and fast model ${cachedFastModel} are warm.`
          console.log(`[warmup] fast model ${cachedFastModel} also pre-loaded`)
        })
      }
    } catch (error) {
      warmupStatus.completedAt = Date.now()
      warmupStatus.primaryOk = false
      warmupStatus.detail = error instanceof Error ? error.message : 'Warmup failed; requests will load on demand.'
      recordRuntimeEvent('warmup', warmupStatus.detail, 'warn')
    }
  })()
})

async function fetchOllamaTags(timeoutMs: number): Promise<OllamaTagsResponse> {
  if (isHostedModelProvider()) {
    const response = await fetch(`${hostedModelBaseUrl}/models`, {
      headers: hostedModelHeaders(),
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (!response.ok) {
      throw new Error(`Model provider returned ${response.status}`)
    }

    const data = await response.json() as { data?: Array<{ id?: string; created?: number }> }
    const models = (data.data ?? [])
      .map(model => model.id?.trim())
      .filter((model): model is string => Boolean(model))
      .map(name => ({ name, model: name }))
    return { models: models.length ? models : [{ name: defaultModel, model: defaultModel }] }
  }

  const response = await fetch(`${ollamaBaseUrl}/api/tags`, {
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!response.ok) {
    throw new Error(`Ollama returned ${response.status}`)
  }

  return (await response.json()) as OllamaTagsResponse
}

function normalizeMessages(messages: AssistantRequest['messages']): ChatMessage[] {
  if (!Array.isArray(messages)) {
    return []
  }

  return messages
    .filter((message): message is ChatMessage => {
      return (
        Boolean(message) &&
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.content === 'string' &&
        message.content.trim().length > 0
      )
    })
    .slice(-30)
    .map((message) => ({
      role: message.role,
      content: message.content.trim().slice(0, 12000),
    }))
}

// Improved context compression: extracts key facts, code snippets, and decisions
// rather than just summarizing sequentially — preserves more signal per token.
async function compressContext(messages: ChatMessage[]): Promise<ChatMessage[]> {
  if (messages.length <= 18) return messages

  const toSummarise = messages.slice(0, messages.length - 10)
  const toKeep = messages.slice(messages.length - 10)

  try {
    const dialogue = toSummarise
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 600)}`)
      .join('\n')

    const r = await fetch(`${ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: defaultModel,
        messages: [
          {
            role: 'system',
            content: [
              'Extract and preserve the essential context from this conversation for a future assistant turn. Output EXACTLY this structure:',
              '',
              'ACTIVE TASK: (the user\'s current goal and what remains to be done)',
              'DECISIONS MADE: (important choices, implementation directions, rejected alternatives)',
              'ESTABLISHED FACTS: (verified facts, repo state, runtime state, constraints established so far)',
              'USER CONTEXT: (who the user is, their goal, preferences, tech stack if mentioned)',
              'KEY CONTENT: (any important code, file names, URLs, numbers, or specs — quote them exactly)',
              'VERIFICATION STATUS: (commands/tests/checks already run and their outcomes)',
              'OPEN QUESTIONS: (anything unresolved that the user cares about)',
              '',
              'Be specific and terse. Omit small talk. Preserve exact technical names, paths, values, errors, and command outcomes.',
              'Do not invent facts. If something was proposed but not verified, label it unverified.',
            ].join('\n'),
          },
          { role: 'user', content: dialogue },
        ],
        stream: false,
        options: { temperature: 0.1, num_ctx: 4096, num_predict: 400, repeat_penalty: 1.1 },
      }),
      signal: AbortSignal.timeout(25_000),
    })

    if (!r.ok) return messages
    const data = await r.json() as { message?: { content?: string } }
    const summary = data.message?.content?.trim()
    if (!summary) return messages

    return [
      { role: 'user' as const, content: `[Conversation context — established earlier]\n${summary}` },
      { role: 'assistant' as const, content: 'Understood, I have this context.' },
      ...toKeep,
    ]
  } catch {
    return messages
  }
}

function answerStylePrompt(answerStyle: AssistantRequest['answerStyle'] = 'detailed'): string {
  switch (answerStyle) {
    case 'concise':
      return 'ANSWER STYLE: Be concise. Lead with the answer, avoid extended background, and use short bullets only when they improve scanability.'
    case 'technical':
      return 'ANSWER STYLE: Be technical. Include implementation details, edge cases, precise terminology, and verification notes when relevant.'
    case 'executive':
      return 'ANSWER STYLE: Be executive. Summarize impact, decision points, risks, and next actions in business-clear language.'
    case 'detailed':
    default:
      return 'ANSWER STYLE: Be useful but natural. For action requests, keep it short and move to the next concrete step instead of giving a template-style overview.'
  }
}

function buildPrompt(messages: ChatMessage[], systemPrompt?: string, intelligenceMode: IntelligenceMode = 'balanced', answerStyle?: AssistantRequest['answerStyle']): ChatMessage[] {
  const customSystemPrompt = typeof systemPrompt === 'string' ? systemPrompt.trim() : ''
  const profilePrompt = INTELLIGENCE_CHAT_INSTRUCTIONS[intelligenceMode]
  const stylePrompt = answerStylePrompt(answerStyle)
  const systemContent = customSystemPrompt
    ? `${defaultSystemPrompt}\n\n${profilePrompt}\n\n${stylePrompt}\n\nUser operating instructions:\n${customSystemPrompt.slice(0, 4000)}`
    : `${defaultSystemPrompt}\n\n${profilePrompt}\n\n${stylePrompt}`

  return [{ role: 'system', content: systemContent }, ...messages]
}

function buildLeanKnowledgePrompt(messages: ChatMessage[], answerStyle?: AssistantRequest['answerStyle']): ChatMessage[] {
  const stylePrompt = answerStylePrompt(answerStyle)
  return [{
    role: 'system',
    content: `You are Lumivex AI. Answer the user's factual question directly and briefly. ${stylePrompt} No preamble. If uncertain, say so in one short caveat.`,
  }, ...messages]
}

function sanitizeModel(model?: string): string {
  const candidate = typeof model === 'string' ? model.trim() : ''
  return candidate || defaultModel
}

type ModelBenchmarkResult = {
  response?: string
  total_duration?: number
  load_duration?: number
  prompt_eval_duration?: number
  eval_duration?: number
  prompt_eval_count?: number
  eval_count?: number
}

function hostedChatBody(input: {
  model: string
  messages: ChatMessage[]
  stream: boolean
  temperature?: number
  maxTokens?: number
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
    stream: input.stream,
  }
  if (typeof input.temperature === 'number') body.temperature = input.temperature
  if (typeof input.maxTokens === 'number') body.max_tokens = input.maxTokens
  return body
}

async function fetchModelChat(input: {
  model: string
  messages: ChatMessage[]
  stream: boolean
  temperature?: number
  maxTokens?: number
  options?: Record<string, unknown>
  signal?: AbortSignal
}): Promise<Response> {
  if (isHostedModelProvider()) {
    return fetch(`${hostedModelBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: hostedModelHeaders(),
      body: JSON.stringify(hostedChatBody(input)),
      signal: input.signal,
    })
  }

  return fetch(`${ollamaBaseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: input.model,
      messages: input.messages,
      stream: input.stream,
      keep_alive: '60m',
      options: input.options,
    }),
    signal: input.signal,
  })
}

async function runModelBenchmark(model: string, prompt: string, maxTokens: number): Promise<ModelBenchmarkResult> {
  if (isHostedModelProvider()) {
    const startedAt = Date.now()
    const providerResponse = await fetchModelChat({
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      temperature: 0.1,
      maxTokens,
      signal: AbortSignal.timeout(90_000),
    })
    const raw = await providerResponse.text()
    if (!providerResponse.ok) throw new Error(raw || `Model provider returned ${providerResponse.status}`)
    const data = JSON.parse(raw) as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    return {
      response: data.choices?.[0]?.message?.content ?? '',
      total_duration: (Date.now() - startedAt) * 1e6,
      prompt_eval_count: data.usage?.prompt_tokens,
      eval_count: data.usage?.completion_tokens,
    }
  }

  const ollamaResponse = await fetch(`${ollamaBaseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      keep_alive: '60m',
      options: { ...buildInferenceOptions(0.1, 2048, 'instant'), num_predict: maxTokens },
    }),
    signal: AbortSignal.timeout(90_000),
  })
  const raw = await ollamaResponse.text()
  if (!ollamaResponse.ok) throw new Error(raw || `Ollama returned ${ollamaResponse.status}`)
  return JSON.parse(raw) as ModelBenchmarkResult
}

function getDirectConnectorOpenTarget(text: string): { label: string; url: string } | null {
  const trimmed = text.trim()
  if (!/^(open|launch|start|go to|navigate to|pull up|bring up)\b/i.test(trimmed)) return null
  if (/\b(read|summari[sz]e|draft|send|reply|search|find|log|create|update|delete|append|review|analy[sz]e|download|upload)\b/i.test(trimmed)) return null

  if (/\b(google|google\.com|google search)\b/i.test(trimmed) && !/\b(sheets|drive|calendar|gmail|ads|youtube)\b/i.test(trimmed)) {
    return { label: 'Google Search', url: 'https://www.google.com' }
  }

  const connector = findConnectorsForText(trimmed).find(item => item.id !== 'generic-web')
  if (!connector) return null
  return { label: connector.label, url: connector.homeUrl }
}

function isApprovalText(answer: string): boolean {
  return /^(allow|approved?|yes|y|ok|okay|grant|go ahead|proceed)\b/i.test(answer.trim())
}

async function askSsePermission(response: express.Response, question: string, context: string): Promise<boolean> {
  const id = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  sendEvent(response, 'agent_task_state', { status: 'needs_user_input', detail: question })
  sendEvent(response, 'question', { id, question, context, kind: 'permission' })
  const answer = await new Promise<string>((resolve) => {
    const timeout = setTimeout(() => {
      pendingAnswers.delete(id)
      resolve('DENY')
    }, 300_000)
    pendingAnswers.set(id, (value) => { clearTimeout(timeout); resolve(value) })
  })
  return isApprovalText(answer)
}

async function askSseText(response: express.Response, question: string, context: string, mode?: string, defaultAnswer?: string): Promise<string> {
  const id = `ask-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  sendEvent(response, 'agent_task_state', { status: 'needs_user_input', detail: question })
  sendEvent(response, 'question', { id, question, context, kind: 'question', mode, defaultAnswer })
  return new Promise<string>((resolve) => {
    const timeout = setTimeout(() => {
      pendingAnswers.delete(id)
      resolve('')
    }, 300_000)
    pendingAnswers.set(id, (value) => { clearTimeout(timeout); resolve(value.trim()) })
  })
}

function isProjectBuilderKickoff(text: string): boolean {
  const trimmed = text.trim()
  if (/^(how|what|why|explain|tell me)\b/i.test(trimmed)) return false
  return /\b(let'?s|lets|build|create|make|start|scaffold|set up)\b[\s\S]{0,80}\b(website|web site|web app|app|application|project|dashboard|api|tool|program)\b/i.test(trimmed)
}

function templateForProjectPrompt(text: string): ProjectTemplateId {
  if (/\b(api|server|backend|express)\b/i.test(text)) return 'express-api'
  if (/\b(python|cli|command line|script)\b/i.test(text)) return 'python-cli'
  if (/\b(react|vite|typescript app|dashboard|web app)\b/i.test(text)) return 'react-vite'
  return 'vanilla-ts'
}

const DEFAULT_PROJECT_BASE = '~'

function inferProjectNameFromPrompt(text: string): string {
  const explicit = text.match(/\b(?:called|named|titled|name it|title it)\s+["']?([a-z0-9][a-z0-9 ._-]{1,60})["']?/i)
  const positional = text.match(/\b(?:build|create|make|start|scaffold|set up)\s+(?:a|an|the)?\s*([a-z0-9][a-z0-9._-]{1,60})\s+(?:website|web site|web app|app|application|project|dashboard|api|tool|program)\b/i)
  const raw = explicit?.[1] ?? positional?.[1] ?? ''
  const cleaned = raw
    .replace(/\b(?:website|web site|web app|app|application|project|dashboard|api|tool|program)\b.*$/i, '')
    .replace(/\b(?:with|for|that|which|where|and)\b.*$/i, '')
    .trim()
  return cleaned || 'my-project'
}

function normalizeProjectLocationHint(value: string): string {
  const hint = value.trim().replace(/^['"]|['"]$/g, '')
  if (!hint || /^(choose|default|wherever|you choose|your choice)$/i.test(hint)) return DEFAULT_PROJECT_BASE
  if (/^desktop$/i.test(hint)) return '~/Desktop'
  if (/^documents?$/i.test(hint)) return '~/Documents'
  if (/^downloads?$/i.test(hint)) return '~/Downloads'
  if (/^projects?$/i.test(hint)) return '~/Projects'
  return hint
}

function parseProjectSetupAnswer(answer: string): { projectName: string; basePath: string } {
  const trimmed = answer.trim()
  let projectName = trimmed
  let basePath = DEFAULT_PROJECT_BASE

  const locationMatch = trimmed.match(/^(.*?)\s+(?:at|in|inside|under|on)\s+(.+)$/i)
    ?? trimmed.match(/^(.*?)\s+([A-Za-z]:[\\/].+)$/)
    ?? trimmed.match(/^(.*?)\s+(~[\\/].+)$/)

  if (locationMatch) {
    projectName = locationMatch[1].trim()
    basePath = normalizeProjectLocationHint(locationMatch[2])
  }

  const explicitLocation = trimmed.match(/^(.*?)\s*[,;]\s*(?:location|path|folder)\s*[:=]\s*(.+)$/i)
  if (explicitLocation) {
    projectName = explicitLocation[1].trim()
    basePath = normalizeProjectLocationHint(explicitLocation[2])
  }

  return { projectName: projectName || 'lumivex-project', basePath }
}

async function streamProjectBuilderKickoff(response: express.Response, prompt: string): Promise<void> {
  const templateId = templateForProjectPrompt(prompt)
  const template = PROJECT_TEMPLATES.find(item => item.id === templateId) ?? PROJECT_TEMPLATES[0]
  const suggestedName = inferProjectNameFromPrompt(prompt)
  sendEvent(response, 'agent_plan', {
    plan: {
      goal: 'Create a new programming project',
      assumptions: ['The user wants Lumivex AI to start building, not explain how to build.'],
      steps: ['Ask for the project name.', 'Ask approval for local project creation and tool opening.', 'Create the starter project.', 'Run the first validation pass.', 'Open VS Code and File Explorer.'],
      toolsNeeded: ['project-builder', 'filesystem', 'terminal', 'vscode', 'file explorer'],
      verificationMethod: 'Project Builder writes files and runs the configured build/check command.',
      doneCondition: 'Project folder exists with starter files and validation logs.',
      taskSize: 'normal',
      toolBudget: 4,
    },
  })

  const projectSetupAnswer = await askSseText(
    response,
    'What should I call it, and which parent folder should I put it inside?',
    `Template: ${template.label}\nDefault parent: ${DEFAULT_PROJECT_BASE}\nLumivex AI will create a new folder named after the project inside the parent folder you choose. Examples: ${suggestedName} | landing-page on Desktop | api-service at C:\\Projects.`,
    'project_setup',
    suggestedName
  )
  if (!projectSetupAnswer) {
    sendEvent(response, 'set_content', { content: 'No project name received, so I did not create anything.' })
    sendEvent(response, 'agent_task_state', { status: 'done', detail: 'Project build cancelled.' })
    sendEvent(response, 'done', { ok: false, reason: 'missing_project_name' })
    response.end()
    return
  }

  const { projectName, basePath } = parseProjectSetupAnswer(projectSetupAnswer)

  const approved = await askSsePermission(
    response,
    `Allow Lumivex AI to create and open ${projectName}?`,
    `Project: ${projectName}\nTemplate: ${template.label}\nLocation: ${basePath}\nActions: create files, run first check/build, open VS Code, open File Explorer.`
  )
  if (!approved) {
    sendEvent(response, 'set_content', { content: `Permission denied. I did not create ${projectName}.` })
    sendEvent(response, 'agent_task_state', { status: 'done', detail: 'Permission denied by user.' })
    sendEvent(response, 'done', { ok: false, reason: 'permission_denied' })
    response.end()
    return
  }

  const callId = crypto.randomUUID()
  sendEvent(response, 'agent_task_state', { status: 'using_tools', detail: `Creating ${projectName} with ${template.label}.` })
  sendEvent(response, 'tool_call', { id: callId, name: 'project_builder_build', args: { name: projectName, template: templateId, basePath } })
  const result = await buildProject({
    name: projectName,
    template: templateId,
    basePath,
    approved: true,
    runInstall: false,
    runBuild: true,
    openVsCode: true,
    openExplorer: true,
  })
  await rememberProject(result)
  const summary = [
    `Built ${result.projectName}`,
    `Path: ${result.projectPath}`,
    `Template: ${result.template.label}`,
    `Files: ${result.filesWritten.length}`,
    `Next: ${result.nextCommands.join(' | ') || 'ready'}`,
  ].join('\n')
  sendEvent(response, 'tool_result', { id: callId, name: 'project_builder_build', result: summary })
  sendEvent(response, 'agent_task_state', { status: 'done', detail: 'Project created and initial validation completed.' })
  sendEvent(response, 'token', { token: summary })
  sendEvent(response, 'done', { ok: true, fastPath: 'project_builder_kickoff' })
  response.end()
}

function knownWindowsFolderPath(text: string): { label: string; path: string } | null {
  const home = os.homedir()
  const folders: Array<{ label: string; path: string; pattern: RegExp }> = [
    { label: 'Downloads', path: path.join(home, 'Downloads'), pattern: /\bdownloads?\b/i },
    { label: 'Desktop', path: path.join(home, 'Desktop'), pattern: /\bdesktop\b/i },
    { label: 'Documents', path: path.join(home, 'Documents'), pattern: /\bdocuments?\b/i },
    { label: 'Pictures', path: path.join(home, 'Pictures'), pattern: /\bpictures?|photos?\b/i },
    { label: 'Music', path: path.join(home, 'Music'), pattern: /\bmusic\b/i },
    { label: 'Videos', path: path.join(home, 'Videos'), pattern: /\bvideos?\b/i },
    { label: 'Home folder', path: home, pattern: /\bhome folder|user folder|profile folder\b/i },
  ]
  return folders.find(folder => folder.pattern.test(text)) ?? null
}

function getDirectWindowsAppOpenTarget(text: string): { label: string; app: string; args?: string } | null {
  const trimmed = text.trim()
  if (!/^(open|launch|start|pull up|bring up|connect to|show me|show|take me to|go to|navigate to)\b/i.test(trimmed)) return null
  if (/\b(read|summari[sz]e|draft|send|reply|search|find|log|create|update|delete|append|review|analy[sz]e|download|upload)\b/i.test(trimmed)) return null
  if (/\b[A-Za-z]:[\\/]|(?:^|\s)~[\\/]/.test(trimmed)) return null
  const knownFolder = knownWindowsFolderPath(trimmed)
  if (knownFolder && /\b(file explorer|windows explorer|explorer|folder)\b/i.test(trimmed)) {
    return { label: knownFolder.label, app: 'explorer', args: knownFolder.path }
  }
  if (/\b(file explorer|windows explorer|explorer)\b/i.test(trimmed)) {
    return { label: 'File Explorer', app: 'explorer' }
  }
  if (/\b(powershell|power shell)\b/i.test(trimmed)) {
    return { label: 'PowerShell', app: 'powershell' }
  }
  if (/\b(command prompt|cmd)\b/i.test(trimmed)) {
    return { label: 'Command Prompt', app: 'cmd' }
  }
  if (/\b(windows terminal|terminal)\b/i.test(trimmed)) {
    return { label: 'Windows Terminal', app: 'terminal' }
  }
  return null
}

async function streamDirectConnectorOpen(response: express.Response, target: { label: string; url: string }): Promise<void> {
  const toolCallId = crypto.randomUUID()
  sendEvent(response, 'agent_plan', {
    plan: {
      goal: `Open ${target.label}`,
      assumptions: ['The user asked for a simple connector launch.'],
      steps: [`Focus an existing ${target.label} browser tab if one is already open.`, `Open ${target.url} only if no matching tab exists.`],
      toolsNeeded: ['focus_tab', 'open_browser'],
      verificationMethod: 'Tool result confirms an existing tab was focused or the browser launch command was issued.',
      doneCondition: `${target.label} is visible in the browser.`,
      taskSize: 'simple',
      toolBudget: 1,
    },
  })
  const approved = await askSsePermission(
    response,
    `Allow Lumivex AI to open ${target.label}?`,
    `External platform: ${target.label}\nURL: ${target.url}\nApproval lets Lumivex AI open this platform and continue the requested workflow for this run.`,
  )
  if (!approved) {
    const denied = `Permission denied. I did not open ${target.label}.`
    sendEvent(response, 'set_content', { content: denied })
    sendEvent(response, 'agent_task_state', { status: 'done', detail: 'Permission denied by user.' })
    sendEvent(response, 'done', { ok: false, reason: 'permission_denied' })
    response.end()
    return
  }
  sendEvent(response, 'agent_task_state', { status: 'using_tools', detail: `Looking for an existing ${target.label} tab before opening a new one.` })
  sendEvent(response, 'tool_call', { id: toolCallId, name: 'focus_tab', args: { title: target.label } })
  let result = await executeTool('focus_tab', { title: target.label })
  let toolName = 'focus_tab'
  if (/^No tab found/i.test(result) || /timed out/i.test(result)) {
    sendEvent(response, 'tool_result', { id: toolCallId, name: 'focus_tab', result })
    const openCallId = crypto.randomUUID()
    sendEvent(response, 'tool_call', { id: openCallId, name: 'open_browser', args: { url: target.url } })
    result = await executeTool('open_browser', { url: target.url })
    toolName = 'open_browser'
    sendEvent(response, 'tool_result', { id: openCallId, name: 'open_browser', result })
  } else {
    sendEvent(response, 'tool_result', { id: toolCallId, name: 'focus_tab', result })
  }
  sendEvent(response, 'agent_task_state', { status: 'done', detail: 'Single-action connector launch completed.' })
  sendEvent(response, 'token', { token: toolName === 'focus_tab' ? `${result}\nReused existing ${target.label} tab.` : result })
  sendEvent(response, 'done', { ok: true, fastPath: 'direct_connector_open' })
  response.end()
}

async function streamDirectWindowsAppOpen(response: express.Response, target: { label: string; app: string; args?: string }): Promise<void> {
  const toolCallId = crypto.randomUUID()
  sendEvent(response, 'agent_plan', {
    plan: {
      goal: `Open ${target.label}`,
      assumptions: ['The user asked for a simple local app launch.'],
      steps: [`Focus an existing ${target.label} window if one is already open.`, `Launch ${target.label} only if no matching window exists.`],
      toolsNeeded: ['open_app'],
      verificationMethod: 'Tool result confirms an existing window was focused or the app launch command was issued.',
      doneCondition: `${target.label} is visible.`,
      taskSize: 'simple',
      toolBudget: 1,
    },
  })
  const approved = await askSsePermission(
    response,
    `Allow Lumivex AI to open ${target.label}?`,
    `Local app/location: ${target.label}\nApp: ${target.app}${target.args ? `\nLocation: ${target.args}` : ''}\nApproval lets Lumivex AI open this app or location and continue the requested workflow for this run.`,
  )
  if (!approved) {
    const denied = `Permission denied. I did not open ${target.label}.`
    sendEvent(response, 'set_content', { content: denied })
    sendEvent(response, 'agent_task_state', { status: 'done', detail: 'Permission denied by user.' })
    sendEvent(response, 'done', { ok: false, reason: 'permission_denied' })
    response.end()
    return
  }
  sendEvent(response, 'agent_task_state', { status: 'using_tools', detail: `Opening ${target.label} directly; skipping model inference.` })
  const toolArgs: Record<string, string> = { app: target.app }
  if (target.args) toolArgs.args = target.args
  toolArgs.reuse = 'true'
  sendEvent(response, 'tool_call', { id: toolCallId, name: 'open_app', args: toolArgs })
  const result = await executeTool('open_app', toolArgs)
  sendEvent(response, 'tool_result', { id: toolCallId, name: 'open_app', result })
  sendEvent(response, 'agent_task_state', { status: 'done', detail: 'Single-action app launch completed.' })
  sendEvent(response, 'token', { token: result })
  sendEvent(response, 'done', { ok: true, fastPath: 'direct_windows_app_open' })
  response.end()
}

// ── Knowledge-query fast-path ─────────────────────────────────────────────────
// Pure knowledge/explanation questions never need tools and suffer from the
// 3,000-token tool-catalog overhead in the agent system prompt.
// Detect them early and bypass the full agent loop for a 6-10x faster response.
const KNOWLEDGE_OPENERS = /^(explain|what is|what are|what's|what were|which|describe|define|tell me (about|how|why)|give me (an|a|the)|how does|how do|how did|how was|how were|why is|why are|why does|why did|when did|when was|when is|who (is|was|are|were)|where (is|was)|summarize|summarise|overview|introduction to|history of|theory of|concept of|difference between|compare|pros and cons|advantages|disadvantages|meaning of|can you explain|please explain|i want to understand|help me understand)/i

const ACTION_SIGNALS = /\b(search|find|open|create|make|run|execute|build|install|download|list files|read file|write|save|delete|remove|launch|start|navigate|browse|click|type|send|email|calendar|git|terminal|shell|command|task|schedule|browser tab|screenshot|folder|directory)\.?/i

function isKnowledgeOnlyQuery(text: string): boolean {
  const t = text.trim()
  // Must look like a knowledge/explanation request...
  if (!KNOWLEDGE_OPENERS.test(t)) return false
  // ...and must NOT contain action/tool signals
  if (ACTION_SIGNALS.test(t)) return false
  // Long queries likely contain file/code context — keep in agent mode
  if (t.length > 400) return false
  return true
}
// Simple action verbs (create, open, run, copy, etc.) are intentionally excluded
// because those appear in trivial single-tool commands.
const COMPLEX_KEYWORDS = /\b(analyze|research|in detail|step by step|thorough|comprehensive|generate (a|the|me)|write (a|the|me|up)|design (a|the|my)|implement (a|the)|refactor|audit|review the|plan (a|the|my))\b/i

// True when the message looks like a short imperative command (one-shot tool dispatch).
// These don't need RAG context or screen context and can use a fast model.
// Excluded: web/browser/email/app-launch tasks — small models hallucinate those instead of calling the tool.
function isCommandLike(text: string): boolean {
  if (text.length > 100) return false
  const trimmed = text.trim()
  // Anything involving apps, browsers, websites, or email must use the main model
  if (/\b(open|launch|start|gmail|email|mail|browser|chrome|edge|firefox|safari|website|site|web|url|http|www\.|google|youtube|reddit|twitter|facebook|instagram|app|application|program|spotify|netflix|twitch|discord|slack|zoom|teams)\b/i.test(trimmed)) return false
  return /^(create|make|delete|remove|copy|move|show|list|find|get|read|close|stop|kill|take|screenshot|save|folder|file|rename)\b/i.test(trimmed)
}

// Fast model preference — first one found in Ollama wins.
const FAST_MODEL_CANDIDATES = ['llama3.2:3b', 'llama3.2', 'qwen2.5:3b', 'phi3:mini', 'phi3.5:mini', 'phi3:3.8b']
let cachedFastModel: string | null = null

function auxiliaryModel(requestedModel?: string): string {
  const requested = typeof requestedModel === 'string' && requestedModel.trim() ? requestedModel.trim() : ''
  return cachedFastModel || requested || defaultModel
}

function routeModel(body: AssistantRequest, messages: ChatMessage[], intelligenceMode: IntelligenceMode = 'balanced'): string {
  const mainModel = sanitizeModel(body.model)
  if (intelligenceMode === 'deep' || intelligenceMode === 'research') return mainModel
  // Prefer explicitly configured fast model, then fall back to server-detected one
  const fast = (typeof body.fastModel === 'string' ? body.fastModel.trim() : '') || cachedFastModel || ''
  if (!fast || fast === mainModel) return mainModel

  // Route to fast model if last user message is short and simple
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  if (!lastUser) return mainModel
  const text = lastUser.content.trim()
  const limit = intelligenceMode === 'instant' ? 180 : 120
  const isSimple = text.length < limit && !COMPLEX_KEYWORDS.test(text)
  return isSimple ? fast : mainModel
}

function clampTemperature(temperature?: number): number {
  if (typeof temperature !== 'number' || Number.isNaN(temperature)) {
    return 0.35
  }

  return Math.min(1.5, Math.max(0, temperature))
}
function streamStaticAssistantResponse(response: express.Response, content: string): void {
  sendEvent(response, 'token', { token: content })
  sendEvent(response, 'done', { ok: true, fastPath: 'external_connector' })
  response.end()
}

async function streamModelResponse(modelResponse: Response, response: express.Response): Promise<void> {
  if (isHostedModelProvider()) {
    await streamHostedChatResponse(modelResponse, response)
    return
  }
  await streamOllamaResponse(modelResponse, response)
}

async function streamOllamaResponse(ollamaResponse: Response, response: express.Response): Promise<void> {
  const reader = ollamaResponse.body?.getReader()
  if (!reader) {
    sendEvent(response, 'error', { error: 'Ollama did not provide a response stream.' })
    response.end()
    return
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let sawToken = false
  const startedAt = Date.now()
  sendEvent(response, 'stream_status', { status: 'connected', detail: 'Connected to local model stream.' })
  const progressTimer = setInterval(() => {
    if (!response.writableEnded && !sawToken) {
      sendEvent(response, 'stream_status', { status: 'waiting_for_first_token', elapsedMs: Date.now() - startedAt })
    }
  }, 2500)

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (line.trim().length === 0) {
          continue
        }

        const parsed = handleOllamaLine(line, response)
        if (parsed.token && !sawToken) {
          sawToken = true
          sendEvent(response, 'stream_status', { status: 'streaming', firstTokenMs: Date.now() - startedAt })
        }
      }
    }

    if (buffer.trim().length > 0) {
      const parsed = handleOllamaLine(buffer, response)
      if (parsed.token && !sawToken) {
        sawToken = true
        sendEvent(response, 'stream_status', { status: 'streaming', firstTokenMs: Date.now() - startedAt })
      }
    }
  } finally {
    clearInterval(progressTimer)
  }

  sendEvent(response, 'stream_status', { status: 'done', totalMs: Date.now() - startedAt })
  sendEvent(response, 'done', { ok: true })
  response.end()
}

async function streamHostedChatResponse(providerResponse: Response, response: express.Response): Promise<void> {
  const reader = providerResponse.body?.getReader()
  if (!reader) {
    sendEvent(response, 'error', { error: 'Model provider did not provide a response stream.' })
    response.end()
    return
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let sawToken = false
  const startedAt = Date.now()
  sendEvent(response, 'stream_status', { status: 'connected', detail: 'Connected to hosted model stream.' })
  const progressTimer = setInterval(() => {
    if (!response.writableEnded && !sawToken) {
      sendEvent(response, 'stream_status', { status: 'waiting_for_first_token', elapsedMs: Date.now() - startedAt })
    }
  }, 2500)

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line || line.startsWith(':')) continue
        if (!line.startsWith('data:')) continue
        const data = line.slice('data:'.length).trim()
        if (data === '[DONE]') continue
        try {
          const chunk = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string }; message?: { content?: string }; finish_reason?: string | null }>
            usage?: { prompt_tokens?: number; completion_tokens?: number }
            model?: string
          }
          const token = chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content ?? ''
          if (token) {
            sendEvent(response, 'token', { token })
            if (!sawToken) {
              sawToken = true
              sendEvent(response, 'stream_status', { status: 'streaming', firstTokenMs: Date.now() - startedAt })
            }
          }
          if (chunk.usage) {
            sendEvent(response, 'metrics', {
              model: chunk.model,
              promptTokens: chunk.usage.prompt_tokens,
              responseTokens: chunk.usage.completion_tokens,
            })
          }
        } catch (error) {
          sendEvent(response, 'error', {
            error: error instanceof Error ? error.message : 'Could not parse hosted model stream.',
          })
        }
      }
    }
  } finally {
    clearInterval(progressTimer)
  }

  sendEvent(response, 'stream_status', { status: 'done', totalMs: Date.now() - startedAt })
  sendEvent(response, 'done', { ok: true })
  response.end()
}

function handleOllamaLine(line: string, response: express.Response): { token: boolean; done: boolean } {
  try {
    const chunk = JSON.parse(line) as OllamaChatChunk

    if (chunk.error) {
      sendEvent(response, 'error', { error: chunk.error })
      return { token: false, done: false }
    }

    const token = chunk.message?.content ?? ''
    if (token) {
      sendEvent(response, 'token', { token })
    }

    if (chunk.done) {
      sendEvent(response, 'metrics', {
        model: chunk.model,
        totalDuration: chunk.total_duration,
        loadDuration: chunk.load_duration,
        promptTokens: chunk.prompt_eval_count,
        responseTokens: chunk.eval_count,
      })
    }

    return { token: Boolean(token), done: Boolean(chunk.done) }
  } catch (error) {
    sendEvent(response, 'error', {
      error: error instanceof Error ? error.message : 'Could not parse Ollama stream.',
    })
    return { token: false, done: false }
  }
}

