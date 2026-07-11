import path from 'node:path'
import type { ToolDefinition, ToolHandler } from './types.js'
import { runTerminal } from './terminal.js'

// ── run_code ──────────────────────────────────────────────────────────────────

export const runCodeDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'run_code',
    description:
      'Execute a code file and return its output. Auto-detects language from extension: .py (Python), .ts (TypeScript via tsx), .js (Node.js), .ps1 (PowerShell). Creates and runs the file if it does not exist yet.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Absolute or relative path to the code file to run' },
        args: { type: 'string', description: 'Optional command-line arguments to pass to the script' },
        cwd: { type: 'string', description: 'Working directory to run from (defaults to file directory)' },
        timeout_sec: { type: 'string', description: 'Execution timeout in seconds, from 1 to 600 (default 120).' },
      },
      required: ['file'],
    },
  },
}

export const runCode: ToolHandler = async (args) => {
  const file = (args.file ?? '').trim()
  if (!file) return 'Error: file is required'

  const ext = path.extname(file).toLowerCase()
  const filePath = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file)
  const fileDir = path.dirname(filePath)
  const cwd = args.cwd?.trim() || fileDir
  const extra = args.args ? ` ${args.args}` : ''

  let command: string
  switch (ext) {
    case '.py':
      command = `python "${filePath}"${extra}`
      break
    case '.ts':
    case '.tsx':
      command = `npx tsx "${filePath}"${extra}`
      break
    case '.js':
    case '.mjs':
      command = `node "${filePath}"${extra}`
      break
    case '.ps1':
      command = `& "${filePath}"${extra}`
      break
    case '.sh':
      command = `bash "${filePath}"${extra}`
      break
    case '.rb':
      command = `ruby "${filePath}"${extra}`
      break
    case '.go':
      command = `go run "${filePath}"${extra}`
      break
    default:
      return `Unsupported file type: ${ext}. Supported: .py .ts .tsx .js .mjs .ps1 .sh .rb .go`
  }

  return runTerminal({ command, cwd, timeout_sec: args.timeout_sec })
}

// ── lint_code ─────────────────────────────────────────────────────────────────

export const lintCodeDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'lint_code',
    description:
      'Run type-checking or linting on a file or directory. Auto-detects: TypeScript files use tsc --noEmit, Python files use pylint, JS/TS files can use ESLint. Returns all errors and warnings.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File or directory path to lint/type-check' },
        type: {
          type: 'string',
          description: 'Linter to use: "typescript" (tsc), "eslint", "python" (pylint), or "auto" (default, detects from extension)',
        },
        fix: { type: 'string', description: 'Set to "true" to auto-fix issues where possible' },
        timeout_sec: { type: 'string', description: 'Lint/type-check timeout in seconds, from 1 to 600 (default 120).' },
      },
      required: ['path'],
    },
  },
}

export const lintCode: ToolHandler = async (args) => {
  const target = (args.path ?? '').trim()
  if (!target) return 'Error: path is required'

  const absTarget = path.isAbsolute(target) ? target : path.resolve(process.cwd(), target)
  const ext = path.extname(target).toLowerCase()
  const lintType = args.type ?? 'auto'
  const fixFlag = args.fix === 'true' ? ' --fix' : ''

  let command: string

  if (lintType === 'typescript' || (lintType === 'auto' && ['.ts', '.tsx'].includes(ext))) {
    // Run tsc from the project root where tsconfig lives
    command = `npx tsc --noEmit 2>&1`
  } else if (lintType === 'eslint' || (lintType === 'auto' && ['.js', '.ts', '.tsx', '.jsx'].includes(ext))) {
    command = `npx eslint "${absTarget}"${fixFlag} 2>&1`
  } else if (lintType === 'python' || (lintType === 'auto' && ext === '.py')) {
    command = `python -m pylint "${absTarget}" 2>&1`
  } else {
    // Fallback: try tsc
    command = `npx tsc --noEmit 2>&1`
  }

  const result = await runTerminal({ command, cwd: process.cwd(), timeout_sec: args.timeout_sec })
  return result || 'No issues found.'
}

// ── open_in_editor ────────────────────────────────────────────────────────────

export const openInEditorDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'open_in_editor',
    description:
      'Open a file in VS Code, optionally at a specific line number. Can also open entire folders as a workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative path to the file or folder to open' },
        line: { type: 'string', description: 'Optional line number to jump to in the file' },
        column: { type: 'string', description: 'Optional column number (used with line)' },
      },
      required: ['path'],
    },
  },
}

export const openInEditor: ToolHandler = async (args) => {
  const target = (args.path ?? '').trim()
  if (!target) return 'Error: path is required'

  const absPath = path.isAbsolute(target) ? target : path.resolve(process.cwd(), target)
  let gotoArg = absPath

  if (args.line) {
    gotoArg = `${absPath}:${args.line}`
    if (args.column) gotoArg += `:${args.column}`
    return runTerminal({ command: `code --goto "${gotoArg}"` })
  }

  return runTerminal({ command: `code "${absPath}"` })
}

// ── code_search ───────────────────────────────────────────────────────────────

export const codeSearchDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'code_search',
    description:
      'Fast codebase search using ripgrep when available. Can search matched lines or filenames with file paths and line numbers. Useful for finding usages, imports, symbols, filenames, routes, or config keys.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Text or regex pattern to search for' },
        directory: { type: 'string', description: 'Directory to search in (defaults to current workspace)' },
        include: { type: 'string', description: 'File glob filter, e.g. "*.ts" or "*.py" (optional)' },
        mode: { type: 'string', description: '"content" (default) searches matched lines; "name" searches filenames only.' },
        regex: { type: 'string', description: 'Set "true" to treat pattern as a regex. Default uses literal matching.' },
        case_sensitive: { type: 'string', description: 'Set to "true" for case-sensitive search (default is case-insensitive)' },
        max_results: { type: 'string', description: 'Maximum returned matches (default 80, max 500).' },
      },
      required: ['pattern'],
    },
  },
}

export const codeSearch: ToolHandler = async (args) => {
  const pattern = (args.pattern ?? '').trim()
  if (!pattern) return 'Error: pattern is required'

  const dir = args.directory?.trim() || process.cwd()
  const absDir = path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir)
  const caseSensitive = args.case_sensitive === 'true'
  const mode = args.mode?.trim().toLowerCase() === 'name' ? 'name' : 'content'
  const max = Math.min(500, Math.max(1, parseInt(args.max_results ?? '80', 10) || 80))
  const caseFlag = caseSensitive ? '' : '-CaseSensitive:$false'
  const rgPattern = pattern.replace(/"/g, '\\"')
  const rgDir = absDir.replace(/"/g, '\\"')
  const fixedFlag = args.regex === 'true' ? '' : '--fixed-strings'

  // Try ripgrep first (faster), fall back to Select-String
  const rgBase = [
    'rg',
    '--hidden',
    '--no-ignore-parent',
    '--glob "!**/.git/**"',
    '--glob "!**/node_modules/**"',
    '--glob "!**/dist/**"',
    '--glob "!**/desktop-release/**"',
    caseSensitive ? '' : '--ignore-case',
  ].filter(Boolean).join(' ')

  const rgCmd = mode === 'name'
    ? `${rgBase} --files ${args.include ? `--glob "${args.include}"` : ''} "${rgDir}" 2>$null | rg ${fixedFlag} ${caseSensitive ? '' : '--ignore-case'} -- "${rgPattern}" | Select-Object -First ${max}`
    : `${rgBase} ${fixedFlag} ${args.include ? `--glob "${args.include}"` : ''} --line-number --no-heading --max-filesize 2M -- "${rgPattern}" "${rgDir}" 2>$null | Select-Object -First ${max}`

  const escapedPattern = pattern.replace(/"/g, '`"')
  const includeFilter = args.include ? `-Include "${args.include}"` : ''
  const psCmd = `Get-ChildItem -Path "${absDir}" -Recurse -File ${includeFilter} -ErrorAction SilentlyContinue | Select-String -Pattern "${escapedPattern}" ${caseFlag} | Select-Object -First ${max} | ForEach-Object { "$($_.Path):$($_.LineNumber): $($_.Line.Trim())" }`

  const rgResult = await runTerminal({ command: rgCmd, timeout_sec: args.timeout_sec ?? '30', max_output_chars: '60000' })
  if (rgResult && !rgResult.includes('not recognized') && !rgResult.includes('Error:') && !rgResult.includes('[exit code 1]')) {
    return rgResult.slice(0, 12000) || 'No matches found.'
  }

  if (mode === 'name') {
    const nameCmd = `Get-ChildItem -Path "${absDir}" -Recurse -File ${includeFilter} -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "*${escapedPattern}*" } | Select-Object -First ${max} -ExpandProperty FullName`
    const nameResult = await runTerminal({ command: nameCmd, timeout_sec: args.timeout_sec ?? '30', max_output_chars: '60000' })
    return nameResult.slice(0, 12000) || 'No matches found.'
  }

  const psResult = await runTerminal({ command: psCmd, timeout_sec: args.timeout_sec ?? '60', max_output_chars: '60000' })
  return psResult.slice(0, 12000) || 'No matches found.'
}

// -- diff_files ----------------------------------------------------------------

export const diffFilesDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'diff_files',
    description: 'Show a unified diff between two files. Uses git diff --no-index which works outside git repos.',
    parameters: {
      type: 'object',
      properties: {
        file1: { type: 'string', description: 'Path to the first (original) file.' },
        file2: { type: 'string', description: 'Path to the second (modified) file.' },
      },
      required: ['file1', 'file2'],
    },
  },
}

export const diffFiles: ToolHandler = async (args) => {
  if (!args.file1 || !args.file2) return 'Error: file1 and file2 are required'
  const f1 = path.isAbsolute(args.file1) ? args.file1 : path.resolve(process.cwd(), args.file1)
  const f2 = path.isAbsolute(args.file2) ? args.file2 : path.resolve(process.cwd(), args.file2)
  const result = await runTerminal({ command: `git diff --no-index --unified=3 "${f1}" "${f2}" 2>&1` })
  if (!result.trim()) return 'Files are identical.'
  return result.slice(0, 6000)
}

// -- patch_file ----------------------------------------------------------------

export const patchFileDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'patch_file',
    description: 'Apply a unified diff patch to a file. The patch is the output of diff_files or git diff. Saves a .bak backup before patching.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Path to the file to patch.' },
        patch: { type: 'string', description: 'Unified diff string (from diff_files or git diff).' },
      },
      required: ['file', 'patch'],
    },
  },
}

export const patchFile: ToolHandler = async (args) => {
  if (!args.file || !args.patch) return 'Error: file and patch are required'
  const filePath = path.isAbsolute(args.file) ? args.file : path.resolve(process.cwd(), args.file)
  try {
    const fsModule = await import('node:fs/promises')
    const original = await fsModule.readFile(filePath, 'utf-8')
    const lines = original.split('\n')

    // Parse unified diff hunks
    const patchLines = args.patch.split('\n')
    const hunks: Array<{ start: number; dels: string[]; adds: string[] }> = []
    let i = 0
    while (i < patchLines.length) {
      const hunkMatch = patchLines[i].match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (hunkMatch) {
        const origStart = parseInt(hunkMatch[1], 10) - 1 // 0-based
        const hunk = { start: origStart, dels: [] as string[], adds: [] as string[] }
        i++
        while (i < patchLines.length && !patchLines[i].startsWith('@@') && !patchLines[i].startsWith('diff ')) {
          const pl = patchLines[i]
          if (pl.startsWith('-')) hunk.dels.push(pl.slice(1))
          else if (pl.startsWith('+')) hunk.adds.push(pl.slice(1))
          i++
        }
        hunks.push(hunk)
      } else {
        i++
      }
    }

    if (hunks.length === 0) return 'Error: no valid hunks found in patch'

    // Apply hunks in reverse order so line numbers stay valid
    const result = [...lines]
    for (const hunk of hunks.reverse()) {
      const at = hunk.start
      result.splice(at, hunk.dels.length, ...hunk.adds)
    }

    // Backup original
    await fsModule.writeFile(`${filePath}.bak`, original, 'utf-8')
    await fsModule.writeFile(filePath, result.join('\n'), 'utf-8')
    return `Applied ${hunks.length} hunk(s) to ${filePath}\nBackup saved as ${filePath}.bak`
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`
  }
}

// ── code_todos ────────────────────────────────────────────────────────────────

export const codeTodosDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'code_todos',
    description: 'Scan a directory for TODO, FIXME, HACK, BUG, NOTE, and XXX comments across all code files. Returns file, line number, and the comment text.',
    parameters: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Directory to scan (defaults to current workspace)' },
        include:   { type: 'string', description: 'File glob to limit search e.g. "*.ts" (optional)' },
        tags:      { type: 'string', description: 'Comma-separated tags to look for (default: TODO,FIXME,HACK,BUG,NOTE,XXX)' },
      },
      required: [],
    },
  },
}

export const codeTodos: ToolHandler = async (args) => {
  const dir = args.directory?.trim() || process.cwd()
  const absDir = path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir)
  const rawTags = args.tags ?? 'TODO,FIXME,HACK,BUG,NOTE,XXX'
  const tagList = rawTags.split(',').map(t => t.trim()).filter(Boolean)
  const pattern = tagList.join('|')
  const glob = args.include ?? '*.{ts,tsx,js,jsx,py,go,rs,cs,java,cpp,c,rb,sh}'

  const cmd = `rg --line-number --no-heading -e "(${pattern})" --glob "${glob}" "${absDir}" 2>&1 | head -80`
  const result = await runTerminal({ command: cmd })

  if (result && !result.includes('not recognized') && result.trim()) {
    const lines = result.trim().split('\n')
    return `Found ${lines.length} item(s):\n\n${result.slice(0, 5000)}`
  }

  // Fallback: PowerShell Select-String
  const psCmd = `Select-String -Path "${absDir}\\**\\*" -Pattern "(${pattern})" -Recurse -Include ${args.include ?? '*.ts','*.js','*.py'} 2>$null | Select-Object -First 50 | ForEach-Object { "$($_.RelativePath('.'))line $($_.LineNumber): $($_.Line.Trim())" }`
  const ps = await runTerminal({ command: psCmd })
  return ps.trim() || 'No TODO/FIXME comments found.'
}

// ── code_stats ────────────────────────────────────────────────────────────────

export const codeStatsDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'code_stats',
    description: 'Count lines of code, files, and file types in a directory. Shows breakdown by extension. Great for project overview.',
    parameters: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Directory to analyze (defaults to current workspace)' },
        exclude:   { type: 'string', description: 'Comma-separated folder names to exclude (default: node_modules,dist,.git,__pycache__)' },
      },
      required: [],
    },
  },
}

export const codeStats: ToolHandler = async (args) => {
  const dir = args.directory?.trim() || process.cwd()
  const absDir = path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir)
  const excludeList = (args.exclude ?? 'node_modules,dist,.git,__pycache__,.next,.venv').split(',').map(s => s.trim())

  try {
    const fsSync = await import('node:fs')
    const counts: Record<string, { files: number; lines: number }> = {}
    let totalFiles = 0
    let totalLines = 0

    function walkDir(dirPath: string, depth = 0) {
      if (depth > 10) return
      let entries: string[]
      try { entries = fsSync.readdirSync(dirPath) } catch { return }
      for (const entry of entries) {
        if (excludeList.includes(entry)) continue
        const full = path.join(dirPath, entry)
        let stat
        try { stat = fsSync.statSync(full) } catch { continue }
        if (stat.isDirectory()) {
          walkDir(full, depth + 1)
        } else if (stat.isFile() && stat.size < 1_000_000) {
          const ext = path.extname(entry).toLowerCase() || '(no ext)'
          if (!counts[ext]) counts[ext] = { files: 0, lines: 0 }
          counts[ext].files++
          totalFiles++
          try {
            const content = fsSync.readFileSync(full, 'utf-8')
            const lc = content.split('\n').length
            counts[ext].lines += lc
            totalLines += lc
          } catch { /* binary or locked */ }
        }
      }
    }

    walkDir(absDir)

    const rows = Object.entries(counts)
      .sort((a, b) => b[1].lines - a[1].lines)
      .map(([ext, { files, lines }]) => `  ${ext.padEnd(10)} ${String(files).padStart(5)} files  ${String(lines).padStart(8)} lines`)
      .join('\n')

    return [
      `Code stats for: ${absDir}`,
      `Excluding: ${excludeList.join(', ')}`,
      '',
      `  Extension   Files        Lines`,
      `  ---------   -----        -----`,
      rows,
      '',
      `  TOTAL       ${String(totalFiles).padStart(5)} files  ${String(totalLines).padStart(8)} lines`,
    ].join('\n')
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`
  }
}
