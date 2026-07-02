import fs from 'node:fs/promises'
import path from 'node:path'
import type { ToolDefinition, ToolHandler } from './types.js'

const ROOT = process.cwd()

function safePath(filePath: string): string {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(ROOT, filePath)
  if (!abs.startsWith(ROOT)) throw new Error('Access denied: path escapes the workspace')
  return abs
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
      },
      required: ['path', 'content'],
    },
  },
}

export const writeFile: ToolHandler = async (args) => {
  if (!args.path) return 'Error: path is required'
  try {
    const safe = safePath(args.path)
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
      },
      required: ['path'],
    },
  },
}

export const readFile: ToolHandler = async (args) => {
  if (!args.path) return 'Error: path is required'
  try {
    const safe = safePath(args.path)
    const content = await fs.readFile(safe, 'utf-8')
    if (content.length > 16000) {
      return `${content.slice(0, 16000)}\n... [${content.length - 16000} more chars truncated]`
    }
    return content
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
