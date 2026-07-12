import fs from 'node:fs/promises'
import path from 'node:path'
import type { ToolDefinition, ToolHandler } from './types.js'

const ROOT = process.cwd()

function safePath(filePath: string): string {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(ROOT, filePath)
  if (!abs.startsWith(ROOT)) throw new Error('Access denied: path escapes the workspace')
  return abs
}

function splitLines(content: string): string[] {
  return content.split(/\r?\n/)
}

function truncateContent(content: string): string {
  return content.length > 16000
    ? `${content.slice(0, 16000)}\n... [${content.length - 16000} more chars truncated]`
    : content
}

function createDiffPreview(filePath: string, currentContent: string | null, nextContent: string): string {
  if (currentContent === nextContent) return `No changes for ${filePath}`
  const currentLines = currentContent === null ? [] : splitLines(currentContent)
  const nextLines = splitLines(nextContent)
  const diff = [
    `--- ${currentContent === null ? '/dev/null' : filePath}`,
    `+++ ${filePath}`,
    `@@ -1,${currentLines.length} +1,${nextLines.length} @@`,
  ]
  const maxLines = Math.max(currentLines.length, nextLines.length)
  for (let i = 0; i < maxLines; i++) {
    const before = currentLines[i]
    const after = nextLines[i]
    if (before === after) {
      if (before !== undefined) diff.push(` ${before}`)
      continue
    }
    if (before !== undefined) diff.push(`-${before}`)
    if (after !== undefined) diff.push(`+${after}`)
  }
  return truncateContent(diff.join('\n'))
}

async function buildTreeLines(currentPath: string, currentDepth: number, maxDepth: number, includeHidden: boolean, prefix = ''): Promise<string[]> {
  if (currentDepth >= maxDepth) return []
  const entries = await fs.readdir(currentPath, { withFileTypes: true })
  const visibleEntries = entries
    .filter((entry) => includeHidden || !entry.name.startsWith('.'))
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  const lines: string[] = []
  for (const [index, entry] of visibleEntries.entries()) {
    const isLast = index === visibleEntries.length - 1
    const connector = isLast ? '└── ' : '├── '
    const suffix = entry.isDirectory() ? '/' : ''
    lines.push(`${prefix}${connector}${entry.name}${suffix}`)
    if (entry.isDirectory()) {
      const childPrefix = `${prefix}${isLast ? '    ' : '│   '}`
      lines.push(...await buildTreeLines(path.join(currentPath, entry.name), currentDepth + 1, maxDepth, includeHidden, childPrefix))
    }
  }
  return lines
}

export const writeFileDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'write_file',
    description:
      'Create or overwrite a file with given content. Path is relative to the project workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path, e.g. src/utils/helper.ts' },
        content: { type: 'string', description: 'Full text content to write' },
        diff_only: { type: 'string', description: 'Set "true" to preview a diff without writing the file.' },
      },
      required: ['path', 'content'],
    },
  },
}

export const writeFile: ToolHandler = async (args) => {
  if (!args.path) return 'Error: path is required'
  try {
    const safe = safePath(args.path)
    if (args.diff_only === 'true') {
      let currentContent: string | null = null
      try {
        currentContent = await fs.readFile(safe, 'utf-8')
      } catch (err) {
        if (!(err instanceof Error && 'code' in err && err.code === 'ENOENT')) throw err
      }
      return createDiffPreview(args.path, currentContent, args.content ?? '')
    }
    await fs.mkdir(path.dirname(safe), { recursive: true })
    await fs.writeFile(safe, args.content ?? '', 'utf-8')
    return `Wrote ${(args.content ?? '').length} bytes to ${args.path}`
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`
  }
}

export const readFileDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'read_file',
    description: 'Read the contents of a file. Returns up to 8000 characters.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the workspace' },
        encoding: { type: 'string', description: 'Optional encoding: utf-8 (default) or base64.' },
      },
      required: ['path'],
    },
  },
}

export const readFile: ToolHandler = async (args) => {
  if (!args.path) return 'Error: path is required'
  try {
    const safe = safePath(args.path)
    const buffer = await fs.readFile(safe)
    if (args.encoding === 'base64') {
      return truncateContent(buffer.toString('base64'))
    }
    if (buffer.includes(0)) return `Binary file detected in ${args.path}. Try again with encoding:"base64".`
    return truncateContent(buffer.toString('utf-8'))
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`
  }
}

export const listDirectoryDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'list_directory',
    description: 'List the contents of a directory.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path relative to the workspace. Defaults to root.' },
      },
    },
  },
}

export const listDirectory: ToolHandler = async (args) => {
  const dirPath = args.path || '.'
  try {
    const safe = safePath(dirPath)
    const entries = await fs.readdir(safe, { withFileTypes: true })
    return entries.map((e) => `${e.isDirectory() ? 'DIR  ' : 'FILE '} ${e.name}`).join('\n')
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`
  }
}

export const workspaceTreeDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'workspace_tree',
    description: 'Return a tree-style directory listing of the current workspace.',
    parameters: {
      type: 'object',
      properties: {
        depth: { type: 'string', description: 'Maximum tree depth (default 2, max 5).' },
        include_hidden: { type: 'string', description: 'Set "true" to include hidden files and directories.' },
      },
    },
  },
}

export const workspaceTree: ToolHandler = async (args) => {
  try {
    const parsedDepth = parseInt(args.depth ?? '2', 10)
    const maxDepth = Number.isFinite(parsedDepth) ? Math.min(Math.max(parsedDepth, 0), 5) : 2
    const includeHidden = args.include_hidden === 'true'
    const lines = await buildTreeLines(ROOT, 0, maxDepth, includeHidden)
    return ['workspace/', ...lines].join('\n')
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`
  }
}

// -- read_pdf ------------------------------------------------------------------

export const readPdfDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'read_pdf',
    description: 'Extract text from a PDF file. Returns the full text content with page count.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative path to the PDF file.' },
      },
      required: ['path'],
    },
  },
}

export const readPdf: ToolHandler = async (args) => {
  if (!args.path) return 'Error: path is required'
  const absPath = path.isAbsolute(args.path) ? args.path : path.resolve(ROOT, args.path)
  try {
    const { createRequire } = await import('node:module')
    const _req = createRequire(import.meta.url)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfParse = _req('pdf-parse') as (buf: Buffer) => Promise<{ text: string; numpages: number }>
    const buf = await fs.readFile(absPath)
    const result = await pdfParse(buf)
    const text = result.text.length > 12000 ? `${result.text.slice(0, 12000)}\n...[truncated]` : result.text
    return `Pages: ${result.numpages}\n\n${text}`
  } catch (err) {
    return `Error reading PDF: ${err instanceof Error ? err.message : String(err)}`
  }
}
