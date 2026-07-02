import { spawn } from 'node:child_process'
import { writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ToolDefinition, ToolHandler, ToolArgs } from './types.js'

// ── persistent Python REPL ────────────────────────────────────────────────────
// A single Python subprocess stays alive across calls.
// Code is base64-encoded to handle multiline safely.
// stdout/stderr are captured per-call via a StringIO redirect.

const SCRIPT_PATH = join(tmpdir(), 'ultron_repl_server.py')

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

let _proc: ReturnType<typeof spawn> | null = null

function ensureRepl(): ReturnType<typeof spawn> {
  if (_proc && _proc.exitCode === null) return _proc
  if (!existsSync(SCRIPT_PATH)) writeFileSync(SCRIPT_PATH, REPL_SCRIPT, 'utf-8')
  _proc = spawn('python', [SCRIPT_PATH], { stdio: 'pipe', windowsHide: true })
  _proc.on('exit', () => { _proc = null })
  return _proc
}

function execInRepl(code: string, proc: ReturnType<typeof spawn>, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    let outBuf = ''
    const timer = setTimeout(() => {
      proc.stdout?.removeListener('data', onData)
      resolve(`(timeout after ${timeoutMs / 1000}s)\n${outBuf}`)
    }, timeoutMs)

    const onData = (chunk: Buffer) => {
      outBuf += chunk.toString()
      const lines = outBuf.split('\n')
      // Each response is exactly one base64-encoded line
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const decoded = Buffer.from(line.trim(), 'base64').toString('utf-8')
          clearTimeout(timer)
          proc.stdout?.removeListener('data', onData)
          resolve(decoded || '(no output)')
          return
        } catch { /* not a complete line yet */ }
      }
    }

    proc.stdout?.on('data', onData)
    const encoded = Buffer.from(code).toString('base64')
    proc.stdin?.write(encoded + '\n')
  })
}

// ── python_exec ───────────────────────────────────────────────────────────────

export const pythonExecDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'python_exec',
    description:
      'Execute Python code in a persistent REPL session. Variables, imports, and functions are preserved between calls — build up state over multiple tool calls. Perfect for data analysis, scripting, math, and more.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Python code to execute. Can be multiple lines.' },
        timeout: { type: 'string', description: 'Max execution seconds (default 60).' },
      },
      required: ['code'],
    },
  },
}

export const pythonExec: ToolHandler = async (args: ToolArgs) => {
  const code = (args.code ?? '').trim()
  if (!code) return 'Error: code is required'
  const timeout = (parseInt(args.timeout ?? '60', 10) || 60) * 1000
  try {
    const proc = ensureRepl()
    const result = await execInRepl(code, proc, timeout)
    return result || '(executed — no output)'
  } catch (err) {
    return `REPL error: ${err instanceof Error ? err.message : String(err)}`
  }
}

// ── python_reset ──────────────────────────────────────────────────────────────

export const pythonResetDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'python_reset',
    description: 'Reset the Python REPL session — clears all variables, imports, and state. Useful when starting a new task.',
    parameters: { type: 'object', properties: {} },
  },
}

export const pythonReset: ToolHandler = async (_args: ToolArgs) => {
  try {
    const proc = ensureRepl()
    return await execInRepl('__RESET__', proc, 5_000).catch(() => 'Python state reset.')
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`
  }
}
