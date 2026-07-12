import fs from 'node:fs/promises'
import { createReadStream, existsSync, appendFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { ToolDefinition, ToolHandler } from './types.js'

const OLLAMA_URL = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'
/** Default embedding model: set RAG_EMBED_MODEL env var to override (e.g. mxbai-embed-large). */
const DEFAULT_EMBED_MODEL = process.env.RAG_EMBED_MODEL ?? 'nomic-embed-text'
const STORE_PATH = path.resolve(process.cwd(), '.rag-store.jsonl')
const CHUNK_SIZE = 600
const CHUNK_OVERLAP = 60

const SUPPORTED_EXTS = new Set(['.txt', '.md', '.ts', '.tsx', '.js', '.jsx', '.py', '.json', '.html', '.css', '.csv', '.yaml', '.yml', '.sh', '.ps1', '.go', '.rb', '.rs', '.java', '.c', '.cpp', '.h'])

interface RagChunk {
  id: string
  file: string
  chunkIdx: number
  content: string
  embedding: number[]
  indexedAt: number
  contentHash?: string
  sourceMtimeMs?: number
  sourceSize?: number
}

// ── helpers ───────────────────────────────────────────────────────────────────

async function embedText(text: string, model?: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: model ?? DEFAULT_EMBED_MODEL, input: text }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`Embed error ${res.status}: ${await res.text()}`)
  const data = await res.json() as { embeddings?: number[][] }
  const emb = data.embeddings?.[0]
  if (!emb?.length) throw new Error('No embedding returned — is ' + (model ?? DEFAULT_EMBED_MODEL) + ' pulled?')
  return emb
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, mA = 0, mB = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; mA += a[i] ** 2; mB += b[i] ** 2 }
  return dot / (Math.sqrt(mA) * Math.sqrt(mB) + 1e-10)
}

function chunkText(text: string): string[] {
  // Paragraph-aware chunking: split on double newlines, recombine into ~CHUNK_SIZE blocks
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
  const chunks: string[] = []
  let current = ''
  for (const para of paragraphs) {
    if (current.length + para.length + 2 > CHUNK_SIZE && current.length > 0) {
      chunks.push(current.trim())
      // Overlap: keep last CHUNK_OVERLAP chars of current as context
      current = current.slice(-CHUNK_OVERLAP) + '\n\n' + para
    } else {
      current = current ? current + '\n\n' + para : para
    }
  }
  if (current.trim()) chunks.push(current.trim())
  // Fallback: if no paragraphs found, use character-based sliding window
  if (!chunks.length) {
    let i = 0
    while (i < text.length) {
      chunks.push(text.slice(i, i + CHUNK_SIZE))
      i += CHUNK_SIZE - CHUNK_OVERLAP
    }
  }
  return chunks
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

async function loadAllChunks(): Promise<RagChunk[]> {
  if (!existsSync(STORE_PATH)) return []
  const chunks: RagChunk[] = []
  const rl = createInterface({ input: createReadStream(STORE_PATH), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line.trim()) continue
    try { chunks.push(JSON.parse(line) as RagChunk) } catch { /* skip corrupt */ }
  }
  return chunks
}

async function getIndexedFileState(): Promise<Map<string, { contentHash?: string; chunks: number; indexedAt: number }>> {
  const chunks = await loadAllChunks()
  const state = new Map<string, { contentHash?: string; chunks: number; indexedAt: number }>()
  for (const chunk of chunks) {
    const existing = state.get(chunk.file)
    state.set(chunk.file, {
      contentHash: chunk.contentHash ?? existing?.contentHash,
      chunks: (existing?.chunks ?? 0) + 1,
      indexedAt: Math.max(existing?.indexedAt ?? 0, chunk.indexedAt),
    })
  }
  return state
}

async function rewriteStore(chunks: RagChunk[]): Promise<void> {
  writeFileSync(STORE_PATH, chunks.map((c) => JSON.stringify(c)).join('\n') + '\n', 'utf-8')
}

// ── rag_index ─────────────────────────────────────────────────────────────────

export const ragIndexDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'rag_index',
    description:
      'Index a file or directory into the local private knowledge base. Enables semantic search over your own documents, code, notes, and files. Supports: .txt .md .ts .js .py .json .html .csv .yaml and more.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative path to file or directory to index.' },
        force: { type: 'string', description: 'Set to "true" to re-index already-indexed files.' },
        recursive: { type: 'string', description: 'Set to "false" to skip subdirectories (default: recurse).' },
        model: { type: 'string', description: 'Ollama embedding model to use (default: RAG_EMBED_MODEL env var or nomic-embed-text).' },
      },
      required: ['path'],
    },
  },
}

export const ragIndex: ToolHandler = async (args) => {
  const target = (args.path ?? '').trim()
  if (!target) return 'Error: path is required'
  const absTarget = path.isAbsolute(target) ? target : path.resolve(process.cwd(), target)
  const force = args.force === 'true'
  const recursive = args.recursive !== 'false'

  const indexed = await getIndexedFileState()
  const filesToProcess: string[] = []

  async function collect(p: string) {
    try {
      const stat = await fs.stat(p)
      if (stat.isFile()) {
        if (SUPPORTED_EXTS.has(path.extname(p).toLowerCase())) filesToProcess.push(p)
      } else if (stat.isDirectory() && recursive) {
        const entries = await fs.readdir(p)
        for (const e of entries) {
          if (e.startsWith('.') || e === 'node_modules' || e === 'dist') continue
          await collect(path.join(p, e))
        }
      }
    } catch { /* skip inaccessible */ }
  }

  await collect(absTarget)

  let indexed_count = 0
  let chunk_count = 0
  let skipped_count = 0
  const errors: string[] = []
  const existingChunks = await loadAllChunks()
  let retainedChunks = existingChunks
  const newChunks: RagChunk[] = []

  for (const filePath of filesToProcess) {
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      const stat = await fs.stat(filePath)
      const contentHash = hashContent(content)
      const previous = indexed.get(filePath)
      if (!force && previous?.contentHash === contentHash) {
        skipped_count++
        continue
      }
      const chunks = chunkText(content)
      retainedChunks = retainedChunks.filter((chunk) => chunk.file !== filePath)
      for (let i = 0; i < chunks.length; i++) {
        const embedding = await embedText(chunks[i], args.model)
        const chunk: RagChunk = {
          id: `${filePath}:${i}`,
          file: filePath,
          chunkIdx: i,
          content: chunks[i],
          embedding,
          indexedAt: Date.now(),
          contentHash,
          sourceMtimeMs: stat.mtimeMs,
          sourceSize: stat.size,
        }
        newChunks.push(chunk)
        chunk_count++
      }
      indexed_count++
    } catch (err) {
      errors.push(`${path.basename(filePath)}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (newChunks.length) await rewriteStore([...retainedChunks, ...newChunks])
  const errMsg = errors.length ? `\nErrors (${errors.length}): ${errors.slice(0, 3).join('; ')}` : ''
  return `Indexed ${indexed_count} changed file(s), ${chunk_count} chunks. Skipped ${skipped_count} unchanged file(s).${errMsg}`
}

// ── rag_search ────────────────────────────────────────────────────────────────

export const ragSearchDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'rag_search',
    description:
      'Semantic search across your indexed knowledge base. Returns the most relevant passages from your documents, code, and notes. Much more powerful than keyword search.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language search query.' },
        top_k: { type: 'string', description: 'Number of results to return (default 5).' },
        file_filter: { type: 'string', description: 'Optional: filter results to files matching this substring.' },
        model: { type: 'string', description: 'Ollama embedding model to use for the query (should match the model used during indexing).' },
      },
      required: ['query'],
    },
  },
}

export const ragSearch: ToolHandler = async (args) => {
  const query = (args.query ?? '').trim()
  if (!query) return 'Error: query is required'
  const k = parseInt(args.top_k ?? '5', 10) || 5
  const filter = args.file_filter?.toLowerCase()

  let chunks = await loadAllChunks()
  if (chunks.length === 0) return 'Knowledge base is empty. Use rag_index to index some files first.'

  if (filter) chunks = chunks.filter((c) => c.file.toLowerCase().includes(filter))

  const qEmbed = await embedText(query, args.model)
  const scored = chunks
    .map((c) => ({ ...c, score: cosineSim(qEmbed, c.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)

  return scored
    .map((c, i) =>
      `[${i + 1}] ${c.file.startsWith('http') ? c.file : path.relative(process.cwd(), c.file)}#chunk-${c.chunkIdx} (score: ${c.score.toFixed(3)})\n${c.content.trim()}`,
    )
    .join('\n\n---\n\n')
}

// ── rag_status ────────────────────────────────────────────────────────────────

export const ragStatusDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'rag_status',
    description: 'Show statistics about the local knowledge base: how many files and chunks are indexed.',
    parameters: { type: 'object', properties: {} },
  },
}

export const ragStatus: ToolHandler = async (_args) => {
  const chunks = await loadAllChunks()
  if (chunks.length === 0) return 'Knowledge base is empty. Use rag_index to index files.'
  const fileSet = new Set(chunks.map((c) => c.file))
  const hashTracked = new Set(chunks.filter((c) => c.contentHash).map((c) => c.file))
  const byFile: Record<string, number> = {}
  for (const c of chunks) byFile[c.file] = (byFile[c.file] ?? 0) + 1
  const latestByFile = new Map<string, number>()
  for (const c of chunks) latestByFile.set(c.file, Math.max(latestByFile.get(c.file) ?? 0, c.indexedAt))
  const lines = Object.entries(byFile).map(([f, n]) => {
    const source = f.startsWith('http') ? f : path.relative(process.cwd(), f)
    const indexedAt = latestByFile.get(f) ? new Date(latestByFile.get(f)!).toISOString() : 'unknown time'
    const tracked = hashTracked.has(f) ? 'hash-tracked' : 'legacy/no-hash'
    return `  ${source}: ${n} chunks, ${tracked}, indexed ${indexedAt}`
  })
  return `Knowledge base: ${fileSet.size} files, ${chunks.length} total chunks, ${hashTracked.size} hash-tracked source(s)\n\n${lines.join('\n')}`
}

// ── rag_clear ─────────────────────────────────────────────────────────────────

export const ragClearDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'rag_clear',
    description: 'Remove a specific file from the knowledge base index, or clear the entire index.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File path to remove. Omit to clear the entire index.' },
      },
    },
  },
}

export const ragClear: ToolHandler = async (args) => {
  if (!existsSync(STORE_PATH)) return 'Knowledge base is already empty.'
  if (!args.file) {
    await fs.unlink(STORE_PATH).catch(() => {})
    return 'Knowledge base cleared.'
  }
  const abs = path.isAbsolute(args.file) ? args.file : path.resolve(process.cwd(), args.file)
  const chunks = await loadAllChunks()
  const filtered = chunks.filter((c) => c.file !== abs)
  const removed = chunks.length - filtered.length
  if (removed === 0) return `File not found in index: ${args.file}`
  await rewriteStore(filtered)
  return `Removed ${removed} chunk(s) for ${path.basename(args.file)}.`
}

// ── rag_index_url ─────────────────────────────────────────────────────────────

export const ragIndexUrlDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'rag_index_url',
    description: 'Fetch a web page and index its content into the local knowledge base. Makes that page searchable via rag_search. Good for documentation, articles, wikis, etc.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch and index.' },
        force: { type: 'string', description: 'Set "true" to re-index even if already indexed.' },
      },
      required: ['url'],
    },
  },
}

export const ragIndexUrl: ToolHandler = async (args) => {
  if (!args.url) return 'Error: url required'
  const urlKey = args.url // used as the "file" identifier
  try {
    const res = await fetch(args.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(15_000),
    })
    const html = await res.text()
    // Strip HTML tags
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
    if (text.length < 50) return `Error: page too short or could not extract text from ${args.url}`

    const contentHash = hashContent(text)
    const existing = await loadAllChunks()
    if (args.force !== 'true' && existing.some(c => c.file === urlKey && c.contentHash === contentHash)) {
      return `Already indexed and unchanged: ${args.url}. Use force:"true" to rebuild chunks.`
    }

    const chunks = chunkText(text)
    // Remove old entries for this URL
    const filtered = existing.filter(c => c.file !== urlKey)
    await rewriteStore(filtered)

    let indexed = 0
    for (let i = 0; i < chunks.length; i++) {
      const embedding = await embedText(chunks[i])
      const chunk: RagChunk = {
        id: `${Buffer.from(urlKey).toString('base64url').slice(0, 8)}_${i}`,
        file: urlKey,
        chunkIdx: i,
        content: chunks[i],
        embedding,
        indexedAt: Date.now(),
        contentHash,
        sourceSize: text.length,
      }
      appendFileSync(STORE_PATH, JSON.stringify(chunk) + '\n', 'utf-8')
      indexed++
    }
    return `Indexed ${indexed} chunks from ${args.url} (${text.length} chars extracted).`
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── rag_repair ────────────────────────────────────────────────────────────────

export const ragRepairDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'rag_repair',
    description: 'Scan the knowledge base index for orphan chunks (referencing files that no longer exist on disk) and optionally remove them. Safe to run anytime to keep the index clean.',
    parameters: {
      type: 'object',
      properties: {
        dry_run: { type: 'string', description: 'Set to "true" to preview orphan files without removing them (default: false — removes orphans).' },
      },
    },
  },
}

export const ragRepair: ToolHandler = async (args) => {
  if (!existsSync(STORE_PATH)) return 'Knowledge base is empty — nothing to repair.'
  const chunks = await loadAllChunks()
  if (chunks.length === 0) return 'Knowledge base is empty — nothing to repair.'

  // Separate URL chunks (never orphaned) from file chunks
  const fileChunks = chunks.filter((c) => !c.file.startsWith('http'))
  const urlChunks = chunks.filter((c) => c.file.startsWith('http'))

  // Identify orphaned file sources
  const orphanFiles = new Set<string>()
  for (const chunk of fileChunks) {
    if (!existsSync(chunk.file) && !orphanFiles.has(chunk.file)) {
      orphanFiles.add(chunk.file)
    }
  }

  if (orphanFiles.size === 0) {
    return `Knowledge base is healthy. ${chunks.length} total chunks, no orphan file references found.`
  }

  const orphanCount = fileChunks.filter((c) => orphanFiles.has(c.file)).length
  const orphanList = Array.from(orphanFiles).map((f) => `  - ${path.relative(process.cwd(), f)}`).join('\n')

  if (args.dry_run === 'true') {
    return `Dry run — found ${orphanFiles.size} orphan source(s) with ${orphanCount} chunk(s):\n${orphanList}\n\nRun rag_repair without dry_run to remove them.`
  }

  // Remove orphan chunks
  const healthy = [...fileChunks.filter((c) => !orphanFiles.has(c.file)), ...urlChunks]
  await rewriteStore(healthy)
  return `Removed ${orphanCount} orphan chunk(s) from ${orphanFiles.size} missing file(s):\n${orphanList}\n\nKnowledge base now has ${healthy.length} chunk(s).`
}

// ── Auto-context helper (used by index.ts for ambient injection) ───────────────

// ── In-memory caches ──────────────────────────────────────────────────────────

let _chunkCache: RagChunk[] | null = null
let _chunkCacheMtime = 0

/** Load chunks from disk with mtime-based cache — avoids re-reading on every request */
async function loadAllChunksCached(): Promise<RagChunk[]> {
  if (!existsSync(STORE_PATH)) return []
  try {
    const stat = await fs.stat(STORE_PATH)
    if (_chunkCache && stat.mtimeMs <= _chunkCacheMtime) return _chunkCache
    _chunkCache = await loadAllChunks()
    _chunkCacheMtime = stat.mtimeMs
    return _chunkCache
  } catch { return [] }
}

const _embedCache = new Map<string, { embedding: number[]; ts: number }>()
const EMBED_CACHE_TTL = 120_000  // 2 minutes
const EMBED_CACHE_MAX = 40

/** Embed with result cache — skip the Ollama round-trip for repeated queries */
async function cachedEmbed(text: string): Promise<number[]> {
  const key = text.slice(0, 200)
  const hit = _embedCache.get(key)
  if (hit && Date.now() - hit.ts < EMBED_CACHE_TTL) return hit.embedding
  const embedding = await embedText(text)
  if (_embedCache.size >= EMBED_CACHE_MAX) {
    // evict oldest
    let oldest = 0, oldestKey = ''
    _embedCache.forEach((v, k) => { if (!oldestKey || v.ts < oldest) { oldest = v.ts; oldestKey = k } })
    _embedCache.delete(oldestKey)
  }
  _embedCache.set(key, { embedding, ts: Date.now() })
  return embedding
}

/**
 * Run silent RAG search + long-term memory recall on user's message.
 * Returns a formatted context string to inject, or null if nothing useful found.
 *
 * Optimised:
 *  - Checks file existence before ANY embed call
 *  - Single cachedEmbed() call, reused for both RAG and memory search
 *  - Chunk results served from in-memory cache (mtime-based)
 */
export async function getAutoContext(userMessage: string): Promise<string | null> {
  if (!userMessage || userMessage.length < 10) return null

  const memStorePath = path.resolve(process.cwd(), '.long-memory.jsonl')
  const hasRag = existsSync(STORE_PATH)
  const hasMem = existsSync(memStorePath)
  if (!hasRag && !hasMem) return null   // nothing indexed — skip embed entirely

  const results: string[] = []

  // Single embed call, reused for both searches
  let qEmbed: number[]
  try { qEmbed = await cachedEmbed(userMessage) }
  catch { return null }

  // RAG search (chunks served from in-memory cache)
  if (hasRag) {
    try {
      const chunks = await loadAllChunksCached()
      if (chunks.length > 0) {
        const scored = chunks
          .map(c => ({ c, score: cosineSim(qEmbed, c.embedding) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
          .filter(x => x.score > 0.5)
        if (scored.length) {
          results.push('── Relevant from knowledge base ──')
          scored.forEach(({ c, score }) => {
            const src = c.file.startsWith('http') ? c.file : path.basename(c.file)
            results.push(`[${src}] (${(score * 100).toFixed(0)}% match)\n${c.content.slice(0, 400)}`)
          })
        }
      }
    } catch { /* silent */ }
  }

  // Long-term memory recall — reuses the same embedding
  if (hasMem) {
    try {
      const raw = await fs.readFile(memStorePath, 'utf-8')
      const entries = raw.trim().split('\n').filter(Boolean).map(l => {
        try { return JSON.parse(l) as { id: string; content: string; embedding: number[] } } catch { return null }
      }).filter(Boolean) as Array<{ id: string; content: string; embedding: number[] }>
      if (entries.length) {
        const top = entries
          .map(e => ({ e, score: cosineSim(qEmbed, e.embedding) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
          .filter(x => x.score > 0.55)
        if (top.length) {
          results.push('── Recalled from long-term memory ──')
          top.forEach(({ e, score }) => results.push(`(${(score * 100).toFixed(0)}% match) ${e.content}`))
        }
      }
    } catch { /* silent */ }
  }

  if (!results.length) return null
  return results.join('\n\n')
}
