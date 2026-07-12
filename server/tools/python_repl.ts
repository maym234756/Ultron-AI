import { spawn } from 'node:child_process'
import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ToolDefinition, ToolHandler, ToolArgs } from './types.js'

// ── persistent Python REPL ────────────────────────────────────────────────────
// Each named session maps to its own Python subprocess.
// Code is base64-encoded to handle multiline safely.
// stdout/stderr are captured per-call via a StringIO redirect.

const REPL_DIR = join(process.cwd(), '.python-repl')
const SCRIPT_PATH = join(REPL_DIR, 'ultron_repl_server.py')
const IDLE_SESSION_MS = 10 * 60 * 1000

type ReplProcess = ReturnType<typeof spawn>

type ReplSession = {
  proc: ReplProcess
  lastUsedAt: number
}

const REPL_SCRIPT = `import sys, io, traceback, base64
_globals = {"__builtins__": __builtins__}
while True:
    try:
        line = sys.stdin.readline()
        if not line:
            break
        line = line.strip()
        if line == "__RESET__":
            _globals = {"__builtins__": __builtins__}
            sys.stdout.write(base64.b64encode(b"Python state reset.").decode() + "\\n")
            sys.stdout.flush()
            continue
        code = base64.b64decode(line).decode("utf-8")
        buf = io.StringIO()
        _old_out, _old_err = sys.stdout, sys.stderr
        sys.stdout = sys.stderr = buf
        try:
            exec(compile(code, "<repl>", "exec"), _globals)
        except Exception:
            buf.write(traceback.format_exc())
        sys.stdout, sys.stderr = _old_out, _old_err
        output = buf.getvalue()
        _old_out.write(base64.b64encode(output.encode("utf-8")).decode() + "\\n")
        _old_out.flush()
    except Exception as e:
        try:
            sys.stdout.write(base64.b64encode(str(e).encode()).decode() + "\\n")
            sys.stdout.flush()
        except Exception:
            pass
`

const _sessions = new Map<string, ReplSession>()
const _cleanupTimer = setInterval(() => cleanupIdleSessions(), 60_000)
_cleanupTimer.unref?.()

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10)
  if (Number.isNaN(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function normalizeSessionName(session: unknown): string {
  const name = typeof session === 'string' ? session.trim() : ''
  return name || 'default'
}

function ensureReplScript(): void {
  if (!existsSync(REPL_DIR)) mkdirSync(REPL_DIR, { recursive: true })
  if (!existsSync(SCRIPT_PATH)) writeFileSync(SCRIPT_PATH, REPL_SCRIPT, 'utf-8')
}

function cleanupIdleSessions(): void {
  const now = Date.now()
  for (const [name, session] of _sessions) {
    const isDead = session.proc.exitCode !== null
    const isIdle = now - session.lastUsedAt > IDLE_SESSION_MS
    if (!isDead && !isIdle) continue
    if (!isDead) session.proc.kill()
    _sessions.delete(name)
  }
}

function ensureSession(sessionName: string): ReplSession {
  cleanupIdleSessions()
  const name = normalizeSessionName(sessionName)
  const existing = _sessions.get(name)
  if (existing && existing.proc.exitCode === null) {
    existing.lastUsedAt = Date.now()
    return existing
  }

  ensureReplScript()
  const proc = spawn('python', [SCRIPT_PATH], { stdio: 'pipe', windowsHide: true })
  const session: ReplSession = { proc, lastUsedAt: Date.now() }
  proc.on('exit', () => {
    const current = _sessions.get(name)
    if (current?.proc === proc) _sessions.delete(name)
  })
  _sessions.set(name, session)
  return session
}

function execInRepl(code: string, session: ReplSession, timeoutMs: number): Promise<string> {
  session.lastUsedAt = Date.now()

  return new Promise((resolve) => {
    let buffer = ''
    let settled = false

    const cleanup = () => {
      clearTimeout(timer)
      session.proc.stdout?.removeListener('data', onData)
      session.proc.stderr?.removeListener('data', onStderr)
    }

    const finish = (value: string) => {
      if (settled) return
      settled = true
      cleanup()
      session.lastUsedAt = Date.now()
      resolve(value || '(no output)')
    }

    const timer = setTimeout(() => {
      finish(`(timeout after ${Math.round(timeoutMs / 1000)}s)${buffer ? `\n${buffer}` : ''}`)
    }, timeoutMs)

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString()
      const newlineIndex = buffer.indexOf('\n')
      if (newlineIndex < 0) return

      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      if (!line) return

      try {
        finish(Buffer.from(line, 'base64').toString('utf-8'))
      } catch {
        // Wait for the full base64 line before decoding.
      }
    }

    const onStderr = (chunk: Buffer) => {
      buffer += chunk.toString()
    }

    session.proc.stdout?.on('data', onData)
    session.proc.stderr?.on('data', onStderr)
    session.proc.stdin?.write(Buffer.from(code).toString('base64') + '\n')
  })
}

function looksLikeDataFrame(output: string): boolean {
  const trimmed = output.trim()
  if (!trimmed.includes('\n')) return false
  if (!/^dtype:\s*.+$/im.test(trimmed)) return false

  const lines = trimmed.split('\n').map((line) => line.trimEnd()).filter(Boolean)
  const dtypeIndex = lines.findIndex((line) => /^dtype:\s*.+$/i.test(line))
  if (dtypeIndex < 2) return false

  const header = lines[0]
  const body = lines.slice(1, dtypeIndex)
  return /\s{2,}|\t/.test(header) || body.some((line) => /^\d+\s+/.test(line) || /\s{2,}|\t/.test(line))
}

function formatExecResult(result: string): string {
  const output = result || '(executed — no output)'
  return looksLikeDataFrame(output) ? `📊 DataFrame output:\n${output}` : output
}

function runPackagesCommand(filter: string): Promise<string> {
  const code = [
    'try:',
    '    import pkg_resources',
    '    packages = sorted({p.project_name for p in pkg_resources.working_set})',
    'except Exception:',
    '    from importlib import metadata',
    '    packages = sorted({(dist.metadata.get("Name") or dist.name or "").strip() for dist in metadata.distributions()})',
    'print("\\n".join(pkg for pkg in packages if pkg))',
  ].join('\n')

  return new Promise((resolve) => {
    const proc = spawn('python', ['-c', code], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (value: string) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    const timer = setTimeout(() => {
      if (proc.exitCode === null) proc.kill()
      finish('Error: package listing timed out after 30s')
    }, 30_000)

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    proc.on('error', (err) => {
      clearTimeout(timer)
      finish(`Error: ${err.message}`)
    })
    proc.on('exit', () => {
      clearTimeout(timer)
      const combined = `${stdout}${stderr}`.trim()
      if (!filter) {
        finish(combined || 'No installed packages found.')
        return
      }

      const loweredFilter = filter.toLowerCase()
      const filtered = combined
        .split('\n')
        .filter((line) => line.toLowerCase().includes(loweredFilter))
        .join('\n')
      finish(filtered || `No installed packages matched "${filter}".`)
    })
  })
}

// ── python_exec ───────────────────────────────────────────────────────────────

export const pythonExecDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'python_exec',
    description:
      'Execute Python code in a persistent REPL session. Variables, imports, and functions are preserved between calls within the same named session. Perfect for data analysis, scripting, math, and more.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Python code to execute. Can be multiple lines.' },
        session: { type: 'string', description: 'Optional named REPL session. Defaults to "default".' },
        timeout_sec: { type: 'string', description: 'Max execution time in seconds (default 30, max 300).' },
      },
      required: ['code'],
    },
  },
}

export const pythonExec: ToolHandler = async (args: ToolArgs) => {
  const code = (args.code ?? '').trim()
  if (!code) return 'Error: code is required'

  const sessionName = normalizeSessionName(args.session)
  const timeoutMs = clampInt(args.timeout_sec, 1, 300, 30) * 1000

  try {
    const session = ensureSession(sessionName)
    const result = await execInRepl(code, session, timeoutMs)
    return formatExecResult(result)
  } catch (err) {
    return `REPL error: ${err instanceof Error ? err.message : String(err)}`
  }
}

// ── python_reset ──────────────────────────────────────────────────────────────

export const pythonResetDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'python_reset',
    description: 'Reset a named Python REPL session — clears all variables, imports, and state. Useful when starting a new task.',
    parameters: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Optional named REPL session to reset. Defaults to "default".' },
      },
    },
  },
}

export const pythonReset: ToolHandler = async (args: ToolArgs) => {
  try {
    const session = ensureSession(normalizeSessionName(args.session))
    return await execInRepl('__RESET__', session, 5_000).catch(() => 'Python state reset.')
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`
  }
}

// ── repl_packages ─────────────────────────────────────────────────────────────

export const replPackagesDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'repl_packages',
    description: 'List installed Python packages available to the REPL environment, optionally filtering by substring.',
    parameters: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Optional substring filter applied to the installed package list.' },
      },
    },
  },
}

export const replPackages: ToolHandler = async (args: ToolArgs) => {
  const filter = typeof args.filter === 'string' ? args.filter.trim() : ''
  try {
    return await runPackagesCommand(filter)
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`
  }
}
