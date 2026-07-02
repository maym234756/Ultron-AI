import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { execSync } from 'node:child_process'
import type { ToolDefinition, ToolHandler } from './types.js'

// ── Shared preview store ──────────────────────────────────────────────────────

export interface PendingPreview {
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

const _previews = new Map<string, PendingPreview>()

function detectLang(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', rs: 'rust', go: 'go', java: 'java', cs: 'csharp',
    cpp: 'cpp', c: 'c', html: 'html', css: 'css', json: 'json',
    md: 'markdown', sh: 'bash', ps1: 'powershell', yaml: 'yaml', toml: 'toml',
    sql: 'sql', rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin',
  }
  return map[ext] ?? 'text'
}

/** Return all pending previews sorted oldest-first */
export function getPreviews(): PendingPreview[] {
  return [..._previews.values()].sort((a, b) => a.createdAt - b.createdAt)
}

/** Apply a preview: write the file or execute the command */
export async function applyPreview(id: string): Promise<string> {
  const p = _previews.get(id)
  if (!p) return JSON.stringify({ error: 'Preview not found' })
  _previews.delete(id)

  if (p.type === 'file' && p.path && p.newContent !== undefined) {
    await writeFile(p.path, p.newContent, 'utf-8')
    return JSON.stringify({ ok: true, message: `Written: ${p.path}` })
  }

  if (p.type === 'exec' && p.command) {
    try {
      const out = execSync(p.command, { encoding: 'utf-8', timeout: 30_000, shell: 'powershell.exe' })
      return JSON.stringify({ ok: true, output: out || '(no output)' })
    } catch (err) {
      return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return JSON.stringify({ error: 'Nothing to apply' })
}

/** Discard a preview without applying */
export function discardPreview(id: string): boolean {
  return _previews.delete(id)
}

// ── preview_write ─────────────────────────────────────────────────────────────

export const previewWriteDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'preview_write',
    description:
      'Queue a file change for user review before saving. Shows a line-by-line diff of old vs new content in the Preview panel. The user must click Apply to save or Discard to cancel. Use this instead of write_file for significant code changes so the user can review before committing.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path of the file to write' },
        content: { type: 'string', description: 'Complete new file content' },
        description: { type: 'string', description: 'One-line summary of what changed and why (shown in the Preview panel)' },
      },
      required: ['path', 'content'],
    },
  },
}

export const previewWrite: ToolHandler = async (args) => {
  const filePath = args.path?.trim()
  const content = args.content
  if (!filePath) return 'path is required'
  if (content === undefined || content === null) return 'content is required'

  let oldContent: string | null = null
  try { oldContent = readFileSync(filePath, 'utf-8') } catch { /* new file — no old content */ }

  const id = randomUUID()
  _previews.set(id, {
    id,
    type: 'file',
    path: filePath,
    oldContent,
    newContent: content,
    description: args.description ?? undefined,
    lang: detectLang(filePath),
    createdAt: Date.now(),
  })

  const isNew = oldContent === null
  return `Preview queued (id=${id}). ${isNew ? 'New file' : 'Diff ready'}: ${filePath}. Open the Preview panel to review and apply.`
}

// ── preview_exec ──────────────────────────────────────────────────────────────

export const previewExecDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'preview_exec',
    description:
      'Queue a shell command for user approval before running. Shows the command in the Preview panel. The user clicks Apply to execute or Discard to cancel. Use for destructive or irreversible commands (deletes, pushes, installs).',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute after user approval' },
        description: { type: 'string', description: 'What this command does and why' },
      },
      required: ['command'],
    },
  },
}

export const previewExec: ToolHandler = async (args) => {
  const command = args.command?.trim()
  if (!command) return 'command is required'

  const id = randomUUID()
  _previews.set(id, {
    id,
    type: 'exec',
    command,
    description: args.description ?? undefined,
    createdAt: Date.now(),
  })

  return `Command preview queued (id=${id}). User must approve before execution: \`${command}\``
}
