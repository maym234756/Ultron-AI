import { spawn } from 'node:child_process'
import type { ToolDefinition, ToolHandler } from './types.js'
import { runTerminal } from './terminal.js'

function boundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function psString(value: string | undefined): string {
  return `'${(value ?? '').replace(/'/g, "''")}'`
}

function stripControlChars(value: string | undefined): string {
  return Array.from(value ?? '').filter(char => {
    const code = char.charCodeAt(0)
    return code === 9 || code === 10 || code === 13 || code >= 32
  }).join('')
}

// ── compose_email (browser-based, works with any web email) ───────────────────

export const composeEmailDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'compose_email',
    description:
      'Open an email compose window in the browser. Works with Gmail, Outlook.com, Yahoo Mail, and any web-based email. Use this INSTEAD of email_send when the user has a web email client. Supports pre-filling to, subject, and body.',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address.' },
        subject: { type: 'string', description: 'Email subject line.' },
        body: { type: 'string', description: 'Email body text.' },
        provider: {
          type: 'string',
          description:
            'Email provider: gmail (default), outlook_web, yahoo, protonmail, mailto, or auto (take screenshot to detect).',
        },
      },
      required: ['to', 'subject', 'body'],
    },
  },
}

export const composeEmail: ToolHandler = async (args) => {
  const to = encodeURIComponent((args.to ?? '').trim())
  const subject = encodeURIComponent((args.subject ?? '').trim())
  const body = encodeURIComponent((args.body ?? '').trim())
  const provider = (args.provider ?? 'gmail').toLowerCase().trim()

  let url: string
  switch (provider) {
    case 'outlook_web':
    case 'outlook':
      url = `https://outlook.live.com/mail/0/deeplink/compose?to=${to}&subject=${subject}&body=${body}`
      break
    case 'yahoo':
      url = `https://compose.mail.yahoo.com/?to=${to}&subject=${subject}&body=${body}`
      break
    case 'protonmail':
      url = `https://mail.proton.me/u/0/inbox#compose`
      break
    case 'mailto':
      url = `mailto:${to}?subject=${subject}&body=${body}`
      break
    default: // gmail
      url = `https://mail.google.com/mail/?view=cm&fs=1&to=${to}&su=${subject}&body=${body}`
  }

  // Open in default browser
  spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process "${url}"`], {
    detached: true, stdio: 'ignore', windowsHide: true,
  }).unref()

  return `Opened ${provider === 'auto' ? 'Gmail' : provider} compose window with:\n  To: ${args.to}\n  Subject: ${args.subject}\n  Body pre-filled.`
}

// ── detect_email_provider ─────────────────────────────────────────────────────

export const detectEmailProviderDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'detect_email_provider',
    description:
      'Take a screenshot and use vision AI to detect which email client or provider the user currently has open (Gmail, Outlook, Yahoo, etc.). Call this before sending email if you are unsure what system the user uses.',
    parameters: { type: 'object', properties: {} },
  },
}

export const detectEmailProvider: ToolHandler = async (_args) => {
  // Delegate to screen_read via a PowerShell screenshot + vision pipeline
  // We shell out to take a screenshot and return instructions for the agent
  const result = await runTerminal({
    command: `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen | Select-Object -ExpandProperty Bounds`,
  })
  return `Take a screenshot with take_screenshot, then call analyze_image on it asking "What email client or web email provider is visible on this screen? Answer with one of: gmail, outlook_desktop, outlook_web, yahoo, protonmail, apple_mail, thunderbird, other, or none_visible." Then use compose_email with the detected provider, or email_send if outlook_desktop is detected.\n\nScreen info: ${result}`
}

// ── email_read ────────────────────────────────────────────────────────────────

export const emailReadDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'email_read',
    description: 'Read emails from Outlook inbox. Returns subject, sender, date, and body preview. Requires Outlook to be installed.',
    parameters: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Folder to read: inbox (default), sent, drafts.' },
        count: { type: 'string', description: 'Number of emails to return (default 10).' },
        unread_only: { type: 'string', description: 'Set to "true" to show only unread emails.' },
      },
    },
  },
}

export const emailRead: ToolHandler = (args) => {
  const count = boundedInt(args.count, 10, 1, 100)
  const unreadOnly = args.unread_only === 'true'
  const folderMap: Record<string, number> = { inbox: 6, sent: 5, drafts: 16 }
  const folderId = folderMap[(args.folder ?? 'inbox').toLowerCase()] ?? 6

  const script = `
$ol = New-Object -ComObject Outlook.Application -ErrorAction Stop
$ns = $ol.GetNamespace('MAPI')
$folder = $ns.GetDefaultFolder(${folderId})
$items = $folder.Items
$items.Sort('[ReceivedTime]', $true)
$results = @()
$count = 0
foreach ($item in $items) {
  if ($count -ge ${count}) { break }
  ${unreadOnly ? 'if ($item.UnRead -eq $false) { continue }' : ''}
  $body = if ($item.Body.Length -gt 300) { $item.Body.Substring(0,300) + '...' } else { $item.Body }
  $results += [PSCustomObject]@{
    Subject = $item.Subject
    From = $item.SenderName
    Email = $item.SenderEmailAddress
    Received = $item.ReceivedTime.ToString('yyyy-MM-dd HH:mm')
    Unread = $item.UnRead
    Body = $body -replace '\\r\\n','\\n'
  }
  $count++
}
$results | ConvertTo-Json -Depth 2 2>&1`
  return runTerminal({ command: script })
}

// ── email_send ────────────────────────────────────────────────────────────────

export const emailSendDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'email_send',
    description: 'Compose an Outlook email. Draft-first by default for safety; set send_now:"true" to send immediately. Requires Outlook to be installed and configured.',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address(es), comma-separated.' },
        subject: { type: 'string', description: 'Email subject line.' },
        body: { type: 'string', description: 'Email body text.' },
        cc: { type: 'string', description: 'CC email address(es), optional.' },
        bcc: { type: 'string', description: 'BCC email address(es), optional.' },
        send_now: { type: 'string', description: 'Set to "true" to send immediately. Default is to save as draft.' },
        draft_only: { type: 'string', description: 'Legacy alias. Set to "true" to save as draft instead of sending.' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
}

export const emailSend: ToolHandler = async (args) => {
  const to = stripControlChars(args.to).trim()
  const subj = stripControlChars(args.subject).trim()
  const body = stripControlChars(args.body)
  const cc = stripControlChars(args.cc).trim()
  const bcc = stripControlChars(args.bcc).trim()
  if (!to || !subj || !body) return 'Error: to, subject, and body required'
  const sendNow = args.send_now === 'true' && args.draft_only !== 'true'

  const script = `
$ol = New-Object -ComObject Outlook.Application -ErrorAction Stop
$mail = $ol.CreateItem(0)
$mail.To = ${psString(to)}
$mail.Subject = ${psString(subj)}
$mail.Body = ${psString(body)}
${cc ? `$mail.CC = ${psString(cc)}` : ''}
${bcc ? `$mail.BCC = ${psString(bcc)}` : ''}
${sendNow ? '$mail.Send(); "Email sent successfully."' : '$mail.Save(); "Email saved as draft. Set send_now:true to send immediately."'}`
  return runTerminal({ command: script })
}

// ── email_search ──────────────────────────────────────────────────────────────

export const emailSearchDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'email_search',
    description: 'Search Outlook emails by keyword in subject or body.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search keyword or phrase.' },
        count: { type: 'string', description: 'Max results (default 10).' },
      },
      required: ['query'],
    },
  },
}

export const emailSearch: ToolHandler = async (args) => {
  const query = stripControlChars(args.query).replace(/'/g, "''").trim()
  const count = boundedInt(args.count, 10, 1, 100)
  if (!query) return 'Error: query required'

  const script = `
$ol = New-Object -ComObject Outlook.Application -ErrorAction Stop
$ns = $ol.GetNamespace('MAPI')
$inbox = $ns.GetDefaultFolder(6)
$filter = "[Subject] like '%${query}%' OR [Body] like '%${query}%'"
$found = $inbox.Items.Restrict($filter)
$results = @()
$n = 0
foreach ($item in $found) {
  if ($n -ge ${count}) { break }
  $results += [PSCustomObject]@{
    Subject = $item.Subject
    From = $item.SenderName
    Received = $item.ReceivedTime.ToString('yyyy-MM-dd HH:mm')
    Preview = if ($item.Body.Length -gt 200) { $item.Body.Substring(0,200) } else { $item.Body }
  }
  $n++
}
$results | ConvertTo-Json -Depth 2 2>&1`
  return runTerminal({ command: script })
}

// ── calendar_read ─────────────────────────────────────────────────────────────

export const calendarReadDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'calendar_read',
    description: 'Read upcoming Outlook calendar events. Returns subject, start/end time, location, and description.',
    parameters: {
      type: 'object',
      properties: {
        days: { type: 'string', description: 'How many days ahead to look (default 7).' },
        count: { type: 'string', description: 'Max events to return (default 20).' },
      },
    },
  },
}

export const calendarRead: ToolHandler = (args) => {
  const days = boundedInt(args.days, 7, 1, 365)
  const count = boundedInt(args.count, 20, 1, 200)

  const script = `
$ol = New-Object -ComObject Outlook.Application -ErrorAction Stop
$ns = $ol.GetNamespace('MAPI')
$cal = $ns.GetDefaultFolder(9)
$items = $cal.Items
$items.IncludeRecurrences = $true
$items.Sort('[Start]')
$start = [datetime]::Now.ToString('MM/dd/yyyy HH:mm')
$end = [datetime]::Now.AddDays(${days}).ToString('MM/dd/yyyy HH:mm')
$filter = "[Start] >= '$start' AND [Start] <= '$end'"
$found = $items.Restrict($filter)
$results = @()
$n = 0
foreach ($item in $found) {
  if ($n -ge ${count}) { break }
  $results += [PSCustomObject]@{
    Subject = $item.Subject
    Start = $item.Start.ToString('yyyy-MM-dd HH:mm')
    End = $item.End.ToString('yyyy-MM-dd HH:mm')
    Location = $item.Location
    AllDay = $item.AllDayEvent
  }
  $n++
}
$results | ConvertTo-Json -Depth 2 2>&1`
  return runTerminal({ command: script })
}

// ── calendar_create ───────────────────────────────────────────────────────────

export const calendarCreateDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'calendar_create',
    description: 'Create a new Outlook calendar event. Checks for schedule conflicts by default; set force:"true" to create anyway.',
    parameters: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'Event title.' },
        start: { type: 'string', description: 'Start datetime: "2026-07-01 14:00".' },
        end: { type: 'string', description: 'End datetime: "2026-07-01 15:00".' },
        location: { type: 'string', description: 'Location (optional).' },
        body: { type: 'string', description: 'Event description/notes (optional).' },
        force: { type: 'string', description: 'Set "true" to create even if overlapping events are found.' },
      },
      required: ['subject', 'start', 'end'],
    },
  },
}

export const calendarCreate: ToolHandler = async (args) => {
  const subj = stripControlChars(args.subject).trim()
  const start = stripControlChars(args.start).trim()
  const end = stripControlChars(args.end).trim()
  const loc = stripControlChars(args.location).trim()
  const body = stripControlChars(args.body)
  if (!subj || !start || !end) return 'Error: subject, start, and end required'
  const force = args.force === 'true'

  const script = `
$ol = New-Object -ComObject Outlook.Application -ErrorAction Stop
$ns = $ol.GetNamespace('MAPI')
$cal = $ns.GetDefaultFolder(9)
$items = $cal.Items
$items.IncludeRecurrences = $true
$items.Sort('[Start]')
$newStart = [datetime]${psString(start)}
$newEnd = [datetime]${psString(end)}
if ($newEnd -le $newStart) { throw 'End must be after start.' }
$rangeStart = $newStart.AddDays(-1).ToString('MM/dd/yyyy HH:mm')
$rangeEnd = $newEnd.AddDays(1).ToString('MM/dd/yyyy HH:mm')
$found = $items.Restrict("[Start] <= '$rangeEnd' AND [End] >= '$rangeStart'")
$conflicts = @()
foreach ($item in $found) {
  if ($item.Start -lt $newEnd -and $item.End -gt $newStart) {
    $conflicts += [PSCustomObject]@{ Subject = $item.Subject; Start = $item.Start.ToString('yyyy-MM-dd HH:mm'); End = $item.End.ToString('yyyy-MM-dd HH:mm') }
  }
}
if ($conflicts.Count -gt 0 -and -not ${force ? '$true' : '$false'}) {
  "Conflict(s) found. Set force:true to create anyway."; $conflicts | ConvertTo-Json -Depth 2; exit 2
}
$appt = $ol.CreateItem(1)
$appt.Subject = ${psString(subj)}
$appt.Start = $newStart
$appt.End = $newEnd
${loc ? `$appt.Location = ${psString(loc)}` : ''}
${body ? `$appt.Body = ${psString(body)}` : ''}
$appt.Save()
"Calendar event created: ${subj.replace(/"/g, '')} at ${start.replace(/"/g, '')}${force ? ' (forced despite conflicts if any)' : ''}"`
  return runTerminal({ command: script })
}
