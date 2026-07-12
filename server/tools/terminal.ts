import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import type { ToolDefinition, ToolHandler } from './types.js'

// ── Platform helpers ──────────────────────────────────────────────────────────

const IS_WINDOWS = process.platform === 'win32'

type ShellKind = 'powershell' | 'cmd' | 'bash' | 'sh' | 'zsh' | 'fish'

function normalizeShell(value: string | undefined): ShellKind {
  const clean = value?.trim().toLowerCase()
  if (!clean) return IS_WINDOWS ? 'powershell' : 'bash'
  if (clean === 'cmd' || clean === 'command prompt' || clean === 'cmd.exe') return 'cmd'
  if (clean === 'powershell' || clean === 'pwsh' || clean === 'powershell.exe') return 'powershell'
  if (clean === 'zsh') return 'zsh'
  if (clean === 'fish') return 'fish'
  if (clean === 'sh') return 'sh'
  return IS_WINDOWS ? 'powershell' : 'bash'
}

// ── Risk classification ───────────────────────────────────────────────────────

type RiskLevel = 'safe' | 'caution' | 'destructive'

interface RiskResult {
  level: RiskLevel
  reason: string | null
}

const DESTRUCTIVE_PATTERNS: Array<[RegExp, string]> = [
  [/\brm\s+-[rf]+\b/, 'recursive delete (rm -rf/-fr)'],
  [/\bdel\s+\/[sf]/i, 'force-delete (del /S or /F)'],
  [/\bformat\s+[a-z]:/i, 'disk format'],
  [/\brd\s+\/s\b/i, 'recursive directory remove (rd /S)'],
  [/\bmkfs\b/, 'filesystem creation (mkfs)'],
  [/\bdd\s+if=/i, 'raw disk write (dd)'],
  [/>\s*\/dev\/[sh]d[a-z]/i, 'raw disk overwrite'],
  [/\bdropdb\b|\bdrop\s+database\b/i, 'database drop'],
  [/\btruncate\s+table\b/i, 'table truncation'],
  [/\bkillall\b|\bpkill\b/, 'mass process kill'],
  [/\bshutdown\b|\breboot\b|\binit\s+[06]\b/, 'system shutdown/reboot'],
  [/\bchmod\s+[0-7]*777\b/, 'world-writable chmod 777'],
  [/\bchown\s+-R\b/, 'recursive ownership change'],
  [/\bcurl\b.*\|\s*(ba)?sh\b/, 'piped remote script execution'],
  [/\bwget\b.*\|\s*(ba)?sh\b/, 'piped remote script execution'],
]

const CAUTION_PATTERNS: Array<[RegExp, string]> = [
  [/\bnpm\s+publish\b/, 'npm publish'],
  [/\bgit\s+push\b/, 'git push'],
  [/\bgit\s+reset\s+--hard\b/, 'destructive git reset'],
  [/\bgit\s+clean\s+-[a-z]*f/, 'git clean -f'],
  [/\bnpm\s+install\b/, 'npm install (network + disk)'],
  [/\bpip\s+install\b/, 'pip install (network + disk)'],
  [/\bapt[-\s]get\s+install\b/, 'apt-get install (system package)'],
  [/\bsudo\b/, 'sudo elevation'],
  [/\bsu\s+-\b/, 'su root elevation'],
  [/\bpasswd\b/, 'password change'],
  [/\bcrontab\b/, 'crontab modification'],
  [/\bssh\b/, 'SSH connection'],
]

function classifyRisk(command: string): RiskResult {
  for (const [pattern, reason] of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) return { level: 'destructive', reason }
  }
  for (const [pattern, reason] of CAUTION_PATTERNS) {
    if (pattern.test(command)) return { level: 'caution', reason }
  }
  return { level: 'safe', reason: null }
}

// ── Spawn helpers ─────────────────────────────────────────────────────────────

interface SpawnSpec {
  executable: string
  args: string[]
  windowsHide: boolean
}

function buildSpawnSpec(shell: ShellKind, command: string): SpawnSpec {
  switch (shell) {
    case 'cmd':
      return { executable: 'cmd.exe', args: ['/d', '/s', '/c', command], windowsHide: true }
    case 'powershell':
      return { executable: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], windowsHide: true }
    case 'zsh':
      return { executable: 'zsh', args: ['-c', command], windowsHide: false }
    case 'fish':
      return { executable: 'fish', args: ['-c', command], windowsHide: false }
    case 'sh':
      return { executable: 'sh', args: ['-c', command], windowsHide: false }
    case 'bash':
    default:
      return { executable: 'bash', args: ['-c', command], windowsHide: false }
  }
}

// ── cwd sanitization ──────────────────────────────────────────────────────────

/** Resolves and validates the working directory. Falls back to cwd() on any problem. */
function sanitizeCwd(rawCwd: string | undefined): string {
  if (!rawCwd?.trim()) return process.cwd()
  const resolved = path.resolve(rawCwd.trim())
  // Block raw device paths and proc filesystem on Linux/macOS
  if (/^\/dev\//i.test(resolved) || /^\/proc\//i.test(resolved) || /^\/sys\//i.test(resolved)) {
    return process.cwd()
  }
  return resolved
}

// ── Tool definitions ──────────────────────────────────────────────────────────

export const terminalDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'run_terminal',
    description:
      'Execute a local shell command and return its output. On Windows defaults to PowerShell; on Linux/macOS defaults to bash. Use for running code, installing packages, managing files, checking system state, or any shell operation. Returns a risk classification (safe/caution/destructive) for each command.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The command to execute.',
        },
        shell: {
          type: 'string',
          enum: ['powershell', 'cmd', 'bash', 'sh', 'zsh', 'fish'],
          description: 'Shell to use. Windows default: "powershell". Linux/macOS default: "bash". Options: powershell, cmd, bash, sh, zsh, fish.',
        },
        cwd: {
          type: 'string',
          description: 'Optional working directory. Defaults to the project root.',
        },
        env: {
          type: 'object',
          description: 'Optional extra environment variables to inject as a JSON object string, e.g. {"NODE_ENV":"production","DEBUG":"1"}. Merged with the current process environment.',
        },
        timeout_sec: {
          type: 'string',
          description: 'Optional timeout in seconds, from 1 to 600. Defaults to 120.',
        },
        max_output_chars: {
          type: 'string',
          description: 'Optional maximum returned output characters, from 1000 to 200000. Defaults to 50000.',
        },
      },
      required: ['command'],
    },
  },
}

export const runTerminal: ToolHandler = (args) => {
  const command = (args.command ?? '').trim()
  if (!command) return Promise.resolve('Error: no command provided')

  const shell = normalizeShell(args.shell)
  const cwd = sanitizeCwd(args.cwd)
  const timeoutSec = Math.min(600, Math.max(1, parseInt(args.timeout_sec ?? '120', 10) || 120))
  const maxOutputChars = Math.min(200_000, Math.max(1000, parseInt(args.max_output_chars ?? '50000', 10) || 50_000))

  // Build merged environment
  const extraEnv: Record<string, string> = {}
  if (args.env && typeof args.env === 'object') {
    for (const [k, v] of Object.entries(args.env as Record<string, unknown>)) {
      if (typeof v === 'string') extraEnv[k] = v
    }
  }
  const mergedEnv = Object.keys(extraEnv).length > 0
    ? { ...process.env, ...extraEnv }
    : undefined // undefined = inherit current env as-is (no copy overhead)

  // Classify command risk
  const risk = classifyRisk(command)

  const { executable, args: spawnArgs, windowsHide } = buildSpawnSpec(shell, command)

  return new Promise((resolve) => {
    const startedAt = Date.now()

    const spawnOpts: Parameters<typeof spawn>[2] = {
      cwd,
      stdio: 'pipe',
      ...(windowsHide ? { windowsHide: true } : {}),
      ...(mergedEnv ? { env: mergedEnv } : {}),
    }

    const proc = spawn(executable, spawnArgs, spawnOpts)

    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      settled = true
      proc.kill('SIGTERM')
      resolve(`Error: command timed out after ${timeoutSec} seconds\n[risk ${risk.level}; shell ${shell}]`)
    }, timeoutSec * 1000)

    proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    proc.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const rawOut = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n')
      const truncated = rawOut.length > maxOutputChars
      const out = truncated
        ? `${rawOut.slice(0, maxOutputChars)}\n[output truncated to ${maxOutputChars.toLocaleString()} chars from ${rawOut.length.toLocaleString()}]`
        : rawOut
      const exitNote = code !== 0 ? `\n[exit code ${code ?? '?'}]` : ''
      const riskNote = risk.level !== 'safe'
        ? `\n[risk ${risk.level}${risk.reason ? `: ${risk.reason}` : ''}]`
        : ''
      const elapsedNote = `\n[shell ${shell}; platform ${os.platform()}; ${Date.now() - startedAt} ms]`
      resolve((out || '(no output)') + exitNote + riskNote + elapsedNote)
    })

    proc.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const hint = err.message.includes('ENOENT')
        ? ` — shell '${executable}' not found on this system`
        : ''
      resolve(`Error: ${err.message}${hint}`)
    })
  })
}
