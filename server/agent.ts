import type express from 'express'
import { executeTool } from './tools/registry.js'
import { sendEvent, pendingAnswers } from './shared.js'

type OllamaRole = 'system' | 'user' | 'assistant'

type OllamaMessage = {
  role: OllamaRole
  content: string
  images?: string[]  // base64 image data for vision models
}

type OllamaChatChunk = {
  message?: { content?: string }
  done?: boolean
  model?: string
  prompt_eval_count?: number
  eval_count?: number
  eval_duration?: number       // nanoseconds generating tokens
  prompt_eval_duration?: number // nanoseconds evaluating prompt
}

export type AgentOptions = {
  model: string
  temperature: number
  systemContent: string
  ollamaBaseUrl: string
  maxIterations?: number
  numCtx?: number
  images?: string[]
  allowedTools?: string[]  // if set, only these tools are permitted (guardrail for restricted agents)
  intelligenceMode?: 'instant' | 'balanced' | 'deep' | 'research'
}

type ToolCallParsed = {
  name: string
  args: Record<string, string>
  preamble: string
}

type AgentTaskSize = 'simple' | 'normal' | 'deep'

type AgentTaskPlan = {
  goal: string
  assumptions: string[]
  steps: string[]
  toolsNeeded: string[]
  verificationMethod: string
  doneCondition: string
  taskSize: AgentTaskSize
  toolBudget: number
}

type LocationPermissionRequest = {
  kind: 'read' | 'write'
  locations: string[]
  actionLabel: string
  grantAliases?: string[]
}

const LOCATION_PERMISSION_TOOLS = new Set([
  'file_read', 'file_list', 'file_search', 'file_info', 'open_in_explorer',
  'file_write', 'file_move', 'file_delete', 'folder_create', 'folder_delete', 'folder_copy',
])

function locationPermissionForTool(name: string, args: Record<string, string>): LocationPermissionRequest | null {
  if (name === 'open_browser' || name === 'browser_go') {
    const url = (args.url ?? '').trim()
    return { kind: 'read', locations: [url || 'external browser'], actionLabel: 'open or navigate an external browser location', grantAliases: ['read:browser'] }
  }

  if (name.startsWith('browser_') && name !== 'browser_snapshot' && name !== 'browser_screenshot') {
    return { kind: 'read', locations: ['active browser page'], actionLabel: 'control the active browser page', grantAliases: ['read:browser'] }
  }

  if (name === 'run_terminal' || name === 'sys_run') {
    const command = (args.command ?? '').trim()
    return { kind: 'write', locations: [command ? `PowerShell: ${command.slice(0, 160)}` : 'PowerShell'], actionLabel: 'run a terminal or PowerShell command', grantAliases: ['write:terminal'] }
  }

  if (name === 'open_app') {
    const app = (args.app ?? '').trim().toLowerCase()
    const location = (args.args ?? '').trim()
    if ((app === 'explorer' || app === 'file explorer' || app === 'explorer.exe') && location) {
      return { kind: 'read', locations: [location], actionLabel: 'open this location in File Explorer', grantAliases: ['read:file explorer'] }
    }
    if (app) return { kind: 'read', locations: [args.app ?? app], actionLabel: 'open a local app', grantAliases: [`read:app:${app}`] }
    return null
  }

  if (!LOCATION_PERMISSION_TOOLS.has(name)) return null

  const readOnly = name === 'file_read' || name === 'file_list' || name === 'file_search' || name === 'file_info' || name === 'open_in_explorer'
  const locations = [args.path, args.from, args.to]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(value => value.trim())

  if (locations.length === 0) {
    if (name === 'file_list') locations.push('~/Desktop')
    if (name === 'file_search') locations.push('~/Documents')
  }

  return {
    kind: readOnly ? 'read' : 'write',
    locations,
    actionLabel: readOnly ? 'review/open this location' : 'change files or folders at this location',
  }
}

function permissionGrantKey(request: LocationPermissionRequest): string {
  return `${request.kind}:${request.locations.map(location => location.toLowerCase()).join('|')}`
}

function hasPermissionGrant(grants: Set<string>, request: LocationPermissionRequest): boolean {
  if (grants.has(permissionGrantKey(request))) return true
  return Boolean(request.grantAliases?.some(alias => grants.has(alias)))
}

function addPermissionGrant(grants: Set<string>, request: LocationPermissionRequest): void {
  grants.add(permissionGrantKey(request))
  for (const alias of request.grantAliases ?? []) grants.add(alias)
}

function isApprovalAnswer(answer: string): boolean {
  return /^(allow|approved?|yes|y|ok|okay|grant|go ahead|proceed)\b/i.test(answer.trim())
}

function explicitLocalPathsFromPrompt(prompt: string): string[] {
  const paths = new Set<string>()
  const pathPattern = /\b[A-Za-z]:[\\/][^\s"'`<>|]+|(?:^|\s)(~[\\/][^\s"'`<>|]+)/g
  let match: RegExpExecArray | null
  while ((match = pathPattern.exec(prompt)) !== null) {
    const raw = (match[1] ?? match[0]).trim()
    const clean = raw.replace(/[.,;:)\]]+$/, '')
    if (clean) paths.add(clean)
  }
  return [...paths]
}

function shouldPreflightPathPermission(prompt: string): boolean {
  return /\b(review|analy[sz]e|audit|inspect|scan|check|look through|open|list|read|search|folder|directory|project|codebase|repo|repository|file explorer)\b/i.test(prompt)
}

// Extract and remove <think>...</think> blocks emitted by reasoning models (qwen3, deepseek-r1, etc.)
function extractThinkingBlock(text: string): { thinking: string | null; rest: string } {
  const start = text.indexOf('<think>')
  const end = text.indexOf('</think>')
  if (start === -1 || end === -1 || end < start) return { thinking: null, rest: text }
  const thinking = text.slice(start + 7, end).trim()
  const rest = (text.slice(0, start) + text.slice(end + 8)).trim()
  return { thinking: thinking || null, rest }
}

// Extract ALL tool calls from a response (supports parallel calls on consecutive JSON lines)
function extractAllToolCalls(text: string): ToolCallParsed[] {
  const lines = text.split('\n')
  const calls: ToolCallParsed[] = []
  let preamble = ''
  let foundFirst = false

  for (const line of lines) {
    let l = line.trim()
    if (l.startsWith('```')) continue
    l = l.replace(/^`+|`+$/g, '').trim()

    if (!l.startsWith('{')) {
      if (!foundFirst) preamble += (preamble ? '\n' : '') + line
      continue
    }
    try {
      const parsed = JSON.parse(l) as Record<string, unknown>
      if (typeof parsed.tool === 'string' && parsed.args !== null && typeof parsed.args === 'object') {
        if (!foundFirst) { foundFirst = true; preamble = preamble.trim() }
        calls.push({
          name: parsed.tool,
          args: parsed.args as Record<string, string>,
          preamble: calls.length === 0 ? preamble : '',
        })
      }
    } catch { /* not valid JSON */ }
  }
  return calls
}

function extractToolCall(text: string): ToolCallParsed | null {
  const calls = extractAllToolCalls(text)
  return calls.length > 0 ? calls[0] : null
}

function latestUserPrompt(messages: Array<{ role: 'user' | 'assistant'; content: string }>): string {
  return messages.findLast(message => message.role === 'user')?.content.trim() ?? ''
}

function classifyTaskSize(prompt: string, mode: NonNullable<AgentOptions['intelligenceMode']>, maxIterations: number): { taskSize: AgentTaskSize; toolBudget: number } {
  const text = prompt.toLowerCase()
  const deepCue = /\b(deep|thorough|research|audit|debug|fix|build|implement|refactor|multiple|entire|complete|full|production|diagnose|investigate)\b/.test(text)
  const simpleCue = /\b(open|show|focus|copy|read|screenshot|what'?s on my screen|launch)\b/.test(text) && text.length < 180
  if (mode === 'deep' || mode === 'research' || deepCue) {
    return { taskSize: 'deep', toolBudget: Math.max(10, maxIterations) }
  }
  if (mode === 'instant' || simpleCue) {
    return { taskSize: 'simple', toolBudget: 1 }
  }
  return { taskSize: 'normal', toolBudget: Math.min(6, Math.max(3, Math.ceil(maxIterations / 2))) }
}

function inferToolsNeeded(prompt: string): string[] {
  const text = prompt.toLowerCase()
  const tools = new Set<string>()
  if (/\b(browser|website|web|gmail|salesforce|youtube|sheets|click|login|tab|page)\b/.test(text)) tools.add('browser tools')
  if (/\b(file|folder|directory|read|write|edit|code|repo|workspace|find|grep|search files?|filename|where is)\b/.test(text)) tools.add('fast file/code search tools')
  if (/\b(run|build|test|lint|terminal|command|install|execute|cmd|command prompt|powershell|shell)\b/.test(text)) tools.add('terminal tools')
  if (/\b(search|research|latest|current|source|cite|look up)\b/.test(text)) tools.add('search/RAG tools')
  if (/\b(screen|screenshot|desktop|window|app)\b/.test(text)) tools.add('desktop/screen tools')
  return tools.size > 0 ? [...tools] : ['no tool required unless verification is needed']
}

function buildTaskPlan(prompt: string, mode: NonNullable<AgentOptions['intelligenceMode']>, maxIterations: number): AgentTaskPlan {
  const { taskSize, toolBudget } = classifyTaskSize(prompt, mode, maxIterations)
  const toolsNeeded = inferToolsNeeded(prompt)
  const needsExternalState = toolsNeeded.some(tool => tool !== 'no tool required unless verification is needed')
  return {
    goal: prompt.slice(0, 220) || 'Complete the requested agent task.',
    assumptions: [
      needsExternalState ? 'External state must be checked with tools before claiming completion.' : 'The task may be answerable without tools.',
      'Sensitive or irreversible actions require user approval before execution.',
    ],
    steps: taskSize === 'simple'
      ? ['Choose the single correct action.', 'Run one tool if needed.', 'Report the result and stop.']
      : ['Clarify the goal and constraints.', 'Use the smallest useful set of tools.', 'Recover from failures with a different approach.', 'Verify the outcome.', 'Report what changed, what was verified, and what remains.'],
    toolsNeeded,
    verificationMethod: needsExternalState ? 'Inspect tool results and run a confirming read/test when available.' : 'Check the answer against the user request before finalizing.',
    doneCondition: needsExternalState ? 'The requested action is completed or a clear blocker/fallback is reported.' : 'The user has a direct, complete answer with any caveats stated.',
    taskSize,
    toolBudget,
  }
}

const AGENT_SYSTEM_BASE = `You are Lumivex AI, a powerful local AI assistant with full tool access on a Windows machine.

── HOW TO REASON (apply every turn) ─────────────────────────────────────────
Before acting, think through these steps:
1. UNDERSTAND — What is the actual intent? Distinguish surface words from real need.
2. DECOMPOSE — Break complex requests into sub-problems. What facts are missing?
3. PLAN — Which tool(s) are needed, in what order? What result confirms success?
4. ACT — Execute one tool at a time. Never assume a result before seeing it.
5. VERIFY — Did the result match the plan? If not, reason about why and adapt.

── CRITICAL THINKING RULES ──────────────────────────────────────────────────
• Challenge assumptions. If the user says "my file is at X", verify it exists before acting on it.
• Consider edge cases. "Delete all temp files" — confirm scope before acting.
• Distinguish facts from inferences. State clearly: "I know..." vs "I believe..." vs "I'm guessing...".
• Calibrate confidence:
    High (>90%) → state directly.  Medium (70-90%) → "I believe..."
    Low (<70%)  → "I'm not certain — let me check" then use a tool.
    Speculation  → "I'm guessing here — want me to look this up?"
• Show reasoning chains for complex answers: Because X → therefore Y → conclusion Z.
• Self-check before final answer: Is this accurate? Complete? The simplest/best approach?
• Never confabulate. Unknown version, path, or spec? Say so and look it up with a tool.
• Sound like a capable teammate, not a template. For build/create/start requests, ask the next missing decision or use tools; do not give generic lectures.

── TASK PLANNER CONTRACT ────────────────────────────────────────────────────
For agent tasks, follow the task plan and current tool budget from the runtime.
State transitions are: Planning → Using tools → Verifying → Done, or Needs user input when blocked.
If a tool fails:
• Browser selector fails → try text locator, accessible label, or page read before retrying.
• Browser target is unclear → call browser_find_targets with the visible label/query and choose the best selector before clicking or typing.
• Command fails → parse the error, repair the likely cause, then rerun the narrowest check.
• File missing → search nearby paths before giving up.
• Tool unavailable → explain the fallback and use the next best tool.
Final answer contract: What changed, what was verified, what remains, and next best action.

── TOOL CALL FORMAT ──────────────────────────────────────────────────────────
To call a tool, output ONLY a JSON object on a single line — no code blocks, no other text on that line:
{"tool":"<name>","args":{...}}

── CRITICAL RULES ────────────────────────────────────────────────────────────
1. SIMPLE REQUESTS = ONE TOOL THEN STOP. If the user asks to open/show/switch/close/read/copy something, call the ONE correct tool and respond. Do NOT keep going or add extra steps.
   Examples:
   • "show me my Gmail tab"  → focus_tab {title:"Gmail"} → done, respond
   • "open notepad"          → open_app {app:"notepad"} → done, respond
   • "what's on my screen?"  → screen_read {} → done, respond
   • "copy this to clipboard"→ clipboard_write {} → done, respond

   ⚠️  CRITICAL: You CANNOT open/create/delete/move/send/run anything by just saying you did it.
   You MUST call the tool. If you have not called the tool, NOTHING has happened.
   Wrong:  "I've opened Gmail for you."  ← this does NOTHING — you must call the tool
   Right:  {"tool":"open_browser","args":{"url":"https://mail.google.com"}}  ← this actually opens it

2. FOLDER/FILE CREATION: Use the dedicated tools — not open_app or run_terminal.
   • "create a folder called X in Downloads" → folder_create {path:"~/Downloads/X", open:"true"}
   • "make a folder on the Desktop"          → folder_create {path:"~/Desktop/FolderName", open:"true"}
   • "create a file at …"                    → file_write {path:"~/…/file.txt", content:""}
   • "open Explorer"                         → open_in_explorer {path:"~/Desktop"} or open_app {app:"explorer"}
   NEVER use open_app {app:"explorer"} to create folders — it only opens Explorer, it does NOT create anything.

3. focus_tab vs open_browser:
   • focus_tab   = switch to an ALREADY OPEN tab in the user's real browser (Chrome/Edge/etc.)
   • open_browser = open a NEW URL (only when no existing tab should be used)
   Never use open_browser if the user just wants to SEE or SWITCH TO an existing tab.

  EXISTING SURFACE RULE: If the user has already opened an external surface (File Explorer,
  PowerShell/CMD/Terminal, Salesforce, Gmail, GitHub, browser page, etc.) and then asks for
  the next step inside it, reuse that existing surface. For browsers, use list_tabs/focus_tab
  for visible switching, or browser_connect_chrome then browser_use_tab before browser_click,
  browser_fill, browser_type, or browser_go. For local apps, use desktop_find_window or
  open_app with reuse enabled. Only open a new tab/window when no matching existing surface
  can be found or the user explicitly asks for a new one.

4. Only call extra tools when the task genuinely requires more information. Do not "explore" after a task is done.

5. REFLECTION ON FAILURE: If a tool returns an Error, reason about WHY it failed and try a DIFFERENT approach — different selector, different method, or ask_user for clarification. Never retry identically.

6. SOURCE CITATIONS: When your answer comes from a retrieved document or web search, always cite the source inline: e.g. "According to [filename.pdf]..." or "Per the web search result from example.com..."

7. PROACTIVE MEMORY: When you learn something important about the user (preference, project detail, recurring task, key fact), call mem_save proactively without being asked. Tag it appropriately.

8. PLANNING FOR COMPLEX TASKS: Before multi-step tasks (>2 tools), briefly state your plan:
   "Plan: 1) read_file to check structure → 2) write_file to update → 3) run_terminal to test"
   This prevents wasted steps and makes errors easier to diagnose.

9. SMARTER ANSWERS: For knowledge questions, go beyond the obvious. Consider:
   • What is the user's underlying goal? Answer that, not just the literal question.
   • Are there better alternatives they may not know about?
   • What tradeoffs should they be aware of?
   • What is the most important thing they need to know first?

10. RESPONSE LENGTH & FORMAT — calibrate to the request:
    • Quick factual question → one-sentence or one-paragraph answer. No padding.
    • Complex or technical question → use headers, bullets, code blocks as needed.
    • Conversational message → plain prose, no markdown.
    • Code → always in fenced code blocks with the correct language tag.
    • NEVER start with filler: "Certainly!", "Of course!", "Great question!", "Sure!", "Absolutely!"
    • NEVER explain what you're about to do — just do it.
    • NEVER add hollow closers: "I hope this helps!", "Let me know if you need anything else!", "In conclusion…"
    • Be direct. A 3-sentence answer that nails the question beats a 3-paragraph answer that buries it.

11. PARALLEL TOOL CALLS: When multiple independent pieces of information are needed simultaneously,
    output them on consecutive lines with NO text between them:
    {"tool":"search_web","args":{"query":"..."}}
    {"tool":"read_file","args":{"path":"..."}}
    This executes both tools in parallel and saves significant time. Only use for genuinely independent operations.

── SYSTEM TOOLS ──────────────────────────────────────────────────────────────
run_terminal      – {command, shell?, cwd?}    – run PowerShell by default; use shell:"cmd" for Command Prompt commands
open_app          – {app, args?}               – open cmd, powershell, notepad, vscode, calc, paint, explorer, chrome, edge…
take_screenshot   – {filename?}               – capture screen to Desktop PNG
clipboard_read/write – {text?}               – read/write clipboard
speak             – {text, rate?}             – Windows TTS
notify            – {title, message}          – Windows balloon notification

── FILE TOOLS ────────────────────────────────────────────────────────────────
write_file        – {path, content}            – create/overwrite file
read_file         – {path}                     – read file (16k)
read_pdf          – {path}                     – extract text from PDF
list_directory    – {path}                     – list folder
memory_write/read – {key, value?}             – persistent notes

── WEB & HTTP ────────────────────────────────────────────────────────────────
open_browser      – {url}                      – open URL in default browser
fetch_webpage     – {url}                      – download page text
list_tabs         – {browser?}                 – list ALL open browser tabs (Chrome/Edge/Firefox/Brave)
focus_tab         – {title}                    – click a tab in the real browser and bring it to front
search_web        – {query}                    – DuckDuckGo
http_request      – {url, method?, headers?, body?, auth?, timeout?} – raw HTTP with auth

── GIT ───────────────────────────────────────────────────────────────────────
git_status/diff/log/commit/push/checkout/branch/clone – full git workflow

── DATABASE ──────────────────────────────────────────────────────────────────
db_query          – {file, sql}               – SELECT from SQLite (JSON rows)
db_execute        – {file, sql}               – INSERT/UPDATE/DELETE/CREATE TABLE

── PLAYWRIGHT BROWSER AUTOMATION ─────────────────────────────────────────────
WORKFLOW: For tasks on the user's real accounts (Gmail, banking, etc.) always use
browser_connect_chrome FIRST so you have their sessions/cookies. For generic web
automation, browser_go opens a fresh Chromium.

EDIT WORKFLOW: Before editing any page, always: (1) browser_read to review content,
(2) ask_user to confirm what to change, (3) then edit. Never submit/send without confirming.

browser_connect_chrome – {browser?}             – connect to real Chrome/Edge (with all logins!)
browser_go        – {url, wait_for?}            – navigate (fresh Chromium)
browser_click     – {selector?, text?}          – click element
browser_type      – {text, selector?, delay_ms?}– type like a human (rich editors, Gmail)
browser_fill      – {value, selector?, label?}  – fill plain input
browser_key       – {key}                       – keyboard shortcut: Enter, Control+a, Tab…
browser_hover     – {selector?, text?}          – hover to reveal menus/tooltips
browser_scroll    – {direction?, amount?, selector?} – scroll page or to element
browser_check     – {selector, checked?}        – check/uncheck checkbox
browser_select    – {selector, value?, label?}  – dropdown select
browser_read      – {section?}                  – read page: text, fields, links
browser_find_targets – {query?, kind?, limit?}  – find actionable controls/selectors for complex pages
browser_get_text  – {selector, all?}            – get element text
browser_get_attr  – {selector, attr}            – get HTML attribute (href, value…)
browser_find_text – {text}                      – find text on page + context
browser_extract_table – {selector?}            – extract table as structured data
browser_screenshot– {filename?}                – screenshot page
browser_eval      – {code}                      – run JavaScript in page
browser_wait      – {selector, timeout?, state?}– wait for element
browser_upload    – {selector, file}            – upload file to input
browser_dialog    – {action?, prompt_text?}     – handle alert/confirm/prompt
browser_pdf       – {filename?}                 – save page as PDF
── Gmail / Web Email ──────────────────────────────────────────────────────────
browser_read_emails   – {count?, unread_only?}  – read Gmail inbox (after browser_connect_chrome)
browser_click_email   – {index}                 – open email by position (1=newest)
browser_compose_reply – {body, send?}           – reply to open email
── Tabs ───────────────────────────────────────────────────────────────────────
browser_new_tab   – {url?}                      – new tab
browser_tabs      – {}                          – list tabs
browser_switch_tab– {index}                     – switch tab
browser_use_tab   – {query}                     – reuse existing automation tab by title or URL
browser_close_tab – {index?}                    – close tab
browser_close     – {}                          – close browser

── CODING ────────────────────────────────────────────────────────────────────
run_code          – {file, args?, cwd?}        – run .py .ts .js .ps1 .sh .go .rb
lint_code         – {path, type?, fix?}        – tsc/eslint/pylint
open_in_editor    – {path, line?, column?}     – open in VS Code
code_search       – {pattern, directory?, include?, mode?, regex?, max_results?} – fast rg-style code/filename search
diff_files        – {file1, file2}            – unified diff
patch_file        – {file, patch}             – apply patch

── VISION & MEDIA ────────────────────────────────────────────────────────────
screen_read/analyze_image/generate_image/create_slideshow/record_screen/convert_video

── INTERACTION ───────────────────────────────────────────────────────────────
ask_user          – {question, context?}       – ask the human and wait for answer

── LOCAL KNOWLEDGE BASE (RAG) ────────────────────────────────────────────────
rag_index         – {path, force?, recursive?} – index file/dir for semantic search
rag_index_url     – {url, force?}              – fetch & index a web page into knowledge base
rag_search        – {query, top_k?, file_filter?} – search knowledge base
rag_status        – {}                          – show what's indexed
rag_clear         – {file?}                    – remove from index

── SCHEDULING ────────────────────────────────────────────────────────────────
schedule_task     – {name, cron, task, model?} – run agent task on cron schedule
list_schedules    – {}                          – view all scheduled tasks
cancel_schedule   – {id?, name?}               – delete schedule
run_schedule_now  – {id?, name?}               – trigger immediately

── EMAIL & CALENDAR ──────────────────────────────────────────────────────────
!! IMPORTANT: Never assume Outlook is installed. Email workflow:
   1. Call detect_email_provider first (takes screenshot, identifies client).
   2. Web email (gmail/outlook_web/yahoo) → use compose_email (opens browser compose).
   3. Only use email_send/email_read if detect_email_provider returns "outlook_desktop".

compose_email     – {to, subject, body, provider?} – open compose in ANY web email client
detect_email_provider – {}                      – screenshot → identify email system
email_send        – {to, subject, body, cc?, draft_only?} – Outlook desktop only
email_read        – {folder?, count?, unread_only?} – read inbox (Outlook desktop only)
email_search      – {query, count?}            – search emails (Outlook desktop only)
calendar_read     – {days?, count?}            – upcoming events
calendar_create   – {subject, start, end, location?, body?} – create event

── PYTHON REPL ───────────────────────────────────────────────────────────────
python_exec       – {code, timeout?}           – persistent Python with state
python_reset      – {}                          – clear Python state

── AUDIO TRANSCRIPTION ───────────────────────────────────────────────────────
transcribe_audio  – {file, model?, language?}  – Whisper transcription
install_whisper   – {}                          – install whisper package

── LONG-TERM SEMANTIC MEMORY ─────────────────────────────────────────────────
These memories persist across ALL sessions. Use proactively to remember user prefs,
project context, important facts. Recalled by MEANING (embedding similarity).

mem_save          – {content, tags?}           – save to permanent memory
mem_recall        – {query, top_k?, tag?}      – find relevant memories semantically
mem_list          – {tag?, limit?}             – list all memories
mem_forget        – {id}                       – delete a memory

── SYSTEM MONITOR ────────────────────────────────────────────────────────────
sys_stats         – {}                          – CPU, RAM, disk, uptime
sys_processes     – {sort_by?, filter?, top?}  – list running processes
sys_kill          – {name?, pid?}              – kill a process
sys_run           – {command}                  – run any PowerShell command
sys_env           – {name?, value?}            – get/set environment variables

── USER FILES (HOME DIRECTORY) ───────────────────────────────────────────────
Access files outside the workspace (Desktop, Documents, Downloads, etc.)
Use ~ for home directory: ~/Desktop/file.txt

file_read         – {path, start_line?, end_line?} – read any file on system
file_write        – {path, content, append?}   – write/create file anywhere in home
file_list         – {path?, recursive?}        – list directory (default: Desktop)
file_move         – {from, to}                 – move or rename
file_delete       – {path}                     – delete (confirm with user first!)
file_search       – {query, path?, extension?, mode?, regex?, max_results?} – fast content or filename search across user files
file_info         – {path}                     – get size, dates, type
folder_create     – {path, open?}             – create folder anywhere (~/Downloads/MyFolder, C:/Projects/App); set open:"true" to show it in Explorer immediately
folder_delete     – {path}                    – delete folder recursively (confirm first!)
folder_copy       – {from, to}               – copy folder and all contents
open_in_explorer  – {path}                   – open folder in Explorer; if path is a file, Explorer opens with it selected

── GITHUB ────────────────────────────────────────────────────────────────────
gh_set_token      – {token}                    – save GitHub PAT (one-time setup)
gh_repos          – {sort?, limit?}            – list your repos
gh_issues         – {repo, state?, limit?}     – list issues (owner/repo)
gh_prs            – {repo, state?, limit?}     – list pull requests
gh_create_issue   – {repo, title, body?, labels?} – create issue
gh_repo_info      – {repo}                     – detailed repo stats
gh_search         – {query, type?, limit?}     – search repos/issues/code

── DESKTOP AUTOMATION ────────────────────────────────────────────────────────
Control ANY Windows app using screen coordinates. Always take_screenshot first
to see coordinates before clicking.

desktop_click         – {x, y, button?, double?}    – click at screen position
desktop_type          – {text}                       – type into focused window
desktop_send_keys     – {keys}                       – ^c=Ctrl+C, ^v=paste, %{F4}=Alt+F4
desktop_find_window   – {title}                      – focus window by title
desktop_list_windows  – {filter?}                    – list all open windows
desktop_get_cursor_pos– {}                           – get current cursor position
desktop_scroll        – {x, y, direction?, amount?}  – scroll at coordinates

── MULTI-AGENT ───────────────────────────────────────────────────────────────
Spawn independent sub-agents with full tool access for parallel or complex tasks.

agent_run         – {prompt, model?, system?, max_steps?} – run sub-agent, get result
agent_parallel    – {tasks, model?}            – run multiple sub-agents in parallel

── WEB SCRAPING ──────────────────────────────────────────────────────────────
web_scrape        – {url, fields, all?, wait_for?, output_file?}        – extract structured data via CSS selectors
web_scrape_pages  – {url, fields, next_selector, row_selector?, max_pages?, output_file?} – follow pagination
web_scrape_list   – {urls, fields, output_file?, format?}              – bulk scrape → JSON/CSV
web_monitor       – {url, selector, interval_mins?, name?, notify_on?} – set up change alert
web_check_monitor – {id}                                                – manually check monitor now
web_list_monitors – {}                                                  – list all monitors

── PLAYWRIGHT ADVANCED ───────────────────────────────────────────────────────
browser_vault_save    – {site, username, password, notes?} – save encrypted credentials
browser_vault_list    – {}                                 – list saved sites (usernames only)
browser_login         – {site, url?, username_selector?, password_selector?} – auto-login from vault
browser_stealth       – {user_agent?}                      – enable anti-bot-detection mode
browser_watch         – {selector, interval_sec?, duration_sec?, id?}  – watch element for changes
browser_record_start  – {}                                 – record user interactions as tool calls
browser_record_stop   – {save_to?}                        – stop recording, get script
browser_network_capture – {action?, filter?}              – capture XHR/API responses (start/stop/get)

── PREVIEW (show work before saving) ─────────────────────────────────────────
preview_write     – {path, content, description?} – queue a file change for user review; shows diff in UI before writing
preview_exec      – {command, description?}        – queue a shell command for user approval before running

── TASKS & DAILY PLANNING ────────────────────────────────────────────────────
task_add          – {title, due?, priority?, tags?, notes?} – add a task (due: "today"/"tomorrow"/"next week"/YYYY-MM-DD)
task_list         – {filter?, tag?, priority?}              – list tasks (filter: pending/done/overdue/today/upcoming/all)
task_done         – {id}                                    – mark task complete
task_delete       – {id}                                    – delete task
task_update       – {id, title?, due?, priority?, notes?, tags?} – update task fields
daily_briefing    – {}                                      – morning summary: overdue, today, upcoming tasks

── CODING INTELLIGENCE ───────────────────────────────────────────────────────
code_todos        – {directory?, include?, tags?} – find all TODO/FIXME/HACK/BUG comments in codebase
code_stats        – {directory?, exclude?}        – count lines and files by extension

After each tool call you receive the result. Call as many tools as needed. When done, respond in Markdown.`

const INTELLIGENCE_AGENT_INSTRUCTIONS: Record<NonNullable<AgentOptions['intelligenceMode']>, string> = {
  instant: `INTELLIGENCE PROFILE: Instant. Minimum steps, maximum directness.
  Call the ONE correct tool and respond. Do not explore beyond the immediate task. Keep answers compact.
  If no tool is needed, answer in the shortest useful form and stop.`,

  balanced: `INTELLIGENCE PROFILE: Balanced. Use the plan-act-verify loop proportionate to the task.
  Prefer fewer, better tool calls over many redundant ones.
  Before using a tool, ask: will this materially improve correctness or complete an action? If not, answer directly.`,

  deep: `INTELLIGENCE PROFILE: Deep. Work methodically and verify before concluding.
  Before acting, reason explicitly:
    1. What am I actually being asked to do? (beneath the surface request)
    2. What tools are needed in what order? What result confirms success vs failure?
    3. What assumptions am I making that I should verify with a tool?
  After each tool call: did the result match expectations? If not, diagnose why before proceeding.
  For multi-file or multi-step tasks: always read before writing. Verify edits with lint_code.
  Final answer: include outcome, verification performed, concrete tradeoffs, and the single most important caveat.`,

  research: `INTELLIGENCE PROFILE: Research. Evidence-based analysis before synthesis.
  • Gather evidence from multiple sources (files, search, memory) before concluding.
  • Distinguish confirmed facts from inferences — label each clearly.
  • Cite sources inline: "According to [filename.ts line 42]..." or "Per search result from ..."
  • After gathering evidence, state your confidence level explicitly.
  • Flag when retrieved information may be outdated, partial, or ambiguous.
  • If fresh/current facts are requested, use search/web tools before final synthesis.
  • Final answer: lead with the main finding, then supporting evidence, then caveats and next validation step.`,
}

// Per-mode inference options — mirrors buildInferenceOptions in index.ts
function agentInferenceOptions(
  temperature: number,
  numCtx: number,
  mode: NonNullable<AgentOptions['intelligenceMode']> = 'balanced',
): Record<string, number | undefined> {
  const base = { temperature, num_ctx: numCtx, top_p: 0.92, repeat_penalty: 1.12 }
  switch (mode) {
    case 'instant': return { ...base, temperature: Math.min(temperature, 0.22), top_p: 0.82, repeat_penalty: 1.08, num_predict: 768 }
    case 'balanced': return { ...base, top_p: 0.92, repeat_penalty: 1.12, num_predict: 1536 }
    case 'deep':     return { ...base, top_p: 0.95, repeat_penalty: 1.15, num_predict: 3072, mirostat: 2, mirostat_tau: 5.0, mirostat_eta: 0.10 }
    case 'research': return { ...base, temperature: Math.min(temperature, 0.35), top_p: 0.96, repeat_penalty: 1.18, num_predict: 3072, mirostat: 2, mirostat_tau: 4.0, mirostat_eta: 0.08 }
  }
}

export async function runAgent(
  userMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
  options: AgentOptions,
  response: express.Response,
  abortSignal: AbortSignal,
): Promise<void> {
  const { model, temperature, systemContent, ollamaBaseUrl, maxIterations = 12, numCtx = 8192, images, intelligenceMode = 'balanced' } = options
  const userPrompt = latestUserPrompt(userMessages)
  const taskPlan = buildTaskPlan(userPrompt, intelligenceMode, maxIterations)
  let toolsUsed = 0
  const approvedLocationGrants = new Set<string>()

  async function askUser(question: string, context: string, kind: 'question' | 'permission' = 'question'): Promise<string> {
    const qid = `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    sendEvent(response, 'agent_task_state', { status: 'needs_user_input', detail: question })
    sendEvent(response, 'question', { id: qid, question, context, kind })
    return new Promise<string>((resolve) => {
      const timeout = setTimeout(() => {
        pendingAnswers.delete(qid)
        resolve('[User did not answer within 5 minutes — continuing with best judgement]')
      }, 300_000)
      pendingAnswers.set(qid, (answer) => { clearTimeout(timeout); resolve(answer) })
    })
  }

  const profileInstructions = INTELLIGENCE_AGENT_INSTRUCTIONS[intelligenceMode]
  const systemFull = systemContent.trim()
    ? `${AGENT_SYSTEM_BASE}\n\n${profileInstructions}\n\nAdditional instructions:\n${systemContent}`
    : `${AGENT_SYSTEM_BASE}\n\n${profileInstructions}`

  // Build history — attach images to the last user message (vision support)
  const ollamaMessages: OllamaMessage[] = userMessages.map((m) => ({ role: m.role as OllamaRole, content: m.content }))
  if (images?.length) {
    const lastUserIdx = ollamaMessages.findLastIndex(m => m.role === 'user')
    if (lastUserIdx >= 0) ollamaMessages[lastUserIdx] = { ...ollamaMessages[lastUserIdx], images }
  }

  const history: OllamaMessage[] = [
    { role: 'system', content: `${systemFull}\n\nRuntime task plan:\n${JSON.stringify(taskPlan, null, 2)}` },
    ...ollamaMessages,
  ]

  sendEvent(response, 'agent_plan', { plan: taskPlan })
  sendEvent(response, 'agent_task_state', { status: 'planning', detail: `Planned ${taskPlan.taskSize} task with ${taskPlan.toolBudget} tool budget.` })

  const preflightLocations = shouldPreflightPathPermission(userPrompt) ? explicitLocalPathsFromPrompt(userPrompt) : []
  if (preflightLocations.length > 0) {
    const permission: LocationPermissionRequest = { kind: 'read', locations: preflightLocations, actionLabel: 'review/open this location' }
    const answer = await askUser(
      'Allow Lumivex AI to review this location?',
      `Location: ${preflightLocations.join('\nLocation: ')}\nLumivex AI will start with a safe directory listing, then continue the review using approved filesystem tools.`,
      'permission',
    )
    if (!isApprovalAnswer(answer)) {
      const denied = `Permission denied for: ${preflightLocations.join(', ')}. I did not access that location.`
      sendEvent(response, 'set_content', { content: denied })
      sendEvent(response, 'agent_task_state', { status: 'done', detail: 'Permission denied by user.' })
      sendEvent(response, 'metrics', { model, iterations: 0 })
      return
    }

    addPermissionGrant(approvedLocationGrants, permission)
    const callId = crypto.randomUUID()
    const firstLocation = preflightLocations[0]
    sendEvent(response, 'agent_task_state', { status: 'using_tools', detail: `Permission approved. Listing ${firstLocation} before model review.` })
    sendEvent(response, 'tool_call', { id: callId, name: 'file_list', args: { path: firstLocation, recursive: 'false' } })
    let preflightResult = await executeTool('file_list', { path: firstLocation, recursive: 'false' })
    if (preflightResult.length > 4000) preflightResult = `${preflightResult.slice(0, 4000)}\n\n[...${(preflightResult.length - 4000).toLocaleString()} chars truncated]`
    sendEvent(response, 'tool_result', { id: callId, name: 'file_list', result: preflightResult })
    toolsUsed += 1
    history.push({ role: 'user', content: `User approved read access for: ${preflightLocations.join(', ')}. Initial directory listing for ${firstLocation}:\n${preflightResult}\n\nContinue the review using concise tool calls. Start by inspecting the most relevant project metadata and source directories; do not ask for permission again for the approved location during this run.` })
  }

  for (let step = 1; step <= maxIterations; step++) {
    if (abortSignal.aborted) return

    sendEvent(response, 'agent_step', { step, maxSteps: maxIterations })

    // Per-step timeout: 3 minutes per Ollama call
    const stepAbort = new AbortController()
    const stepTimer = setTimeout(() => stepAbort.abort(), 180_000)
    abortSignal.addEventListener('abort', () => stepAbort.abort(), { once: true })

    console.log(`[agent] step ${step}: calling Ollama, abortSignal.aborted=${abortSignal.aborted}`)

    // Keep-alive pings every 5s while waiting for Ollama — prevents proxies/sockets from closing
    const keepAlive = setInterval(() => {
      if (!response.writableEnded) response.write(': \n\n')
    }, 5_000)

    let ollamaRes: Response
    let fetchAttempts = 0
    while (true) {
      try {
        ollamaRes = await fetch(`${ollamaBaseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: history,
            stream: true,
            keep_alive: '60m',
            options: agentInferenceOptions(temperature, numCtx, intelligenceMode),
          }),
          signal: stepAbort.signal,
        })
        break // success
      } catch (fetchErr) {
        fetchAttempts++
        // Auto-retry once on transient network errors (not on timeout/abort)
        if (fetchAttempts === 1 && !abortSignal.aborted && !stepAbort.signal.aborted) {
          console.log(`[agent] step ${step}: fetch failed, retrying in 2s…`)
          await new Promise(r => setTimeout(r, 2000))
          continue
        }
        clearTimeout(stepTimer)
        clearInterval(keepAlive)
        if (!abortSignal.aborted) {
          const isTimeout = stepAbort.signal.aborted && !abortSignal.aborted
          sendEvent(response, 'error', {
            error: isTimeout
              ? 'Model took too long to respond (>3 min). Try a shorter prompt.'
              : fetchErr instanceof Error ? fetchErr.message : 'Could not reach Ollama',
          })
        }
        return
      }
    }

    if (!ollamaRes.ok) {
      clearTimeout(stepTimer)
      clearInterval(keepAlive)
      const body = await ollamaRes.text().catch(() => '')
      sendEvent(response, 'error', { error: body || `Ollama returned HTTP ${ollamaRes.status}` })
      return
    }

    // Parse NDJSON stream from Ollama — batch tokens before emitting to reduce SSE overhead
    const reader = ollamaRes.body!.getReader()
    const decoder = new TextDecoder()
    let streamBuf = ''
    let fullContent = ''
    let tokenBatch = ''
    let finalData: OllamaChatChunk | null = null

    function flushTokenBatch() {
      if (tokenBatch && !response.writableEnded) {
        sendEvent(response, 'token', { token: tokenBatch })
        tokenBatch = ''
      }
    }

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) { flushTokenBatch(); break }
        streamBuf += decoder.decode(value, { stream: true })
        const lines = streamBuf.split('\n')
        streamBuf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          let chunk: OllamaChatChunk
          try { chunk = JSON.parse(line) as OllamaChatChunk } catch { continue }
          if (chunk.message?.content) {
            const token = chunk.message.content
            fullContent += token
            tokenBatch += token
            // Flush on natural boundaries to keep streaming feel smooth
            if (tokenBatch.length >= 10 || tokenBatch.includes('\n') || tokenBatch.endsWith('. ') || tokenBatch.endsWith('! ') || tokenBatch.endsWith('? ')) {
              flushTokenBatch()
            }
          }
          if (chunk.done) { flushTokenBatch(); finalData = chunk }
        }
      }
    } catch (streamErr) {
      clearTimeout(stepTimer)
      clearInterval(keepAlive)
      if (!abortSignal.aborted) {
        sendEvent(response, 'error', { error: streamErr instanceof Error ? streamErr.message : 'Stream error' })
      }
      return
    }

    clearTimeout(stepTimer)
    clearInterval(keepAlive)

    if (!fullContent && !finalData) {
      sendEvent(response, 'error', { error: 'Model returned no response.' })
      return
    }

    // Strip <think> blocks from reasoning models; emit them as trace events.
    // Also correct what the client displayed (it streamed the raw think tags).
    const { thinking: thinkContent, rest: responseContent } = extractThinkingBlock(fullContent)
    if (thinkContent) {
      sendEvent(response, 'thinking', { content: thinkContent })
      // Replace client-displayed content with the cleaned version
      sendEvent(response, 'set_content', { content: responseContent })
    }

    // Check for tool call(s) — supports parallel calls (multiple JSON lines)
    const allToolCalls = extractAllToolCalls(responseContent)
    const toolCall = allToolCalls[0] ?? null

    if (allToolCalls.length > 0) {
      if (toolsUsed >= taskPlan.toolBudget) {
        sendEvent(response, 'agent_task_state', { status: 'verifying', detail: `Tool budget reached (${toolsUsed}/${taskPlan.toolBudget}); finalizing from gathered evidence.` })
        history.push({ role: 'assistant', content: responseContent })
        history.push({ role: 'user', content: 'The tool budget for this task has been reached. Do not call more tools. Finalize now using the final answer contract: what changed, what was verified, what remains, and the next best action.' })
        sendEvent(response, 'set_content', { content: '' })
        continue
      }

      const preamble = toolCall.preamble
      if (preamble) {
        sendEvent(response, 'thinking', { content: preamble })
      }
      // Replace the streamed JSON with just the human-readable preamble
      sendEvent(response, 'set_content', { content: preamble || '' })

      history.push({ role: 'assistant', content: responseContent })

      if (abortSignal.aborted) return
      sendEvent(response, 'agent_task_state', { status: 'using_tools', detail: `Using ${allToolCalls.length} tool call(s); ${Math.max(0, taskPlan.toolBudget - toolsUsed)} remaining before this step.` })

      // Execute all tool calls — single call sequential, multiple calls in parallel
      const MAX_RESULT = 4000

      async function runOneTool(tc: ToolCallParsed): Promise<{ tc: ToolCallParsed; result: string; callId: string }> {
        const callId = crypto.randomUUID()
        sendEvent(response, 'tool_call', { id: callId, name: tc.name, args: tc.args })

        let result: string
        if (tc.name === 'ask_user') {
          const question = tc.args.question ?? 'I have a question for you:'
          const context = tc.args.context ?? ''
          result = await askUser(question, context)
        } else {
          const permission = locationPermissionForTool(tc.name, tc.args)
          if (permission) {
            if (!hasPermissionGrant(approvedLocationGrants, permission)) {
              const answer = await askUser(
                `Allow Lumivex AI to ${permission.actionLabel}?`,
                `Tool: ${tc.name}\nLocation: ${permission.locations.join('\nLocation: ')}\nOnly approve locations you recognize. Deny blocks this tool call.`,
                'permission',
              )
              if (!isApprovalAnswer(answer)) {
                return { tc, callId, result: `Permission denied by user for ${tc.name}: ${permission.locations.join(', ')}` }
              }
              addPermissionGrant(approvedLocationGrants, permission)
            }
          }
          const skip = tc.name.startsWith('browser_screenshot') || tc.name === 'take_screenshot'
          result = await executeTool(tc.name, tc.args)
          if (!skip && result.length > MAX_RESULT) {
            result = result.slice(0, MAX_RESULT) +
              `\n\n[...${(result.length - MAX_RESULT).toLocaleString()} chars truncated]`
          }
        }
        return { tc, result, callId }
      }

      // Run parallel if multiple calls, sequential if one
      const executed = await Promise.all(allToolCalls.map(runOneTool))

      // Emit results and build history
      const resultSummaryParts: string[] = []
      for (const { tc, result, callId } of executed) {
        sendEvent(response, 'tool_result', { id: callId, name: tc.name, result })
        resultSummaryParts.push(`Tool result (${tc.name}):\n${result}`)
      }
      toolsUsed += executed.length
      sendEvent(response, 'agent_task_state', { status: 'verifying', detail: `Checked ${toolsUsed}/${taskPlan.toolBudget} budgeted tool result(s).` })
      history.push({ role: 'user', content: resultSummaryParts.join('\n\n') })

      // Auto-complete single-action tools
      const SELF_COMPLETING = new Set([
        'focus_tab', 'open_browser', 'open_app', 'speak', 'notify',
        'clipboard_write', 'take_screenshot', 'compose_email',
        'browser_connect_chrome', 'browser_pdf', 'browser_upload',
        'browser_compose_reply', 'browser_dialog',
      ])
      if (allToolCalls.length === 1 && SELF_COMPLETING.has(toolCall.name) && !executed[0].result.startsWith('Error')) {
        const summary = preamble ? `${preamble}\n\n${executed[0].result}` : executed[0].result
        sendEvent(response, 'set_content', { content: summary })
        sendEvent(response, 'agent_task_state', { status: 'done', detail: 'Single-action task completed.' })
        sendEvent(response, 'metrics', { model, iterations: step })
        return
      }

      continue
    }

    // ── Hallucination guard ──────────────────────────────────────────────────
    // If the model claims to have done something ("I opened", "Done!", etc.) but
    // produced NO tool call, re-prompt it once so it actually calls the tool.
    const CLAIM_PATTERN = /\b(i('ve| have) (opened|launched|created|started|deleted|copied|moved|run|executed|sent|written|saved|fetched|searched|navigated)|done[!.]|completed[!.]|finished[!.])\b/i
    if (allToolCalls.length === 0 && step === 1 && CLAIM_PATTERN.test(responseContent)) {
      history.push({ role: 'assistant', content: responseContent })
      // Clear the hallucinated content from client display
      sendEvent(response, 'set_content', { content: '' })
      history.push({
        role: 'user',
        content: 'You described an action but did not call any tool — so nothing actually happened. You MUST emit the JSON tool call to perform the action. Please call the correct tool now using the format: {"tool":"<name>","args":{...}}',
      })
      continue
    }

    // No tool call — content was already streamed token-by-token in real-time.
    // Just emit the metrics event (no need to re-stream tokens).
    const tokensPerSec = (finalData?.eval_count && finalData?.eval_duration)
      ? Math.round(finalData.eval_count / (finalData.eval_duration / 1e9))
      : undefined
    sendEvent(response, 'metrics', {
      model: finalData?.model ?? model,
      iterations: step,
      promptTokens: finalData?.prompt_eval_count,
      responseTokens: finalData?.eval_count,
      tokensPerSec,
    })
    sendEvent(response, 'agent_task_state', { status: 'done', detail: 'Final answer produced.' })

    return
  }

  sendEvent(response, 'agent_task_state', { status: 'verifying', detail: `Reached ${maxIterations} iterations; reporting blocker.` })
  sendEvent(response, 'error', {
    error: `Agent reached the ${maxIterations}-step limit without completing.`,
  })
}

// ── runAgentHeadless ──────────────────────────────────────────────────────────
// Used by the scheduler for background tasks — no SSE, returns final text.

export async function runAgentHeadless(
  prompt: string,
  options: AgentOptions,
): Promise<string> {
  const { model, temperature, systemContent, ollamaBaseUrl, maxIterations = 12, numCtx = 8192, allowedTools, intelligenceMode = 'balanced' } = options

  const profileInstructions = INTELLIGENCE_AGENT_INSTRUCTIONS[intelligenceMode]
  const systemFull = systemContent?.trim()
    ? `${AGENT_SYSTEM_BASE}\n\n${profileInstructions}\n\nAdditional instructions:\n${systemContent}`
    : `${AGENT_SYSTEM_BASE}\n\n${profileInstructions}`

  const history: OllamaMessage[] = [
    { role: 'system', content: systemFull },
    { role: 'user', content: prompt },
  ]

  for (let step = 1; step <= maxIterations; step++) {
    const res = await fetch(`${ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: history,
        stream: false,
        options: { temperature, num_ctx: numCtx },
      }),
      signal: AbortSignal.timeout(180_000),
    })

    if (!res.ok) throw new Error(`Ollama returned HTTP ${res.status}`)

    const data = await res.json() as { message?: { content?: string } }
    const content = data.message?.content ?? ''
    const toolCall = extractToolCall(content)

    if (!toolCall) return content

    history.push({ role: 'assistant', content })

    let result: string
    if (toolCall.name === 'ask_user') {
      result = '[Headless mode: no user available — continuing with best judgement]'
    } else if (allowedTools && allowedTools.length > 0 && !allowedTools.includes(toolCall.name)) {
      // Guardrail: block tools not in the allowlist
      result = `[GUARDRAIL] Tool "${toolCall.name}" is not permitted in this context. Only allowed: ${allowedTools.join(', ')}`
    } else {
      result = await executeTool(toolCall.name, toolCall.args).catch(
        (e: unknown) => `Tool error: ${e instanceof Error ? e.message : String(e)}`,
      )
    }

    history.push({ role: 'user', content: `Tool result (${toolCall.name}):\n${result}` })
  }

  return `Agent reached the ${maxIterations}-step limit.`
}

