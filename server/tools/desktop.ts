/**
 * Windows desktop automation — click, type, send keys, find windows.
 * Uses PowerShell + user32.dll + UIAutomation for cross-app control.
 */
import { runTerminal } from './terminal.js'
import type { ToolDefinition, ToolHandler } from './types.js'

// ── desktop_click ─────────────────────────────────────────────────────────────

export const desktopClickDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'desktop_click',
    description: 'Click at specific screen coordinates. Useful for clicking in any application on the desktop. Use take_screenshot first to identify coordinates.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'string', description: 'X screen coordinate.' },
        y: { type: 'string', description: 'Y screen coordinate.' },
        button: { type: 'string', description: 'left (default) or right.' },
        double: { type: 'string', description: 'Set "true" for double-click.' },
      },
      required: ['x', 'y'],
    },
  },
}

export const desktopClick: ToolHandler = (args) => {
  const x = parseInt(args.x ?? '0', 10)
  const y = parseInt(args.y ?? '0', 10)
  const right = args.button === 'right'
  const dbl = args.double === 'true'
  const downFlag = right ? '0x8' : '0x2'
  const upFlag = right ? '0x10' : '0x4'
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DesktopMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X,int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint dx,uint dy,uint cb,UIntPtr ei);
}
"@
[DesktopMouse]::SetCursorPos(${x},${y}); Start-Sleep -Milliseconds 80
[DesktopMouse]::mouse_event(${downFlag},0,0,0,[UIntPtr]::Zero)
[DesktopMouse]::mouse_event(${upFlag},0,0,0,[UIntPtr]::Zero)
${dbl ? `Start-Sleep -Milliseconds 50\n[DesktopMouse]::mouse_event(${downFlag},0,0,0,[UIntPtr]::Zero)\n[DesktopMouse]::mouse_event(${upFlag},0,0,0,[UIntPtr]::Zero)` : ''}
Write-Output "Clicked (${x},${y})${dbl ? ' double' : ''}${right ? ' right' : ''}"
`.trim()
  return runTerminal({ command: script })
}

// ── desktop_type ──────────────────────────────────────────────────────────────

export const desktopTypeDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'desktop_type',
    description: 'Type text into the currently focused window on the desktop (any application).',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to type.' },
      },
      required: ['text'],
    },
  },
}

export const desktopType: ToolHandler = (args) => {
  if (!args.text) return Promise.resolve('Error: text required')
  const safe = args.text.replace(/'/g, "''")
  const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait([System.Text.RegularExpressions.Regex]::Replace('${safe}', '([+^%~(){}\\[\\]])', '{$1}'))
Write-Output "Typed ${args.text.length} chars."
`.trim()
  return runTerminal({ command: script })
}

// ── desktop_send_keys ─────────────────────────────────────────────────────────

export const desktopSendKeysDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'desktop_send_keys',
    description: 'Send keyboard shortcuts to the focused window. Uses SendKeys notation: ^ = Ctrl, % = Alt, + = Shift, {ENTER}, {TAB}, {ESC}, {F4}. Examples: "^c" (Ctrl+C), "^v" (paste), "%{F4}" (Alt+F4), "^a" (select all).',
    parameters: {
      type: 'object',
      properties: {
        keys: { type: 'string', description: 'SendKeys string.' },
      },
      required: ['keys'],
    },
  },
}

export const desktopSendKeys: ToolHandler = (args) => {
  if (!args.keys) return Promise.resolve('Error: keys required')
  const k = args.keys.replace(/'/g, "''")
  return runTerminal({ command: `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${k}'); Write-Output "Sent: ${k}"` })
}

// ── desktop_find_window ───────────────────────────────────────────────────────

export const desktopFindWindowDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'desktop_find_window',
    description: 'Find and focus a window by partial title match. Brings it to the front.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Window title to search for (partial match).' },
      },
      required: ['title'],
    },
  },
}

export const desktopFindWindow: ToolHandler = (args) => {
  if (!args.title) return Promise.resolve('Error: title required')
  const t = args.title.replace(/'/g, "''")
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);
}
"@
$p = Get-Process | Where-Object { $_.MainWindowTitle -like '*${t}*' } | Select-Object -First 1
if ($p) {
  [WinFocus]::ShowWindow($p.MainWindowHandle, 9)
  Start-Sleep -Milliseconds 100
  [WinFocus]::SetForegroundWindow($p.MainWindowHandle)
  Write-Output "Focused: $($p.MainWindowTitle)"
} else { Write-Output "No window found matching: ${t}" }
`.trim()
  return runTerminal({ command: script })
}

// ── desktop_list_windows ──────────────────────────────────────────────────────

export const desktopListWindowsDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'desktop_list_windows',
    description: 'List all open windows on the desktop with their titles and PIDs.',
    parameters: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Optional title filter.' },
      },
    },
  },
}

export const desktopListWindows: ToolHandler = (args) => {
  const filterClause = args.filter
    ? `| Where-Object { $_.MainWindowTitle -like '*${args.filter.replace(/'/g, "''")}*' } `
    : ''
  return runTerminal({
    command: `Get-Process ${filterClause}| Where-Object { $_.MainWindowTitle -ne '' } | Select-Object @{N='PID';E={$_.Id}},@{N='App';E={$_.Name}},MainWindowTitle | Format-Table -AutoSize | Out-String`,
  })
}

// ── desktop_get_cursor_pos ────────────────────────────────────────────────────

export const desktopGetCursorPosDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'desktop_get_cursor_pos',
    description: 'Get the current mouse cursor position. Useful for calibrating desktop_click coordinates.',
    parameters: { type: 'object', properties: {} },
  },
}

export const desktopGetCursorPos: ToolHandler = () => {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public struct POINT { public int X, Y; }
public class Cursor2 { [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p); }
"@
$p = New-Object POINT; [Cursor2]::GetCursorPos([ref]$p) | Out-Null
Write-Output "Cursor: ($($p.X), $($p.Y))"
`.trim()
  return runTerminal({ command: script })
}

// ── desktop_scroll ────────────────────────────────────────────────────────────

export const desktopScrollDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'desktop_scroll',
    description: 'Scroll at specific screen coordinates.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'string', description: 'X coordinate.' },
        y: { type: 'string', description: 'Y coordinate.' },
        direction: { type: 'string', description: 'up or down (default down).' },
        amount: { type: 'string', description: 'Scroll clicks (default 3).' },
      },
      required: ['x', 'y'],
    },
  },
}

export const desktopScroll: ToolHandler = (args) => {
  const x = parseInt(args.x ?? '0', 10)
  const y = parseInt(args.y ?? '0', 10)
  const amt = parseInt(args.amount ?? '3', 10) || 3
  const delta = args.direction === 'up' ? amt * 120 : -(amt * 120)
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DesktopScroll {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X,int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint dx,uint dy,uint cb,UIntPtr ei);
}
"@
[DesktopScroll]::SetCursorPos(${x},${y}); Start-Sleep -Milliseconds 50
[DesktopScroll]::mouse_event(0x800, 0, 0, [uint](${delta}), [UIntPtr]::Zero)
Write-Output "Scrolled ${args.direction ?? 'down'} at (${x},${y})"
`.trim()
  return runTerminal({ command: script })
}
