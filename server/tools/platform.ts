/**
 * Platform detection helpers and sys_platform tool.
 * Used across Windows-only tools to return clear "not supported on this OS" messages
 * rather than silently failing with PowerShell errors.
 */
import { platform, arch, homedir, tmpdir } from 'node:os'
import { runTerminal } from './terminal.js'
import type { ToolDefinition, ToolHandler } from './types.js'

// ── platform helpers ──────────────────────────────────────────────────────────

export const PLATFORM = platform()

export function isWindows(): boolean { return PLATFORM === 'win32' }
export function isMac(): boolean     { return PLATFORM === 'darwin' }
export function isLinux(): boolean   { return PLATFORM === 'linux' }

/**
 * Returns a "not supported" error string for tools that only work on Windows.
 * Returns null if on Windows (tool is supported).
 */
export function windowsOnly(toolName: string): string | null {
  if (isWindows()) return null
  const name = PLATFORM === 'darwin' ? 'macOS' : 'Linux'
  return `"${toolName}" is currently only supported on Windows. Running on: ${name}. Cross-platform support is planned.`
}

/**
 * Returns a "not supported" error string for tools that don't work on a given platform.
 * Returns null if the current platform is in the allowed list.
 */
export function requirePlatform(toolName: string, ...allowed: Array<'win32' | 'darwin' | 'linux'>): string | null {
  if ((allowed as string[]).includes(PLATFORM)) return null
  const names: Record<string, string> = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }
  const current = names[PLATFORM] ?? PLATFORM
  const supports = allowed.map(p => names[p] ?? p).join(', ')
  return `"${toolName}" requires ${supports}. Running on: ${current}.`
}

// ── sys_platform ──────────────────────────────────────────────────────────────

export const sysPlatformDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'sys_platform',
    description: 'Get detailed platform information: OS, architecture, shell, admin/root status, temp directory, home directory, and which Ultron capabilities are available on this platform.',
    parameters: { type: 'object', properties: {} },
  },
}

export const sysPlatform: ToolHandler = async () => {
  const info: Record<string, string> = {
    platform: PLATFORM,
    arch: arch(),
    os: PLATFORM === 'win32' ? 'Windows' : PLATFORM === 'darwin' ? 'macOS' : 'Linux',
    homeDir: homedir(),
    tempDir: tmpdir(),
  }

  // Detect shell
  const shell = process.env.SHELL ?? process.env.ComSpec ?? 'unknown'
  info.shell = shell

  // Check admin/root
  let isElevated = 'unknown'
  if (isWindows()) {
    try {
      const r = await runTerminal({ command: 'net session 2>&1', timeout_sec: '5' })
      isElevated = r.includes('Access is denied') ? 'no (standard user)' : 'yes (Administrator)'
    } catch { isElevated = 'unknown' }
  } else {
    isElevated = process.getuid?.() === 0 ? 'yes (root)' : 'no (standard user)'
  }
  info.isAdmin = isElevated

  // Node + runtime info
  info.nodeVersion = process.version
  info.pid = String(process.pid)

  // Feature availability
  const features = {
    'PowerShell automation': isWindows() ? '✓ available' : '✗ Windows only',
    'Desktop automation': isWindows() ? '✓ available (user32.dll)' : '✗ Windows only',
    'Outlook email/calendar': isWindows() ? '✓ available' : '✗ Windows only',
    'Windows services': isWindows() ? '✓ available' : '✗ Windows only',
    'Screen capture (take_screenshot)': isWindows() ? '✓ available' : isMac() ? '✓ available (screencapture)' : '✓ available (scrot/gnome-screenshot)',
    'Playwright browser': '✓ available (all platforms)',
    'Python REPL': '✓ available (if python installed)',
    'Git tools': '✓ available (all platforms)',
    'File tools': '✓ available (all platforms)',
    'HTTP tools': '✓ available (all platforms)',
    'RAG / embeddings': '✓ available (requires Ollama)',
    'Media tools (ffmpeg)': '✓ available (if ffmpeg installed)',
    'Audio transcription': '✓ available (if whisper installed)',
    'Vision tools': '✓ available (requires Ollama vision model)',
  }

  // Simpler format
  const out: string[] = [
    '=== Ultron Platform Info ===',
    '',
    `OS:        ${info.os} (${PLATFORM})`,
    `Arch:      ${info.arch}`,
    `Home:      ${info.homeDir}`,
    `Temp:      ${info.tempDir}`,
    `Shell:     ${info.shell}`,
    `Admin:     ${info.isAdmin}`,
    `Node:      ${info.nodeVersion}`,
    '',
    '=== Feature Availability ===',
    '',
  ]
  for (const [feature, status] of Object.entries(features)) {
    out.push(`${status.startsWith('✓') ? '✓' : '✗'} ${feature}`)
  }
  return out.join('\n')
}
