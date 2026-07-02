/**
 * Long-term semantic memory — stored in .long-memory.jsonl
 * Each entry is embedded with nomic-embed-text for cosine-similarity recall.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ToolDefinition, ToolHandler } from './types.js'

const STORE = join(process.cwd(), '.long-memory.jsonl')

type MemEntry = {
  id: string
  timestamp: string
  content: string
  tags: string[]
  embedding: number[]
}

async function embedText(text: string): Promise<number[]> {
  const res = await fetch('http://127.0.0.1:11434/api/embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'nomic-embed-text', input: text }),
    signal: AbortSignal.timeout(15_000),
  })
  const data = (await res.json()) as { embeddings?: number[][] }
  return data.embeddings?.[0] ?? []
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i]
  }
  return magA && magB ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0
}

async function loadEntries(): Promise<MemEntry[]> {
  try {
    const raw = await readFile(STORE, 'utf-8')
    return raw.trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as MemEntry)
  } catch { return [] }
}

async function appendEntry(entry: MemEntry): Promise<void> {
  await writeFile(STORE, JSON.stringify(entry) + '\n', { flag: 'a', encoding: 'utf-8' })
}

async function saveEntries(entries: MemEntry[]): Promise<void> {
  const content = entries.map(e => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : '')
  await writeFile(STORE, content, 'utf-8')
}

// ── mem_save ──────────────────────────────────────────────────────────────────

export const memSaveDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'mem_save',
    description: 'Save something to long-term semantic memory. Persists across all sessions and can be recalled by meaning, not just exact text. Use for important facts, user preferences, project context.',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The information to remember.' },
        tags: { type: 'string', description: 'Comma-separated tags (e.g. "user,preference,coding").' },
      },
      required: ['content'],
    },
  },
}

export const memSave: ToolHandler = async (args) => {
  if (!args.content) return 'Error: content required'
  try {
    const embedding = await embedText(args.content)
    const entry: MemEntry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      timestamp: new Date().toISOString(),
      content: args.content,
      tags: args.tags ? args.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      embedding,
    }
    await appendEntry(entry)
    return `Saved to long-term memory (id: ${entry.id})`
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── mem_recall ────────────────────────────────────────────────────────────────

export const memRecallDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'mem_recall',
    description: 'Search long-term memory by meaning/semantic similarity. Returns most relevant stored memories.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for.' },
        top_k: { type: 'string', description: 'Max results (default 5).' },
        tag: { type: 'string', description: 'Optional tag filter.' },
      },
      required: ['query'],
    },
  },
}

export const memRecall: ToolHandler = async (args) => {
  if (!args.query) return 'Error: query required'
  try {
    const entries = await loadEntries()
    if (!entries.length) return 'Long-term memory is empty.'
    const qEmbed = await embedText(args.query)
    const k = parseInt(args.top_k ?? '5', 10) || 5
    let candidates = entries
    if (args.tag) candidates = candidates.filter(e => e.tags.includes(args.tag))
    const scored = candidates
      .map(e => ({ e, score: cosineSim(qEmbed, e.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
    if (!scored.length) return 'No memories found.'
    return scored.map(({ e, score }) =>
      `[${e.id}] (${(score * 100).toFixed(0)}% match) ${e.timestamp.slice(0, 10)}\n${e.content}${e.tags.length ? `\nTags: ${e.tags.join(', ')}` : ''}`
    ).join('\n\n')
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── mem_list ──────────────────────────────────────────────────────────────────

export const memListDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'mem_list',
    description: 'List all long-term memories, most recent first.',
    parameters: {
      type: 'object',
      properties: {
        tag: { type: 'string', description: 'Filter by tag.' },
        limit: { type: 'string', description: 'Max results (default 20).' },
      },
    },
  },
}

export const memList: ToolHandler = async (args) => {
  try {
    let entries = await loadEntries()
    if (args.tag) entries = entries.filter(e => e.tags.includes(args.tag))
    const limit = parseInt(args.limit ?? '20', 10) || 20
    entries = entries.slice(-limit).reverse()
    if (!entries.length) return 'No memories found.'
    return entries.map(e =>
      `[${e.id}] ${e.timestamp.slice(0, 10)}: ${e.content.slice(0, 120)}${e.content.length > 120 ? '...' : ''}${e.tags.length ? ` [${e.tags.join(', ')}]` : ''}`
    ).join('\n')
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── mem_forget ────────────────────────────────────────────────────────────────

export const memForgetDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'mem_forget',
    description: 'Delete a specific long-term memory by ID.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Memory ID (from mem_list or mem_recall).' },
      },
      required: ['id'],
    },
  },
}

export const memForget: ToolHandler = async (args) => {
  if (!args.id) return 'Error: id required'
  try {
    const entries = await loadEntries()
    const filtered = entries.filter(e => e.id !== args.id)
    if (filtered.length === entries.length) return `No memory with id: ${args.id}`
    await saveEntries(filtered)
    return `Deleted memory ${args.id}`
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}
