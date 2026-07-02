import { schedule as cronSchedule, validate as cronValidate } from 'node-cron'
import fs from 'node:fs/promises'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { ToolDefinition, ToolHandler } from './types.js'

const SCHEDULES_FILE = path.resolve(process.cwd(), '.schedules.json')
const LOG_DIR = path.resolve(process.cwd(), '.schedule-logs')

export interface AgentSchedule {
  id: string
  name: string
  cron: string
  task: string
  model: string
  enabled: boolean
  createdAt: number
  lastRun: number | null
  lastResult: string | null
}

// ── persistence ───────────────────────────────────────────────────────────────

function loadSchedules(): AgentSchedule[] {
  if (!existsSync(SCHEDULES_FILE)) return []
  try { return JSON.parse(readFileSync(SCHEDULES_FILE, 'utf-8')) as AgentSchedule[] } catch { return [] }
}

function saveSchedules(schedules: AgentSchedule[]): void {
  writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2), 'utf-8')
}

// ── scheduler init ────────────────────────────────────────────────────────────

type HeadlessRunner = (task: string, model: string) => Promise<string>
let _runner: HeadlessRunner | null = null
const _tasks = new Map<string, ReturnType<typeof cronSchedule>>()

export function startScheduler(runner: HeadlessRunner): void {
  _runner = runner
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true })
  const schedules = loadSchedules()
  for (const s of schedules) {
    if (s.enabled) _registerCron(s)
  }
  console.log(`[scheduler] started with ${schedules.filter((s) => s.enabled).length} active schedule(s)`)
}

function _registerCron(s: AgentSchedule): void {
  if (_tasks.has(s.id)) _tasks.get(s.id)?.stop()
  if (!cronValidate(s.cron)) return
  const task = cronSchedule(s.cron, async () => {
    if (!_runner) return
    console.log(`[scheduler] running: ${s.name}`)
    const result = await _runner(s.task, s.model).catch((err: unknown) =>
      `Error: ${err instanceof Error ? err.message : String(err)}`,
    )
    // Update lastRun
    const schedules = loadSchedules()
    const idx = schedules.findIndex((x) => x.id === s.id)
    if (idx >= 0) { schedules[idx].lastRun = Date.now(); schedules[idx].lastResult = result.slice(0, 500) }
    saveSchedules(schedules)
    // Save full log
    const logFile = path.join(LOG_DIR, `${s.id}-${Date.now()}.json`)
    await fs.writeFile(logFile, JSON.stringify({ schedule: s.name, ran: new Date().toISOString(), result }, null, 2)).catch(() => {})
    console.log(`[scheduler] done: ${s.name}`)
  })
  _tasks.set(s.id, task)
}

// ── schedule_task ─────────────────────────────────────────────────────────────

export const scheduleTaskDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'schedule_task',
    description:
      'Schedule an agent task to run automatically on a cron schedule. The agent will run the task in the background without user interaction. Examples: "0 8 * * *" = every day at 8am, "*/30 * * * *" = every 30 min.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'A short name for this schedule, e.g. "Morning briefing".' },
        cron: { type: 'string', description: 'Cron expression: "min hour day month weekday". E.g. "0 9 * * 1-5" = weekdays at 9am.' },
        task: { type: 'string', description: 'The agent task/prompt to run, e.g. "Search for AI news today and save a summary to Desktop/morning-news.txt".' },
        model: { type: 'string', description: 'Model to use (defaults to qwen2.5:14b).' },
      },
      required: ['name', 'cron', 'task'],
    },
  },
}

export const scheduleTask: ToolHandler = async (args) => {
  const name = (args.name ?? '').trim()
  const cron = (args.cron ?? '').trim()
  const task = (args.task ?? '').trim()
  const model = (args.model ?? 'qwen2.5:14b').trim()

  if (!name || !cron || !task) return 'Error: name, cron, and task are required'
  if (!cronValidate(cron)) return `Error: invalid cron expression "${cron}". Example: "0 9 * * *" = every day at 9am`

  const schedule: AgentSchedule = {
    id: crypto.randomUUID(),
    name,
    cron,
    task,
    model,
    enabled: true,
    createdAt: Date.now(),
    lastRun: null,
    lastResult: null,
  }

  const schedules = loadSchedules()
  schedules.push(schedule)
  saveSchedules(schedules)
  _registerCron(schedule)

  return `Schedule created: "${name}" (${cron})\nID: ${schedule.id}\nTask: ${task}`
}

// ── list_schedules ────────────────────────────────────────────────────────────

export const listSchedulesDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'list_schedules',
    description: 'List all scheduled agent tasks, their cron expressions, last run time, and status.',
    parameters: { type: 'object', properties: {} },
  },
}

export const listSchedules: ToolHandler = async (_args) => {
  const schedules = loadSchedules()
  if (schedules.length === 0) return 'No scheduled tasks. Use schedule_task to create one.'
  return schedules
    .map((s) => {
      const last = s.lastRun ? new Date(s.lastRun).toLocaleString() : 'never'
      const status = s.enabled ? 'active' : 'paused'
      return `[${status}] ${s.name} (${s.cron})\n  ID: ${s.id}\n  Task: ${s.task.slice(0, 80)}\n  Last run: ${last}`
    })
    .join('\n\n')
}

// ── cancel_schedule ───────────────────────────────────────────────────────────

export const cancelScheduleDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'cancel_schedule',
    description: 'Cancel and delete a scheduled task by its ID or name.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Schedule ID (from list_schedules).' },
        name: { type: 'string', description: 'Schedule name (alternative to id).' },
      },
    },
  },
}

export const cancelSchedule: ToolHandler = async (args) => {
  const schedules = loadSchedules()
  const target = schedules.find((s) =>
    (args.id && s.id === args.id) || (args.name && s.name.toLowerCase() === args.name.toLowerCase()),
  )
  if (!target) return `Schedule not found: ${args.id ?? args.name}`
  _tasks.get(target.id)?.stop()
  _tasks.delete(target.id)
  const updated = schedules.filter((s) => s.id !== target.id)
  saveSchedules(updated)
  return `Cancelled schedule: "${target.name}"`
}

// ── run_schedule_now ──────────────────────────────────────────────────────────

export const runScheduleNowDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'run_schedule_now',
    description: 'Immediately trigger a scheduled task by ID or name, without waiting for its next cron time.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Schedule ID.' },
        name: { type: 'string', description: 'Schedule name.' },
      },
    },
  },
}

export const runScheduleNow: ToolHandler = async (args) => {
  if (!_runner) return 'Scheduler not initialized.'
  const schedules = loadSchedules()
  const target = schedules.find((s) =>
    (args.id && s.id === args.id) || (args.name && s.name.toLowerCase() === args.name.toLowerCase()),
  )
  if (!target) return `Schedule not found: ${args.id ?? args.name}`
  const result = await _runner(target.task, target.model).catch((err: unknown) =>
    `Error: ${err instanceof Error ? err.message : String(err)}`,
  )
  const idx = schedules.findIndex((s) => s.id === target.id)
  if (idx >= 0) { schedules[idx].lastRun = Date.now(); schedules[idx].lastResult = result.slice(0, 500) }
  saveSchedules(schedules)
  return `Ran "${target.name}":\n\n${result}`
}
