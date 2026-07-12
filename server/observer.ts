import { existsSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { getOpenTabs } from './tools/browser.js'

const CONTEXT_FILE = join(process.cwd(), '.screen-context.json')

export interface WindowInfo {
  process: string
  title: string
}

export interface ScreenContext {
  timestamp: number
  activeApp: string
  windowTitles: WindowInfo[]
  browserTabs: Array<{ browser: string; title: string }>
  visionSummary: string | null
  mode: 'fast' | 'deep'
}

let _interval: ReturnType<typeof setInterval> | null = null
let _ollamaUrl = 'http://127.0.0.1:11434'
let _enabled = false
let _mode: 'fast' | 'deep' = 'fast'
let _intervalSec = 60

// ── persist / load ────────────────────────────────────────────────────────────

export function loadContext(): ScreenContext | null {
  if (!existsSync(CONTEXT_FILE)) return null
  try { return JSON.parse(readFileSync(CONTEXT_FILE, 'utf-8')) as ScreenContext } catch { return null }
}

function saveContext(ctx: ScreenContext): void {
  writeFileSync(CONTEXT_FILE, JSON.stringify(ctx, null, 2), 'utf-8')
}

// ── PowerShell helpers ────────────────────────────────────────────────────────

function runPS(cmd: string, timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve) => {
    let out = ''
    let settled = false
    const finish = (value: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], {
      stdio: 'pipe', windowsHide: true,
    })
    const timer = setTimeout(() => { proc.kill(); finish(out) }, timeoutMs)
    proc.stdout?.on('data', (d: Buffer) => { out += d.toString() })
    proc.stderr?.on('data', () => {/* ignore */})
    proc.on('error', () => finish(out.trim()))
    proc.on('close', () => finish(out.trim()))
  })
}

async function captureWindows(): Promise<WindowInfo[]> {
  const raw = await runPS(
    `Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | ` +
    `Sort-Object CPU -Descending | Select-Object -First 20 | ` +
    `ForEach-Object { "$($_.ProcessName)|$($_.MainWindowTitle)" }`,
    8_000,
  )
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const idx = l.indexOf('|')
      return { process: l.slice(0, idx).toLowerCase(), title: l.slice(idx + 1) }
    })
}

const BROWSER_PROCS = new Set(['chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi'])

async function takeScreenshotBase64(): Promise<string> {
  const tmp = join(tmpdir(), 'astra_obs.png').replace(/\\/g, '\\\\')
  await runPS(
    `Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($s.Width, $s.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($s.Location, [System.Drawing.Point]::Empty, $s.Size)
$bmp.Save('${tmp}'); $g.Dispose(); $bmp.Dispose()`,
    15_000,
  )
  try {
    const { readFileSync } = await import('node:fs')
    return readFileSync(tmp.replace(/\\\\/g, '\\')).toString('base64')
  } catch { return '' }
}

async function analyzeVision(b64: string): Promise<string> {
  try {
    const res = await fetch(`${_ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llava:latest',
        prompt: 'In 1-2 sentences describe what is on screen: what app/website is open, what content is visible, what the user appears to be doing. Be specific (e.g. mention the site name, document title, email subject if visible).',
        images: [b64],
        stream: false,
        options: { temperature: 0.1, num_predict: 200 },
      }),
      signal: AbortSignal.timeout(45_000),
    })
    if (!res.ok) return '(vision unavailable)'
    const data = await res.json() as { response?: string }
    return data.response?.trim() ?? '(no description)'
  } catch { return '(vision unavailable)' }
}

// ── core capture ──────────────────────────────────────────────────────────────

export async function captureNow(mode: 'fast' | 'deep' = _mode): Promise<ScreenContext> {
  // Run window list + full tab enumeration in parallel
  const [windows, allTabs] = await Promise.all([
    captureWindows(),
    getOpenTabs(),
  ])

  const activeApp = windows[0]?.process ?? 'unknown'

  let visionSummary: string | null = null
  if (mode === 'deep') {
    const b64 = await takeScreenshotBase64()
    if (b64) visionSummary = await analyzeVision(b64)
  }

  const ctx: ScreenContext = {
    timestamp: Date.now(),
    activeApp,
    windowTitles: windows,
    browserTabs: allTabs,
    visionSummary,
    mode,
  }

  saveContext(ctx)
  return ctx
}

// ── format context for agent ──────────────────────────────────────────────────

export function formatContextForAgent(ctx: ScreenContext): string {
  const age = Math.round((Date.now() - ctx.timestamp) / 1000)
  const ts = new Date(ctx.timestamp).toLocaleTimeString()

  const lines: string[] = [
    `[AMBIENT SCREEN CONTEXT — captured ${ts} (${age}s ago)]`,
    `Active app: ${ctx.activeApp}`,
  ]

  if (ctx.browserTabs.length > 0) {
    // Group tabs by browser
    const byBrowser: Record<string, string[]> = {}
    for (const t of ctx.browserTabs) {
      byBrowser[t.browser] ??= []
      byBrowser[t.browser].push(t.title)
    }
    for (const [browser, titles] of Object.entries(byBrowser)) {
      lines.push(`${browser} tabs (${titles.length}): ${titles.slice(0, 10).join(' | ')}`)
    }
  }

  const otherWindows = ctx.windowTitles
    .filter((w) => !BROWSER_PROCS.has(w.process))
    .slice(0, 6)
  if (otherWindows.length > 0) {
    lines.push(`Other open windows: ${otherWindows.map((w) => w.title).join(' | ')}`)
  }

  if (ctx.visionSummary) {
    lines.push(`Vision: ${ctx.visionSummary}`)
  }

  return lines.join('\n')
}

// ── observer lifecycle ────────────────────────────────────────────────────────

export function startObserver(ollamaUrl: string, intervalSec: number, mode: 'fast' | 'deep'): void {
  if (process.platform !== 'win32') {
    console.log('[observer] disabled: screen observer requires Windows desktop APIs')
    return
  }

  _ollamaUrl = ollamaUrl
  _intervalSec = intervalSec
  _mode = mode
  _enabled = true

  if (_interval) clearInterval(_interval)

  // First capture 3s after start
  setTimeout(() => captureNow(mode).catch(console.error), 3_000)

  _interval = setInterval(() => captureNow(mode).catch(console.error), intervalSec * 1_000)
  console.log(`[observer] started — mode=${mode}, interval=${intervalSec}s`)
}

export function stopObserver(): void {
  if (_interval) { clearInterval(_interval); _interval = null }
  _enabled = false
  console.log('[observer] stopped')
}

export function observerStatus(): { enabled: boolean; mode: string; intervalSec: number; context: ScreenContext | null } {
  return { enabled: _enabled, mode: _mode, intervalSec: _intervalSec, context: loadContext() }
}
