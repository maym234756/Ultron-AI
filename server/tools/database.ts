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

// ── db_schema ─────────────────────────────────────────────────────────────────

export const dbSchemaDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'db_schema',
    description: 'Inspect the schema of a SQLite database: list all tables, their columns, types, and indexes.',
    parameters: {
      type: 'object',
      properties: {
        file:  { type: 'string', description: 'Path to the SQLite .db file.' },
        table: { type: 'string', description: 'Optional: inspect a specific table only.' },
      },
      required: ['file'],
    },
  },
}

export const dbSchema: ToolHandler = async (args) => {
  if (!args.file) return 'Error: file is required'
  try {
    if (args.table) {
      // PRAGMA table_info + index list for a specific table
      const cols = await ensureSqlite(args.file, `PRAGMA table_info(${JSON.stringify(args.table)})`, 'query')
      const idxList = await ensureSqlite(args.file, `PRAGMA index_list(${JSON.stringify(args.table)})`, 'query')
      const idxSql = await ensureSqlite(args.file, `SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name=${JSON.stringify(args.table)}`, 'query')
      return [`Table: ${args.table}`, '', 'Columns:', cols, '', 'Indexes:', idxList, '', 'Index SQL:', idxSql].join('\n')
    }
    // List all tables + CREATE SQL
    const tables = await ensureSqlite(args.file, `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`, 'query')
    const ddl = await ensureSqlite(args.file, `SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name`, 'query')
    return [`Tables:\n${tables}`, '', `DDL:\n${ddl}`].join('\n')
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── db_transaction ────────────────────────────────────────────────────────────

export const dbTransactionDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'db_transaction',
    description: 'Run multiple SQL statements as a single atomic transaction on a SQLite database. Rolls back automatically if any statement fails.',
    parameters: {
      type: 'object',
      properties: {
        file:       { type: 'string', description: 'Path to the SQLite .db file.' },
        statements: { type: 'string', description: 'Semicolon-separated SQL statements to execute inside the transaction.' },
      },
      required: ['file', 'statements'],
    },
  },
}

export const dbTransaction: ToolHandler = async (args) => {
  if (!args.file) return 'Error: file is required'
  if (!args.statements) return 'Error: statements is required'
  // Wrap in BEGIN/COMMIT; errors trigger ROLLBACK via sqlite3 error handling
  const wrapped = `BEGIN;\n${args.statements.trimEnd().replace(/;?\s*$/, '')};\nCOMMIT;`
  const result = await ensureSqlite(args.file, wrapped, 'exec')
  if (result.includes('command not found') || result.includes('not recognized')) {
    return 'sqlite3 not found. Install with: winget install SQLite.SQLite'
  }
  if (result.toLowerCase().includes('error') || result.toLowerCase().includes('parse error')) {
    return `Transaction failed (rolled back):\n${result}`
  }
  return result || 'Transaction committed successfully.'
}

// ── db_backup ─────────────────────────────────────────────────────────────────

export const dbBackupDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'db_backup',
    description: 'Create a timestamped backup copy of a SQLite database file before making changes.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Path to the SQLite .db file to back up.' },
        dest: { type: 'string', description: 'Optional destination path for the backup. Defaults to <file>.bak-<timestamp>.' },
      },
      required: ['file'],
    },
  },
}

export const dbBackup: ToolHandler = async (args) => {
  if (!args.file) return 'Error: file is required'
  const absDb = path.isAbsolute(args.file) ? args.file : path.resolve(process.cwd(), args.file)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dest = args.dest?.trim() || `${absDb}.bak-${timestamp}`
  try {
    const fsModule = await import('node:fs/promises')
    await fsModule.copyFile(absDb, dest)
    return `Backup created: ${dest}`
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── db_query pagination wrapper ───────────────────────────────────────────────
// Update dbQuery to support limit/offset for pagination

export const dbQueryPagedDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'db_query_paged',
    description: 'Run a SELECT SQL query on a SQLite database with pagination support. Returns rows as JSON plus total row count, current page, and page size.',
    parameters: {
      type: 'object',
      properties: {
        file:      { type: 'string', description: 'Path to the SQLite .db file.' },
        sql:       { type: 'string', description: 'SELECT statement (without LIMIT/OFFSET — those are added automatically).' },
        page:      { type: 'string', description: 'Page number (1-based, default 1).' },
        page_size: { type: 'string', description: 'Rows per page (default 50, max 500).' },
      },
      required: ['file', 'sql'],
    },
  },
}

export const dbQueryPaged: ToolHandler = async (args) => {
  if (!args.file) return 'Error: file is required'
  if (!args.sql) return 'Error: sql is required'
  const pageSize = Math.min(500, Math.max(1, parseInt(args.page_size ?? '50', 10) || 50))
  const page = Math.max(1, parseInt(args.page ?? '1', 10) || 1)
  const offset = (page - 1) * pageSize

  // Strip trailing semicolon and wrap with pagination
  const base = args.sql.replace(/;\s*$/, '')
  const pagedSql = `SELECT * FROM (${base}) LIMIT ${pageSize} OFFSET ${offset}`
  const countSql = `SELECT COUNT(*) as total FROM (${base})`

  const [rows, countResult] = await Promise.all([
    ensureSqlite(args.file, pagedSql, 'query'),
    ensureSqlite(args.file, countSql, 'query'),
  ])
  if (rows.includes('command not found') || rows.includes('not recognized')) {
    return 'sqlite3 not found. Install with: winget install SQLite.SQLite'
  }
  let total = '?'
  try {
    const parsed = JSON.parse(countResult) as Array<{ total?: number }>
    total = String(parsed[0]?.total ?? '?')
  } catch { /* ignore */ }

  return [`Page ${page} (${pageSize}/page) — total rows: ${total}`, '', rows || '(no rows)'].join('\n')
}
