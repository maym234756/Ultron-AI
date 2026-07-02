/**
 * User home-directory file tools — read/write/list/move/delete/search
 * beyond the workspace root constraint of filesystem.ts
 */
import fsP from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'
import { runTerminal } from './terminal.js'
import type { ToolDefinition, ToolHandler } from './types.js'

function homePath(p: string): string {
  if (!p) return homedir()
  const expanded = p.replace(/^~(?=[/\\]|$)/, homedir())
  return path.isAbsolute(expanded) ? expanded : path.join(homedir(), expanded)
}

// ── file_read ─────────────────────────────────────────────────────────────────

export const fileReadDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'file_read',
    description: "Read any file from the user's system (Desktop, Documents, Downloads, etc.). Use ~ for home directory.",
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path, e.g. "~/Desktop/notes.txt" or "C:/Users/.../file.txt".' },
        start_line: { type: 'string', description: 'Start line (1-based) for large files.' },
        end_line: { type: 'string', description: 'End line (1-based).' },
      },
      required: ['path'],
    },
  },
}

export const fileRead: ToolHandler = async (args) => {
  if (!args.path) return 'Error: path required'
  try {
    const full = homePath(args.path)
    const raw = await fsP.readFile(full, 'utf-8')
    let content = raw
    if (args.start_line || args.end_line) {
      const lines = raw.split('\n')
      const s = parseInt(args.start_line ?? '1', 10) - 1
      const e = args.end_line ? parseInt(args.end_line, 10) : lines.length
      content = lines.slice(s, e).join('\n')
    }
    return content.length > 24000 ? content.slice(0, 24000) + '\n... [truncated]' : content
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── file_write ────────────────────────────────────────────────────────────────

export const fileWriteDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'file_write',
    description: "Create or overwrite a file anywhere in the user's home directory.",
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path (~ for home).' },
        content: { type: 'string', description: 'Content to write.' },
        append: { type: 'string', description: 'Set "true" to append instead of overwrite.' },
      },
      required: ['path', 'content'],
    },
  },
}

export const fileWrite: ToolHandler = async (args) => {
  if (!args.path || args.content === undefined) return 'Error: path and content required'
  try {
    const full = homePath(args.path)
    await fsP.mkdir(path.dirname(full), { recursive: true })
    await fsP.writeFile(full, args.content, { encoding: 'utf-8', flag: args.append === 'true' ? 'a' : 'w' })
    return `${args.append === 'true' ? 'Appended to' : 'Wrote'}: ${full}`
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── file_list ─────────────────────────────────────────────────────────────────

export const fileListDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'file_list',
    description: "List files in a directory. Defaults to Desktop.",
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path (default ~/Desktop).' },
        recursive: { type: 'string', description: 'Set "true" for recursive listing.' },
      },
    },
  },
}

export const fileList: ToolHandler = async (args) => {
  try {
    const dir = homePath(args.path ?? '~/Desktop')
    if (args.recursive === 'true') {
      const p = dir.replace(/\\/g, '/')
      return runTerminal({ command: `Get-ChildItem -Recurse '${p}' | Select-Object FullName | Out-String` })
    }
    const items = await fsP.readdir(dir, { withFileTypes: true })
    return items.map(i => `${i.isDirectory() ? '[DIR]  ' : '[FILE] '}${i.name}`).join('\n') || '(empty)'
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── file_move ─────────────────────────────────────────────────────────────────

export const fileMoveDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'file_move',
    description: 'Move or rename a file or folder.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Source path.' },
        to: { type: 'string', description: 'Destination path.' },
      },
      required: ['from', 'to'],
    },
  },
}

export const fileMove: ToolHandler = async (args) => {
  if (!args.from || !args.to) return 'Error: from and to required'
  try {
    const src = homePath(args.from)
    const dest = homePath(args.to)
    await fsP.mkdir(path.dirname(dest), { recursive: true })
    await fsP.rename(src, dest)
    return `Moved: ${src} → ${dest}`
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── file_delete ───────────────────────────────────────────────────────────────

export const fileDeleteDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'file_delete',
    description: 'Delete a file (not a directory). Confirm with the user before calling this.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to delete.' },
      },
      required: ['path'],
    },
  },
}

export const fileDelete: ToolHandler = async (args) => {
  if (!args.path) return 'Error: path required'
  try {
    const full = homePath(args.path)
    await fsP.unlink(full)
    return `Deleted: ${full}`
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── file_search ───────────────────────────────────────────────────────────────

export const fileSearchDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'file_search',
    description: 'Search for text content across files in a directory (like grep).',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text or pattern to search for.' },
        path: { type: 'string', description: 'Directory to search (default ~/Documents).' },
        extension: { type: 'string', description: 'File extension filter, e.g. ".txt", ".md".' },
        max_results: { type: 'string', description: 'Max results (default 20).' },
      },
      required: ['query'],
    },
  },
}

export const fileSearch: ToolHandler = async (args) => {
  if (!args.query) return 'Error: query required'
  const dir = homePath(args.path ?? '~/Documents').replace(/'/g, "''")
  const ext = args.extension ? `*${args.extension}` : '*'
  const q = args.query.replace(/'/g, "''")
  const max = parseInt(args.max_results ?? '20', 10) || 20
  return runTerminal({
    command: `Get-ChildItem -Recurse '${dir}' -File -Filter '${ext}' | Select-String -Pattern '${q}' -SimpleMatch | Select-Object -First ${max} | ForEach-Object { "$($_.Filename):$($_.LineNumber): $($_.Line.Trim())" } | Out-String`,
  })
}

// ── file_info ─────────────────────────────────────────────────────────────────

export const fileInfoDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'file_info',
    description: 'Get metadata about a file: size, dates, type.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File or directory path.' },
      },
      required: ['path'],
    },
  },
}

export const fileInfo: ToolHandler = async (args) => {
  if (!args.path) return 'Error: path required'
  try {
    const full = homePath(args.path)
    const stat = await fsP.stat(full)
    return [
      `Path: ${full}`,
      `Type: ${stat.isDirectory() ? 'directory' : 'file'}`,
      `Size: ${(stat.size / 1024).toFixed(1)} KB`,
      `Created: ${stat.birthtime.toISOString().slice(0, 19)}`,
      `Modified: ${stat.mtime.toISOString().slice(0, 19)}`,
    ].join('\n')
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── folder_create ─────────────────────────────────────────────────────────────

export const folderCreateDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'folder_create',
    description: 'Create a folder (directory) anywhere on the system — Desktop, Documents, any drive. Creates all intermediate parent folders automatically. Optionally opens the new folder in Windows Explorer.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Folder path to create. Use ~ for home, e.g. "~/Desktop/MyProject" or "C:/Projects/NewApp".' },
        open: { type: 'string', description: 'Set "true" to open the folder in Windows Explorer after creating.' },
      },
      required: ['path'],
    },
  },
}

export const folderCreate: ToolHandler = async (args) => {
  if (!args.path) return 'Error: path is required'
  try {
    const full = homePath(args.path)
    await fsP.mkdir(full, { recursive: true })
    const result = `Created folder: ${full}`
    if (args.open === 'true') {
      await runTerminal({ command: `Start-Process explorer.exe -ArgumentList '${full.replace(/'/g, "''")}' -WindowStyle Normal` })
      return `${result}\nOpened in Explorer.`
    }
    return result
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── folder_delete ─────────────────────────────────────────────────────────────

export const folderDeleteDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'folder_delete',
    description: 'Delete a folder and all its contents recursively. This is irreversible — always confirm with the user before calling.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Folder path to delete.' },
      },
      required: ['path'],
    },
  },
}

export const folderDelete: ToolHandler = async (args) => {
  if (!args.path) return 'Error: path is required'
  try {
    const full = homePath(args.path)
    await fsP.rm(full, { recursive: true, force: true })
    return `Deleted folder: ${full}`
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── folder_copy ───────────────────────────────────────────────────────────────

export const folderCopyDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'folder_copy',
    description: 'Copy a folder and all its contents to a new location.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Source folder path.' },
        to:   { type: 'string', description: 'Destination folder path.' },
      },
      required: ['from', 'to'],
    },
  },
}

export const folderCopy: ToolHandler = async (args) => {
  if (!args.from || !args.to) return 'Error: from and to are required'
  const src  = homePath(args.from).replace(/'/g, "''")
  const dest = homePath(args.to).replace(/'/g, "''")
  return runTerminal({ command: `Copy-Item -Path '${src}' -Destination '${dest}' -Recurse -Force; "Copied: ${src} -> ${dest}"` })
}

// ── open_in_explorer ──────────────────────────────────────────────────────────

export const openInExplorerDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'open_in_explorer',
    description: 'Open a file or folder in Windows Explorer. If a file path is given, Explorer opens the parent folder with that file selected.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or ~ path to a file or folder to show in Explorer.' },
      },
      required: ['path'],
    },
  },
}

export const openInExplorer: ToolHandler = async (args) => {
  if (!args.path) return 'Error: path is required'
  try {
    const full = homePath(args.path)
    const stat = await fsP.stat(full).catch(() => null)
    // If it's a file, open Explorer with the file selected
    const cmd = stat?.isFile()
      ? `Start-Process explorer.exe -ArgumentList '/select,\\"${full.replace(/"/g, '\\"')}\\"' -WindowStyle Normal`
      : `Start-Process explorer.exe -ArgumentList '${full.replace(/'/g, "''")}' -WindowStyle Normal`
    await runTerminal({ command: cmd })
    return `Opened in Explorer: ${full}`
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}
