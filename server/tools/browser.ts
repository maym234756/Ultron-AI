import { exec } from 'node:child_process'
import type { ToolDefinition, ToolHandler } from './types.js'

export const openBrowserDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'open_browser',
    description: "Open a URL in the user's default web browser.",
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full URL to open, e.g. https://example.com' },
      },
      required: ['url'],
    },
  },
}

export const openBrowser: ToolHandler = (args) => {
  const url = (args.url ?? '').trim()
  if (!url) return Promise.resolve('Error: url is required')
  try {
    new URL(url)
  } catch {
    return Promise.resolve('Error: invalid URL')
  }
  const safe = url.replace(/"/g, '')
  return new Promise((resolve) => {
    exec(`start "" "${safe}"`, (err) => {
      resolve(err ? `Error opening browser: ${err.message}` : `Opened ${url} in the default browser`)
    })
  })
}

export const fetchWebpageDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'fetch_webpage',
    description:
      'Fetch and return the visible text content of a webpage, stripped of HTML tags.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full URL to fetch' },
      },
      required: ['url'],
    },
  },
}

export const fetchWebpage: ToolHandler = async (args) => {
  const url = (args.url ?? '').trim()
  if (!url) return 'Error: url is required'
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Lumivex AI/1.0)' },
      signal: AbortSignal.timeout(12_000),
    })
    const html = await res.text()
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    return text.length > 7000 ? `${text.slice(0, 7000)}\n... [truncated]` : text
  } catch (err) {
    return `Error fetching ${url}: ${err instanceof Error ? err.message : String(err)}`
  }
}

// ── list_tabs ─────────────────────────────────────────────────────────────────
// Uses Windows UI Automation to enumerate ALL open browser tabs — not just the
// active one. Works with Chrome, Edge, Firefox, Brave without any special setup.

const LIST_TABS_SCRIPT = `
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

$browsers = @{ chrome='Chrome'; msedge='Edge'; firefox='Firefox'; brave='Brave'; opera='Opera'; vivaldi='Vivaldi' }
$results  = [System.Collections.Generic.List[PSCustomObject]]::new()
$tabType  = [System.Windows.Automation.ControlType]::TabItem

foreach ($name in $browsers.Keys) {
  $procs = Get-Process $name -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
  foreach ($p in $procs) {
    try {
      $root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
      $cond = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty, $tabType)
      $tabs = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
      foreach ($t in $tabs) {
        $title = $t.Current.Name
        if ($title -and $title -ne 'New Tab' -and $title -ne 'New tab') {
          $results.Add([PSCustomObject]@{ browser=$browsers[$name]; title=$title })
        }
      }
    } catch {}
  }
}

if ($results.Count -eq 0) {
  # Fallback: window titles only (active tab per window)
  Get-Process | Where-Object { $_.MainWindowTitle -ne '' } |
    Where-Object { $browsers.ContainsKey($_.ProcessName.ToLower()) } |
    ForEach-Object { $results.Add([PSCustomObject]@{ browser=$browsers[$_.ProcessName.ToLower()]; title=$_.MainWindowTitle }) }
}

$results | ConvertTo-Json -Compress
`

export interface BrowserTab { browser: string; title: string }

export async function getOpenTabs(): Promise<BrowserTab[]> {
  const { spawn } = await import('node:child_process')
  const out = await new Promise<string>((resolve) => {
    let buf = ''
    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', LIST_TABS_SCRIPT], {
      stdio: 'pipe', windowsHide: true,
    })
    const timer = setTimeout(() => { proc.kill(); resolve(buf) }, 15_000)
    proc.stdout?.on('data', (d: Buffer) => { buf += d.toString() })
    proc.on('close', () => { clearTimeout(timer); resolve(buf.trim()) })
  })
  if (!out) return []
  try {
    const parsed = JSON.parse(out)
    return (Array.isArray(parsed) ? parsed : [parsed]) as BrowserTab[]
  } catch { return [] }
}

// ── focus_tab ─────────────────────────────────────────────────────────────────
// Click a tab in the user's real browser (Chrome/Edge/Firefox/Brave) by partial
// title match — brings the window to foreground and invokes the tab.

const FOCUS_TAB_SCRIPT = (title: string) => `
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);' -Name W32 -Namespace UIA -ErrorAction SilentlyContinue

$browsers = @{ chrome='Chrome'; msedge='Edge'; firefox='Firefox'; brave='Brave'; opera='Opera'; vivaldi='Vivaldi' }
$target = ${JSON.stringify(title)}.ToLower()
$tabType = [System.Windows.Automation.ControlType]::TabItem

foreach ($name in $browsers.Keys) {
  $procs = Get-Process $name -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
  foreach ($p in $procs) {
    try {
      $root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
      $cond = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty, $tabType)
      $tabs = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
      foreach ($t in $tabs) {
        if ($t.Current.Name.ToLower().Contains($target)) {
          [UIA.W32]::ShowWindow($p.MainWindowHandle, 9)
          [UIA.W32]::SetForegroundWindow($p.MainWindowHandle)
          $inv = $t.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
          $inv.Invoke()
          Write-Output "Switched to: $($t.Current.Name) [$($browsers[$name])]"
          exit 0
        }
      }
    } catch {}
  }
}
Write-Output "No tab found matching: ${JSON.stringify(title)}"
`

export const focusTabDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'focus_tab',
    description:
      "Click on a tab in the user's real browser (Chrome, Edge, Firefox, Brave) by partial title match. Brings the browser window to the foreground and switches to the matching tab. Use this when the user says 'show me the Gmail tab', 'switch to Netflix', 'go to my docs tab', etc.",
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Partial tab title to match, e.g. "Gmail", "GitHub", "Netflix".' },
      },
      required: ['title'],
    },
  },
}

export const focusTab: ToolHandler = async (args) => {
  const title = (args.title ?? '').trim()
  if (!title) return 'Error: title is required'
  const { spawn } = await import('node:child_process')
  return new Promise((resolve) => {
    let out = ''
    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', FOCUS_TAB_SCRIPT(title)], {
      stdio: 'pipe', windowsHide: true,
    })
    const timer = setTimeout(() => { proc.kill(); resolve('Timed out trying to focus tab.') }, 12_000)
    proc.stdout?.on('data', (d: Buffer) => { out += d.toString() })
    proc.stderr?.on('data', (d: Buffer) => { out += d.toString() })
    proc.on('close', () => { clearTimeout(timer); resolve(out.trim() || 'Done.') })
  })
}

export const listTabsDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'list_tabs',
    description:
      'List ALL open browser tabs across Chrome, Edge, Firefox, and Brave — not just the active one. Returns browser name and tab title for each open tab.',
    parameters: {
      type: 'object',
      properties: {
        browser: { type: 'string', description: 'Filter to a specific browser: chrome, edge, firefox, brave. Omit for all.' },
      },
    },
  },
}

export const listTabs: ToolHandler = async (args) => {
  const tabs = await getOpenTabs()
  if (tabs.length === 0) return 'No browser tabs found. Is a browser open?'
  const filter = args.browser?.toLowerCase()
  const filtered = filter ? tabs.filter(t => t.browser.toLowerCase().includes(filter)) : tabs
  if (filtered.length === 0) return `No tabs found for browser: ${args.browser}`
  const grouped: Record<string, string[]> = {}
  for (const t of filtered) {
    grouped[t.browser] ??= []
    grouped[t.browser].push(t.title)
  }
  return Object.entries(grouped)
    .map(([b, titles]) => `${b} (${titles.length} tab${titles.length > 1 ? 's' : ''}):\n${titles.map((t, i) => `  ${i + 1}. ${t}`).join('\n')}`)
    .join('\n\n')
}
