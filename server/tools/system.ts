import { join } from 'node:path'
import { homedir } from 'node:os'
import { writeFile as fsWrite } from 'node:fs/promises'
import type { ToolDefinition, ToolHandler } from './types.js'
import { runTerminal } from './terminal.js'

// ── open_app ──────────────────────────────────────────────────────────────────

export const openAppDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'open_app',
    description:
      'Open or focus a Windows application or file by name. Reuses an existing app window by default before launching a duplicate. Supports: cmd, powershell, terminal (Windows Terminal), notepad, vscode, explorer, paint, calculator, taskmgr, chrome, edge, firefox, or any .exe path.',
    parameters: {
      type: 'object',
      properties: {
        app: {
          type: 'string',
          description: 'App name or path (e.g. "cmd", "notepad", "C:\\path\\to\\app.exe")',
        },
        args: {
          type: 'string',
          description: 'Optional command-line arguments to pass to the app.',
        },
        reuse: {
          type: 'string',
          description: 'Set "false" to force a new window. Defaults to "true" and focuses an existing matching window when possible.',
        },
      },
      required: ['app'],
    },
  },
}

const APP_MAP: Record<string, string> = {
  cmd: 'cmd.exe',
  'command prompt': 'cmd.exe',
  powershell: 'powershell.exe',
  ps: 'powershell.exe',
  terminal: 'wt.exe',
  'windows terminal': 'wt.exe',
  notepad: 'notepad.exe',
  paint: 'mspaint.exe',
  'ms paint': 'mspaint.exe',
  calculator: 'calc.exe',
  calc: 'calc.exe',
  explorer: 'explorer.exe',
  'file explorer': 'explorer.exe',
  taskmgr: 'taskmgr.exe',
  'task manager': 'taskmgr.exe',
  vscode: 'code',
  code: 'code',
  wordpad: 'wordpad.exe',
  chrome: 'chrome',
  edge: 'msedge.exe',
  firefox: 'firefox.exe',
  vlc: 'vlc.exe',
  snipping: 'SnippingTool.exe',
  snip: 'SnippingTool.exe',
}

const APP_PROCESS_HINTS: Record<string, string[]> = {
  cmd: ['cmd'],
  'command prompt': ['cmd'],
  powershell: ['powershell', 'pwsh'],
  ps: ['powershell', 'pwsh'],
  terminal: ['WindowsTerminal'],
  'windows terminal': ['WindowsTerminal'],
  explorer: ['explorer'],
  'file explorer': ['explorer'],
  chrome: ['chrome'],
  edge: ['msedge'],
  firefox: ['firefox'],
  vscode: ['Code'],
  code: ['Code'],
  notepad: ['notepad'],
  taskmgr: ['Taskmgr'],
}

function focusExistingWindowCommand(processNames: string[]): string {
  const names = processNames.map(name => `'${name.replace(/'/g, "''")}'`).join(',')
  return `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ExistingWindowFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);
}
"@
$names = @(${names})
$astraFocusedExistingWindow = $false
$p = Get-Process -ErrorAction SilentlyContinue | Where-Object { $names -contains $_.ProcessName -and $_.MainWindowHandle -ne 0 } | Sort-Object StartTime -Descending | Select-Object -First 1
if ($p) {
  [ExistingWindowFocus]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
  Start-Sleep -Milliseconds 120
  [ExistingWindowFocus]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
  Write-Output "Focused existing $($p.ProcessName): $($p.MainWindowTitle)"
  $astraFocusedExistingWindow = $true
}
`.trim()
}

function reuseExplorerPathCommand(exe: string, targetPath: string): string {
  const safePath = targetPath.replace(/'/g, "''")
  return `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ExistingExplorerFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);
}
"@
$targetPath = '${safePath}'
$shell = New-Object -ComObject Shell.Application
$window = @($shell.Windows() | Where-Object { $_.FullName -like '*explorer.exe' }) | Select-Object -First 1
if ($window) {
  $window.Navigate2($targetPath)
  Start-Sleep -Milliseconds 250
  [ExistingExplorerFocus]::ShowWindow([IntPtr]$window.HWND, 9) | Out-Null
  [ExistingExplorerFocus]::SetForegroundWindow([IntPtr]$window.HWND) | Out-Null
  Write-Output "Reused File Explorer: $targetPath"
} else {
  Start-Process "${exe}" -ArgumentList "${targetPath.replace(/"/g, '\\"')}"
  Write-Output "Opened ${exe}: $targetPath"
}
`.trim()
}

export const openApp: ToolHandler = (args) => {
  const raw = (args.app ?? '').trim().toLowerCase()
  const extra = (args.args ?? '').trim()
  const exe = APP_MAP[raw] ?? args.app?.trim() ?? ''
  if (!exe) return Promise.resolve('Error: no app specified')
  if (args.reuse !== 'false' && extra && (raw === 'explorer' || raw === 'file explorer')) {
    return runTerminal({ command: reuseExplorerPathCommand(exe, extra) })
  }
  if (args.reuse !== 'false' && !extra) {
    const processNames = APP_PROCESS_HINTS[raw]
    if (processNames?.length) {
      return runTerminal({
        command: `${focusExistingWindowCommand(processNames)}; if (-not $astraFocusedExistingWindow) { ${extra
          ? `Start-Process "${exe}" -ArgumentList "${extra.replace(/"/g, '\\"')}"`
          : `Start-Process "${exe}"`}; Write-Output "Opened ${exe}" }`,
      })
    }
  }
  const cmd = extra
    ? `Start-Process "${exe}" -ArgumentList "${extra.replace(/"/g, '\\"')}"`
    : `Start-Process "${exe}"`
  return runTerminal({ command: cmd })
}

// ── screenshot ────────────────────────────────────────────────────────────────

export const screenshotDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'take_screenshot',
    description:
      'Capture the entire screen and save it as a PNG on the Desktop. Returns the saved file path.',
    parameters: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'Optional filename (without extension). Defaults to screenshot_<timestamp>.',
        },
      },
      required: [],
    },
  },
}

export const takeScreenshot: ToolHandler = (args) => {
  const name = (args.filename ?? '').trim() || `screenshot_${Date.now()}`
  const dest = join(homedir(), 'Desktop', `${name}.png`).replace(/\\/g, '\\\\')
  const script = `
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bmp.Save("${dest}")
$g.Dispose(); $bmp.Dispose()
Write-Output "Saved: ${dest}"
`.trim()
  return runTerminal({ command: script })
}

// ── clipboard ─────────────────────────────────────────────────────────────────

export const clipboardReadDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'clipboard_read',
    description: 'Read the current text content of the Windows clipboard.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
}

export const clipboardRead: ToolHandler = () =>
  runTerminal({ command: 'Get-Clipboard' })

export const clipboardWriteDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'clipboard_write',
    description: 'Write text to the Windows clipboard.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text to copy to clipboard.' },
      },
      required: ['text'],
    },
  },
}

export const clipboardWrite: ToolHandler = (args) => {
  const text = (args.text ?? '').replace(/'/g, "''")
  return runTerminal({ command: `Set-Clipboard -Value '${text}'; Write-Output "Copied to clipboard."` })
}

// ── speak ─────────────────────────────────────────────────────────────────────

export const speakDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'speak',
    description: 'Speak text aloud using Windows built-in Text-to-Speech (no install needed).',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to speak.' },
        rate: { type: 'string', description: 'Speed: -10 (slowest) to 10 (fastest). Default 0.' },
      },
      required: ['text'],
    },
  },
}

export const speak: ToolHandler = (args) => {
  const text = (args.text ?? '').replace(/'/g, "''")
  const rate = parseInt(args.rate ?? '0', 10) || 0
  const script = [
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    `$s.Rate = ${rate}`,
    `$s.Speak('${text}')`,
    "Write-Output 'Done speaking.'",
  ].join('; ')
  return runTerminal({ command: script })
}

// ── generate_image ────────────────────────────────────────────────────────────

export const generateImageDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'generate_image',
    description:
      'Generate an image from a text prompt using AI (Pollinations.ai, free, no key needed). Saves to Desktop and opens it.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Describe the image to generate.' },
        filename: { type: 'string', description: 'Output filename (no extension). Defaults to image_<timestamp>.' },
        width: { type: 'string', description: 'Width in pixels (default 1024).' },
        height: { type: 'string', description: 'Height in pixels (default 1024).' },
      },
      required: ['prompt'],
    },
  },
}

export const generateImage: ToolHandler = async (args) => {
  const prompt = (args.prompt ?? '').trim()
  if (!prompt) return 'Error: no prompt provided'
  const w = parseInt(args.width ?? '1024', 10) || 1024
  const h = parseInt(args.height ?? '1024', 10) || 1024
  const name = (args.filename ?? '').trim() || `image_${Date.now()}`
  const dest = join(homedir(), 'Desktop', `${name}.png`)

  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&nologo=true&seed=${Math.floor(Math.random() * 999999)}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(90_000) })
    if (!res.ok) return `Pollinations error: HTTP ${res.status}`
    const buf = await res.arrayBuffer()
    await fsWrite(dest, Buffer.from(buf))
    await runTerminal({ command: `Start-Process "${dest}"` })
    return `Image generated and saved to: ${dest}`
  } catch (err) {
    return `Image generation failed: ${err instanceof Error ? err.message : String(err)}`
  }
}


// -- notify --------------------------------------------------------------------

export const notifyDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'notify',
    description: 'Send a Windows balloon-tip notification to the system tray. Non-blocking � good for alerting when a long task finishes.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Notification title.' },
        message: { type: 'string', description: 'Notification body text.' },
      },
      required: ['title', 'message'],
    },
  },
}

export const notify: ToolHandler = (args) => {
  const title = (args.title ?? 'Astra').replace(/"/g, "'")
  const message = (args.message ?? '').replace(/"/g, "'")
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$n = New-Object System.Windows.Forms.NotifyIcon',
    '$n.Icon = [System.Drawing.SystemIcons]::Information',
    `$n.BalloonTipTitle = "${title}"`,
    `$n.BalloonTipText = "${message}"`,
    '$n.Visible = $true',
    '$n.ShowBalloonTip(5000)',
    'Start-Sleep -Milliseconds 5100',
    '$n.Dispose()',
  ].join('; ')
  return runTerminal({ command: script })
}
