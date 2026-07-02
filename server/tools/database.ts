import path from 'node:path'
import type { ToolDefinition, ToolHandler } from './types.js'
import { runTerminal } from './terminal.js'

// SQLite via the sqlite3 CLI (installed via winget install SQLite.SQLite)
// If missing, the tool offers to install it automatically.

function ensureSqlite(dbFile: string, sql: string, mode: 'query' | 'exec', cwd?: string): Promise<string> {
  const absDb = path.isAbsolute(dbFile) ? dbFile : path.resolve(process.cwd(), dbFile)
  // Escape the SQL for PowerShell double-quoted string
  const escaped = sql.replace(/"/g, '""').replace(/'/g, "''")

  if (mode === 'query') {
    // Output as JSON using .mode json
    const cmd = `sqlite3 -json "${absDb}" "${escaped}" 2>&1`
    return runTerminal({ command: cmd, ...(cwd ? { cwd } : {}) })
  } else {
    const cmd = `sqlite3 "${absDb}" "${escaped}" 2>&1`
    return runTerminal({ command: cmd, ...(cwd ? { cwd } : {}) })
  }
}

// ── db_query ──────────────────────────────────────────────────────────────────

export const dbQueryDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'db_query',
    description:
      'Run a SELECT SQL query on a SQLite database file and return rows as JSON. Creates the database file if it does not exist. Requires sqlite3 in PATH (install: winget install SQLite.SQLite).',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Path to the SQLite .db file.' },
        sql: { type: 'string', description: 'SELECT statement to execute.' },
      },
      required: ['file', 'sql'],
    },
  },
}

export const dbQuery: ToolHandler = async (args) => {
  if (!args.file) return 'Error: file is required'
  if (!args.sql) return 'Error: sql is required'
  const result = await ensureSqlite(args.file, args.sql, 'query')
  if (result.includes('command not found') || result.includes('not recognized')) {
    const install = await runTerminal({ command: 'winget install SQLite.SQLite --accept-source-agreements --accept-package-agreements 2>&1 | Select-Object -Last 3' })
    return `sqlite3 not found. Install attempted:\n${install}\n\nPlease restart and retry.`
  }
  return result || '(no rows returned)'
}

// ── db_execute ────────────────────────────────────────────────────────────────

export const dbExecuteDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'db_execute',
    description:
      'Execute a SQL statement (CREATE TABLE, INSERT, UPDATE, DELETE) on a SQLite database file. Returns any output or confirmation.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Path to the SQLite .db file.' },
        sql: { type: 'string', description: 'SQL statement to execute.' },
      },
      required: ['file', 'sql'],
    },
  },
}

export const dbExecute: ToolHandler = async (args) => {
  if (!args.file) return 'Error: file is required'
  if (!args.sql) return 'Error: sql is required'
  const result = await ensureSqlite(args.file, args.sql, 'exec')
  if (result.includes('command not found') || result.includes('not recognized')) {
    const install = await runTerminal({ command: 'winget install SQLite.SQLite --accept-source-agreements --accept-package-agreements 2>&1 | Select-Object -Last 3' })
    return `sqlite3 not found. Install attempted:\n${install}\n\nPlease restart and retry.`
  }
  return result || 'Statement executed successfully.'
}
