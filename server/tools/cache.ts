import { createHash } from 'node:crypto'
import type { ToolArgs, ToolDefinition, ToolHandler } from './types.js'

type CacheEntry = {
  value: string
  ts: number
  ttl: number
  tool: string
  hits: number
}

const DEFAULT_TTL_SEC = 300
const MAX_ENTRIES = 200

const cache = new Map<string, CacheEntry>()
let cacheHits = 0
let cacheMisses = 0

function normalizeTtl(ttl?: number): number {
  return Number.isFinite(ttl) && (ttl as number) > 0 ? Math.floor(ttl as number) : DEFAULT_TTL_SEC
}

function parseTtl(value?: string): number | undefined {
  if (!value) return undefined
  const parsed = parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function parseArgsString(raw: string | undefined): Record<string, string> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, String(value)])
      )
    }
  } catch { /* ignore invalid JSON and fall back */ }
  return { value: raw }
}

function makeKey(tool: string, args: Record<string, string>): string {
  return createHash('sha256')
    .update(tool + JSON.stringify(args))
    .digest('hex')
}

function isCacheableValue(value: string): boolean {
  return !/^\s*Error[:\s]/i.test(value)
}

function evictExpired(now = Date.now()): void {
  for (const [key, entry] of cache.entries()) {
    if (now - entry.ts > entry.ttl * 1000) cache.delete(key)
  }
}

function evictOverflow(): void {
  while (cache.size > MAX_ENTRIES) {
    let oldestKey: string | null = null
    let oldestTs = Infinity
    for (const [key, entry] of cache.entries()) {
      if (entry.ts < oldestTs) {
        oldestTs = entry.ts
        oldestKey = key
      }
    }
    if (!oldestKey) break
    cache.delete(oldestKey)
  }
}

export function tryCache(tool: string, args: Record<string, string>, ttl?: number): string | null {
  evictExpired()
  const key = makeKey(tool, args)
  const entry = cache.get(key)
  if (!entry) {
    cacheMisses++
    return null
  }

  const effectiveTtl = normalizeTtl(ttl ?? entry.ttl)
  if (Date.now() - entry.ts > effectiveTtl * 1000) {
    cache.delete(key)
    cacheMisses++
    return null
  }

  entry.hits++
  cacheHits++
  return entry.value
}

export function setCache(tool: string, args: Record<string, string>, value: string, ttl?: number): void {
  if (!isCacheableValue(value)) return
  cache.set(makeKey(tool, args), {
    value,
    ts: Date.now(),
    ttl: normalizeTtl(ttl),
    tool,
    hits: 0,
  })
  evictExpired()
  evictOverflow()
}

// ── cache_status ───────────────────────────────────────────────────────────────

export const cacheStatusDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'cache_status',
    description: 'Show in-memory tool cache statistics.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
}

export const cacheStatus: ToolHandler = async () => {
  evictExpired()
  const perToolEntryCounts: Record<string, number> = {}
  let memoryEstimate = 0

  for (const [key, entry] of cache.entries()) {
    perToolEntryCounts[entry.tool] = (perToolEntryCounts[entry.tool] ?? 0) + 1
    memoryEstimate += key.length + entry.value.length + entry.tool.length + 48
  }

  const totalLookups = cacheHits + cacheMisses
  return JSON.stringify({
    total_entries: cache.size,
    memory_estimate_bytes: memoryEstimate,
    hits: cacheHits,
    misses: cacheMisses,
    hit_miss_ratio: totalLookups === 0 ? '0:0' : `${cacheHits}:${cacheMisses}`,
    hit_rate: totalLookups === 0 ? 0 : Number((cacheHits / totalLookups).toFixed(3)),
    per_tool_entry_counts: perToolEntryCounts,
  }, null, 2)
}

// ── cache_get ──────────────────────────────────────────────────────────────────

export const cacheGetDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'cache_get',
    description: 'Check whether a tool result is cached.',
    parameters: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: 'Tool name for the cached entry.' },
        args: { type: 'string', description: 'JSON string of tool arguments.' },
        ttl_sec: { type: 'string', description: 'Optional TTL override in seconds.' },
      },
      required: ['tool', 'args'],
    },
  },
}

export const cacheGet: ToolHandler = async (args: ToolArgs) => {
  const tool = (args.tool ?? '').trim()
  if (!tool) return 'Error: tool is required'
  const cached = tryCache(tool, parseArgsString(args.args), parseTtl(args.ttl_sec))
  return cached ?? 'MISS'
}

// ── cache_set ──────────────────────────────────────────────────────────────────

export const cacheSetDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'cache_set',
    description: 'Store a successful tool result in the cache.',
    parameters: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: 'Tool name for the cached entry.' },
        args: { type: 'string', description: 'JSON string of tool arguments.' },
        value: { type: 'string', description: 'Result string to cache.' },
        ttl_sec: { type: 'string', description: 'Optional TTL in seconds.' },
      },
      required: ['tool', 'args', 'value'],
    },
  },
}

export const cacheSet: ToolHandler = async (args: ToolArgs) => {
  const tool = (args.tool ?? '').trim()
  if (!tool) return 'Error: tool is required'
  if (args.value === undefined) return 'Error: value is required'
  setCache(tool, parseArgsString(args.args), args.value, parseTtl(args.ttl_sec))
  return 'OK'
}

// ── cache_clear ────────────────────────────────────────────────────────────────

export const cacheClearDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'cache_clear',
    description: 'Clear all cached results, or only results for one tool.',
    parameters: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: 'Optional tool name to clear selectively.' },
      },
    },
  },
}

export const cacheClear: ToolHandler = async (args: ToolArgs) => {
  const tool = (args.tool ?? '').trim()
  if (!tool) {
    const cleared = cache.size
    cache.clear()
    return `Cleared ${cleared} cache entr${cleared === 1 ? 'y' : 'ies'}.`
  }

  let cleared = 0
  for (const [key, entry] of cache.entries()) {
    if (entry.tool === tool) {
      cache.delete(key)
      cleared++
    }
  }
  return `Cleared ${cleared} cache entr${cleared === 1 ? 'y' : 'ies'} for ${tool}.`
}
