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
import { sendEvent, pendingAnswers } from './shared.js'
import { runAgent, runAgentHeadless } from './agent.js'
import type { AgentOptions } from './agent.js'
import { startScheduler } from './tools/scheduler.js'
import {
  startObserver, stopObserver, observerStatus, captureNow, formatContextForAgent, loadContext,
} from './observer.js'
import { initMultiAgent } from './tools/multiagent.js'
import { loadPlugins } from './plugins/loader.js'
import { registerPlugin, executeTool } from './tools/registry.js'
import { transcribeAudio } from './tools/whisper.js'
import { getAutoContext } from './tools/rag.js'
import { getPreviews, applyPreview, discardPreview } from './tools/preview.js'
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
  domainExpertise?: string
  numCtx?: number
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
const port = Number(process.env.PORT ?? 8787)
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'
const defaultModel = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b'
const distDir = path.resolve(process.cwd(), 'dist')

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
  'You are Ultron, a precise local AI assistant running through Ollama.',
  'Be direct, practical, and honest about uncertainty.',
  'Calibrate response length to the question — short questions get short answers, complex ones get structured explanations.',
  'Never use sycophantic openers ("Certainly!", "Great question!") or hollow closers ("I hope this helps!").',
  'Use markdown only when it genuinely helps: code blocks for code, bullets for lists, prose for explanations.',
  'When uncertain, say so clearly rather than guessing.',
  'When a request needs live services, files, private data, or tools you do not have, say what is missing and offer the next best local step.',
].join(' ')

app.use(cors())
app.use(express.json({ limit: '1mb' }))

// ── Observer routes ────────────────────────────────────────────────────────────

app.get('/api/observer/status', (_req, res) => {
  res.json(observerStatus())
})

app.post('/api/observer/toggle', (req, res) => {
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

app.post('/api/observer/capture', async (_req, res) => {
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
      ollamaBaseUrl,
      models: tags.models ?? [],
    })
  } catch (error) {
    response.status(503).json({
      ok: false,
      model: defaultModel,
      ollamaBaseUrl,
      error: error instanceof Error ? error.message : 'Ollama is not reachable',
    })
  }
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
  const body = request.body as AssistantRequest
  const messages = normalizeMessages(body.messages)

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

  const abortController = new AbortController()
  request.on('close', () => abortController.abort())

  // Inject RAG + long-term memory context into the last user message
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content ?? ''
  const autoCtx = lastUserMsg.length > 12
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

  const numCtx = typeof body.numCtx === 'number' ? Math.min(32768, Math.max(512, body.numCtx)) : 8192

  try {
    const ollamaResponse = await fetch(`${ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: sanitizeModel(body.model),
        messages: buildPrompt(enrichedMessages, body.systemPrompt),
        stream: true,
        keep_alive: '60m',
        options: {
          temperature: clampTemperature(body.temperature),
          num_ctx: numCtx,
        },
      }),
      signal: abortController.signal,
    })

    if (!ollamaResponse.ok || !ollamaResponse.body) {
      const details = await ollamaResponse.text()
      sendEvent(response, 'error', {
        error: details || `Ollama returned ${ollamaResponse.status}`,
      })
      response.end()
      return
    }

    await streamOllamaResponse(ollamaResponse, response)
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
  const body = request.body as AssistantRequest
  const messages = normalizeMessages(body.messages)

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
  const domainExpertise = typeof body.domainExpertise === 'string' && body.domainExpertise.trim()
    ? `USER CONTEXT: ${body.domainExpertise.trim()}`
    : null
  const systemContent = [domainExpertise, userSystemPrompt].filter(Boolean).join('\n\n')

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
  const baseModel = routeModel(body, messages)
  const selectedModel = hasImages ? bestVisionModel(baseModel) : baseModel

  const agentOptions: AgentOptions = {
    model: selectedModel,
    temperature: clampTemperature(body.temperature),
    systemContent,
    ollamaBaseUrl,
    maxIterations: Math.min(30, Math.max(1, body.maxIterations ?? 15)),
    // Use a smaller context window for fast-model simple commands to cut prefill time
    numCtx: (() => {
      const requested = typeof body.numCtx === 'number' ? Math.min(32768, Math.max(512, body.numCtx)) : 8192
      return selectedModel !== sanitizeModel(body.model) && simpleCommand ? 3072 : requested
    })(),
    images: hasImages ? body.images : undefined,
  }

  console.log('[agent] starting, model:', agentOptions.model)
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

app.post('/api/pull-model', async (request, response) => {
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
app.post('/api/agent/answer', (request, response) => {
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

app.get('/api/history', (_request, response) => {
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

app.get('/api/history/:id', (request, response) => {
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

app.get('/api/previews', (_req, res) => {
  res.json(getPreviews())
})

app.post('/api/previews/:id/apply', async (req, res) => {
  const id = req.params.id.replace(/[^a-zA-Z0-9_-]/g, '')
  const result = await applyPreview(id)
  res.json(JSON.parse(result))
})

app.delete('/api/previews/:id', (req, res) => {
  const id = req.params.id.replace(/[^a-zA-Z0-9_-]/g, '')
  const removed = discardPreview(id)
  res.json({ ok: removed })
})

// ── Voice transcription endpoint ───────────────────────────────────────────────
// Accepts raw audio binary (webm/ogg/mp4) from browser MediaRecorder
app.post('/api/transcribe', express.raw({ type: '*/*', limit: '25mb' }), async (req, res) => {
  try {
    const ext = (req.headers['x-audio-format'] as string) ?? 'webm'
    const tmpFile = path.join(tmpdir(), `ultron-voice-${Date.now()}.${ext}`)
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
  const { messages } = req.body as { messages?: Array<{ role: string; content: string }> }
  if (!messages?.length) { res.json({ title: 'Conversation' }); return }
  try {
    const r = await fetch(`${ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: defaultModel,
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

// ── Follow-up suggestion generation ────────────────────────────────────────────
// Returns 3 short follow-up questions the user might want to ask next
app.post('/api/followups', async (req, res) => {
  const { messages } = req.body as { messages?: Array<{ role: string; content: string }> }
  if (!messages?.length) { res.json({ suggestions: [] }); return }
  try {
    const r = await fetch(`${ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: defaultModel,
        messages: [
          { role: 'system', content: 'Based on this conversation, output exactly 3 short follow-up questions the user might want to ask next. Each must be under 12 words. Output ONLY the 3 questions, one per line, no numbering, no bullets, no quotes.' },
          ...messages.slice(-4).map(m => ({ ...m, content: m.content.slice(0, 600) })),
        ],
        stream: false,
        options: { temperature: 0.75, num_ctx: 2048, num_predict: 90 },
      }),
      signal: AbortSignal.timeout(18_000),
    })
    if (!r.ok) throw new Error()
    const data = await r.json() as { message?: { content?: string } }
    const text = data.message?.content ?? ''
    const suggestions = text.split('\n')
      .map(l => l.trim().replace(/^[\d\-\*\.\)]+\s*/, '').replace(/^["']|["']$/g, ''))
      .filter(l => l.length > 4 && l.length < 100)
      .slice(0, 3)
    res.json({ suggestions })
  } catch {
    res.json({ suggestions: [] })
  }
})

// ── Run code directly from a chat code block ────────────────────────────────
// Supports: Python, JavaScript, TypeScript, Bash, PowerShell
const execAsync = promisify(exec)

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

app.get('/api/memories', async (_req, res) => {
  try {
    const result = await executeTool('mem_list', { limit: 200 })
    res.json({ memories: result })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.delete('/api/memories/:id', async (req, res) => {
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
  const { content, tags } = req.body as { content?: string; tags?: string }
  if (!content?.trim()) { res.status(400).json({ error: 'content is required' }); return }
  try {
    const result = await executeTool('mem_save', { content: content.trim(), tags: tags ?? '' })
    res.json({ ok: true, result })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.post('/api/run-code', async (req, res) => {
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
  const tmpFile = path.join(tmpdir(), `ultron-run-${Date.now()}${ext}`)

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

app.post('/api/healer/scan', async (_req, res) => {
  const issues = await scanForIssues(process.cwd())
  res.json({ issues, count: issues.length, errors: issues.filter(i => i.severity === 'error').length })
})

// Analyze and propose a fix via SSE (streams progress to the frontend)
app.post('/api/healer/analyze', async (req, res) => {
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
// (Python openai library, Continue.dev, LangChain, curl, etc.) use Ultron/Ollama.
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
  console.log(`Ultron assistant server listening on http://localhost:${port}`)
  console.log(`Ollama endpoint: ${ollamaBaseUrl}`)

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
  }

  // Auto-start passive screen observer (fast mode, every 45s)
  startObserver(ollamaBaseUrl, 45, 'fast')

  // Pre-warm: load model into VRAM now so the first user request is fast.
  // Also sets keep_alive=30m to prevent unloading between conversations.
  // Simultaneously detect a fast model for simple one-shot tool commands.
  void (async () => {
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
      await fetch(`${ollamaBaseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: warmModel, prompt: '', keep_alive: '60m', stream: false }),
        signal: AbortSignal.timeout(60_000),
      })
      console.log(`[warmup] ${warmModel} loaded and kept alive for 30 min`)
      if (cachedFastModel && cachedFastModel !== warmModel) {
        // Also warm the fast model so it's ready immediately
        void fetch(`${ollamaBaseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: cachedFastModel, prompt: '', keep_alive: '60m', stream: false }),
          signal: AbortSignal.timeout(60_000),
        }).then(() => console.log(`[warmup] fast model ${cachedFastModel} also pre-loaded`))
      }
    } catch { /* warmup is best-effort */ }
  })()
})

async function fetchOllamaTags(timeoutMs: number): Promise<OllamaTagsResponse> {
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

// Auto-compress long conversations to free context space.
// Summarises turns older than the most recent 10, keeps a rolling "memory" message.
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
          { role: 'system', content: 'Summarise the conversation below in 3-5 concise sentences. Preserve key decisions, facts, and context. Output only the summary.' },
          { role: 'user', content: dialogue },
        ],
        stream: false,
        options: { temperature: 0.2, num_ctx: 4096, num_predict: 300 },
      }),
      signal: AbortSignal.timeout(20_000),
    })

    if (!r.ok) return messages
    const data = await r.json() as { message?: { content?: string } }
    const summary = data.message?.content?.trim()
    if (!summary) return messages

    return [
      { role: 'user' as const, content: `[Earlier conversation summary]\n${summary}` },
      { role: 'assistant' as const, content: 'Understood.' },
      ...toKeep,
    ]
  } catch {
    return messages
  }
}

function buildPrompt(messages: ChatMessage[], systemPrompt?: string): ChatMessage[] {
  const customSystemPrompt = typeof systemPrompt === 'string' ? systemPrompt.trim() : ''
  const systemContent = customSystemPrompt
    ? `${defaultSystemPrompt}\n\nUser operating instructions:\n${customSystemPrompt.slice(0, 4000)}`
    : defaultSystemPrompt

  return [{ role: 'system', content: systemContent }, ...messages]
}

function sanitizeModel(model?: string): string {
  const candidate = typeof model === 'string' ? model.trim() : ''
  return candidate || defaultModel
}

// Keywords that signal the task is too complex for a fast/small model.
// Simple action verbs (create, open, run, copy, etc.) are intentionally excluded
// because those appear in trivial single-tool commands.
const COMPLEX_KEYWORDS = /\b(analyze|research|explain|summarize|compare|understand|why does|why is|why are|how does|how do|how would|what is|what are|in detail|step by step|thorough|comprehensive|detailed|generate (a|the|me)|write (a|the|me|up)|design (a|the|my)|implement (a|the)|refactor|audit|review the|plan (a|the|my))\b/i

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

function routeModel(body: AssistantRequest, messages: ChatMessage[]): string {
  const mainModel = sanitizeModel(body.model)
  // Prefer explicitly configured fast model, then fall back to server-detected one
  const fast = (typeof body.fastModel === 'string' ? body.fastModel.trim() : '') || cachedFastModel || ''
  if (!fast || fast === mainModel) return mainModel

  // Route to fast model if last user message is short and simple
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  if (!lastUser) return mainModel
  const text = lastUser.content.trim()
  const isSimple = text.length < 120 && !COMPLEX_KEYWORDS.test(text)
  return isSimple ? fast : mainModel
}

function clampTemperature(temperature?: number): number {
  if (typeof temperature !== 'number' || Number.isNaN(temperature)) {
    return 0.35
  }

  return Math.min(1.5, Math.max(0, temperature))
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

      handleOllamaLine(line, response)
    }
  }

  if (buffer.trim().length > 0) {
    handleOllamaLine(buffer, response)
  }

  sendEvent(response, 'done', { ok: true })
  response.end()
}

function handleOllamaLine(line: string, response: express.Response): void {
  try {
    const chunk = JSON.parse(line) as OllamaChatChunk

    if (chunk.error) {
      sendEvent(response, 'error', { error: chunk.error })
      return
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
  } catch (error) {
    sendEvent(response, 'error', {
      error: error instanceof Error ? error.message : 'Could not parse Ollama stream.',
    })
  }
}

