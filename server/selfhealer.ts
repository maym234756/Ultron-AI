/**
 * Ultron Self-Healing System
 * Detects TypeScript errors, proposes minimal fixes via a restricted agent,
 * and routes ALL changes through the Preview panel for user approval.
 *
 * Guardrails:
 *  - Healing agent is restricted to: read_file, code_search, lint_code, preview_write
 *  - NO direct file writes — ALL changes must go through preview_write
 *  - Rate limited: 1 scan/min, 1 heal/5 min
 *  - Max 6 iterations per heal attempt
 *  - Temperature 0.1 for deterministic, conservative fixes
 *  - Audit log of every heal attempt (last 20 kept in memory)
 */
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import crypto from 'node:crypto'

const execAsync = promisify(exec)

export type HealerIssue = {
  id: string
  type: 'typescript'
  severity: 'error' | 'warning'
  file: string          // absolute path
  relativePath: string  // relative to project root
  line: number
  col: number
  code: string          // e.g. "TS2345"
  message: string
  detectedAt: number
}

export type HealerStatus = 'idle' | 'scanning' | 'healing'

export type HealerLogEntry = {
  id: string
  timestamp: number
  issue: Pick<HealerIssue, 'relativePath' | 'line' | 'code' | 'message'>
  agentSummary: string
  success: boolean      // true = preview was created, false = agent couldn't fix
}

export type HealerState = {
  status: HealerStatus
  lastScanAt: number | null
  scanDurationMs: number | null
  issues: HealerIssue[]
  log: HealerLogEntry[]
  scanError: string | null
  healingIssueId: string | null
}

// ── State singleton ────────────────────────────────────────────────────────────
const state: HealerState = {
  status: 'idle',
  lastScanAt: null,
  scanDurationMs: null,
  issues: [],
  log: [],
  scanError: null,
  healingIssueId: null,
}

// Rate limiting
const SCAN_COOLDOWN_MS  = 60_000       // 1 min between scans
const HEAL_COOLDOWN_MS  = 5 * 60_000  // 5 min between heal attempts
let lastHealAt = 0

export function getHealerState(): HealerState {
  return { ...state, issues: [...state.issues], log: [...state.log] }
}

// ── Scanner ───────────────────────────────────────────────────────────────────

export async function scanForIssues(cwd: string): Promise<HealerIssue[]> {
  if (state.status !== 'idle') return state.issues

  if (state.lastScanAt && Date.now() - state.lastScanAt < SCAN_COOLDOWN_MS) {
    return state.issues // rate-limited
  }

  state.status = 'scanning'
  state.scanError = null
  const t0 = Date.now()
  const issues: HealerIssue[] = []

  try {
    let tscOutput = ''
    try {
      const { stdout, stderr } = await execAsync(
        'npx tsc -p tsconfig.json --noEmit --pretty false 2>&1',
        { cwd, timeout: 45_000 },
      )
      tscOutput = stdout + stderr
    } catch (e: unknown) {
      // tsc exits non-zero on errors — expected. Capture output from thrown error.
      const err = e as { stdout?: string; stderr?: string }
      tscOutput = (err.stdout ?? '') + (err.stderr ?? '')
    }

    // Parse: "src/App.tsx(123,4): error TS2345: message"
    const re = /^(.+?\.tsx?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.+)$/gm
    let m: RegExpExecArray | null
    const seen = new Set<string>()

    while ((m = re.exec(tscOutput)) !== null) {
      const key = `${m[1]}:${m[2]}:${m[5]}`
      if (seen.has(key)) continue
      seen.add(key)

      issues.push({
        id: crypto.randomUUID(),
        type: 'typescript',
        severity: m[4] === 'error' ? 'error' : 'warning',
        file: m[1], // may be relative; resolved later if needed
        relativePath: m[1].replace(/\\/g, '/'),
        line: parseInt(m[2], 10),
        col: parseInt(m[3], 10),
        code: m[5],
        message: m[6].trim(),
        detectedAt: Date.now(),
      })
    }
  } catch (err) {
    state.scanError = err instanceof Error ? err.message : String(err)
  }

  state.issues = issues
  state.lastScanAt = Date.now()
  state.scanDurationMs = Date.now() - t0
  state.status = 'idle'
  return issues
}

// ── Heal rate-limit check ─────────────────────────────────────────────────────

export function canHeal(): { allowed: boolean; reason?: string } {
  if (state.status === 'healing') return { allowed: false, reason: 'A heal is already in progress' }
  const wait = HEAL_COOLDOWN_MS - (Date.now() - lastHealAt)
  if (wait > 0) return { allowed: false, reason: `Rate limited — wait ${Math.ceil(wait / 1000)}s` }
  return { allowed: true }
}

// ── Heal state management ─────────────────────────────────────────────────────

export function setHealingStatus(active: boolean, issueId?: string) {
  state.status = active ? 'healing' : 'idle'
  state.healingIssueId = active ? (issueId ?? null) : null
  if (active) lastHealAt = Date.now()
}

export function addHealLog(entry: HealerLogEntry) {
  state.log = [entry, ...state.log].slice(0, 20)
}

// ── Healing agent system prompt ───────────────────────────────────────────────

export function buildHealerPrompt(issue: HealerIssue): string {
  return `You are Ultron's Self-Healing Agent — a restricted TypeScript error fixer.

MISSION: Fix this specific TypeScript error. Nothing else.

ERROR TO FIX:
  File:    ${issue.relativePath}
  Line:    ${issue.line}, Col: ${issue.col}
  Code:    ${issue.code}
  Message: ${issue.message}

STRICT CONSTRAINTS:
1. You ONLY have access to: read_file, code_search, lint_code, preview_write
2. ALL file changes MUST go through preview_write — NEVER use write_file directly
3. Fix ONLY this specific error — do not refactor unrelated code
4. Minimal change: alter as few lines as possible
5. If you cannot fix it safely without breaking other code, reply: "CANNOT_HEAL: <reason>"

WORKFLOW:
Step 1: read_file the affected file (around the error line)
Step 2: Understand the exact TypeScript error
Step 3: Formulate a minimal fix
Step 4: Use preview_write with the corrected file content and description "Self-heal: ${issue.code} at ${issue.relativePath}:${issue.line}"

The user will review the diff before anything is written.`
}
