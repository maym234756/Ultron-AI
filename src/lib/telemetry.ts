import type { IntelligenceMode, PromptRoute } from '../types'

const TELEMETRY_KEY = 'lumivex-telemetry-v1'
const MAX_ENTRIES = 200

export type TelemetryEntry = {
  id: string
  createdAt: number
  route: 'chat' | 'agent'
  intelligenceMode: IntelligenceMode
  confidence: number
  promptLength: number
  firstTokenMs?: number
  totalResponseMs: number
  toolCount: number
  model: string
  promptTokens?: number
  responseTokens?: number
  tokensPerSec?: number
  errorType?: string
}

export type TelemetrySnapshot = {
  entries: TelemetryEntry[]
  totals: {
    count: number
    errors: number
    agentRoutes: number
    chatRoutes: number
    averageFirstTokenMs: number | null
    averageTotalMs: number | null
    averageTokensPerSec: number | null
  }
}

export type PendingTelemetry = {
  id: string
  startedAt: number
  route: PromptRoute
  promptLength: number
  requestedModel: string
  firstTokenMs?: number
  toolCount: number
  model?: string
  promptTokens?: number
  responseTokens?: number
  tokensPerSec?: number
  errorType?: string
}

function readEntries(): TelemetryEntry[] {
  try {
    const raw = localStorage.getItem(TELEMETRY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter(Boolean).slice(0, MAX_ENTRIES) as TelemetryEntry[] : []
  } catch {
    return []
  }
}

function average(values: Array<number | undefined>): number | null {
  const valid = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (valid.length === 0) return null
  return Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length)
}

export function getTelemetrySnapshot(): TelemetrySnapshot {
  const entries = readEntries()
  return {
    entries,
    totals: {
      count: entries.length,
      errors: entries.filter(entry => entry.errorType).length,
      agentRoutes: entries.filter(entry => entry.route === 'agent').length,
      chatRoutes: entries.filter(entry => entry.route === 'chat').length,
      averageFirstTokenMs: average(entries.map(entry => entry.firstTokenMs)),
      averageTotalMs: average(entries.map(entry => entry.totalResponseMs)),
      averageTokensPerSec: average(entries.map(entry => entry.tokensPerSec)),
    },
  }
}

export function recordTelemetry(pending: PendingTelemetry): TelemetryEntry {
  const entry: TelemetryEntry = {
    id: pending.id,
    createdAt: Date.now(),
    route: pending.route.useAgent ? 'agent' : 'chat',
    intelligenceMode: pending.route.intelligenceMode,
    confidence: pending.route.confidence,
    promptLength: pending.promptLength,
    firstTokenMs: pending.firstTokenMs,
    totalResponseMs: Date.now() - pending.startedAt,
    toolCount: pending.toolCount,
    model: pending.model || pending.requestedModel,
    promptTokens: pending.promptTokens,
    responseTokens: pending.responseTokens,
    tokensPerSec: pending.tokensPerSec,
    errorType: pending.errorType,
  }
  const next = [entry, ...readEntries()].slice(0, MAX_ENTRIES)
  localStorage.setItem(TELEMETRY_KEY, JSON.stringify(next))
  window.dispatchEvent(new Event('lumivex-telemetry-updated'))
  return entry
}

export function clearTelemetry(): void {
  localStorage.removeItem(TELEMETRY_KEY)
  window.dispatchEvent(new Event('lumivex-telemetry-updated'))
}

export function exportTelemetry(): void {
  const snapshot = getTelemetrySnapshot()
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `lumivex-telemetry-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}