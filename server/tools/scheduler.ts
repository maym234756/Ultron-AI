import { schedule as cronSchedule, validate as cronValidate } from 'node-cron'
import fs from 'node:fs/promises'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { ToolDefinition, ToolHandler } from './types.js'

const SCHEDULES_FILE = path.resolve(process.cwd(), '.schedules.json')
const LOG_DIR = path.resolve(process.cwd(), '.schedule-logs')
const MAX_RUN_HISTORY = 10
const RUN_HISTORY_PREVIEW = 3

export interface AgentScheduleRun {
  ts: number
  result: string
  success: boolean
}

export interface AgentSchedule {
  id: string
  name: string
  cron: string
  task: string
  model: string
  timezone?: string
  enabled: boolean
  createdAt: number
  lastRun: number | null
  lastResult: string | null
  maxRetries: number
  retryCount: number
  runHistory: AgentScheduleRun[]
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10)
  if (Number.isNaN(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function normalizeSchedule(schedule: Partial<AgentSchedule>): AgentSchedule {
  return {
    id: String(schedule.id ?? ''),
    name: String(schedule.name ?? ''),
    cron: String(schedule.cron ?? ''),
    task: String(schedule.task ?? ''),
    model: String(schedule.model ?? 'qwen2.5:14b'),
    timezone: typeof schedule.timezone === 'string' && schedule.timezone.trim() ? schedule.timezone.trim() : undefined,
    enabled: schedule.enabled !== false,
    createdAt: typeof schedule.createdAt === 'number' ? schedule.createdAt : Date.now(),
    lastRun: typeof schedule.lastRun === 'number' ? schedule.lastRun : null,
    lastResult: typeof schedule.lastResult === 'string' ? schedule.lastResult : null,
    maxRetries: clampInt(schedule.maxRetries, 0, 3, 0),
    retryCount: clampInt(schedule.retryCount, 0, 3, 0),
    runHistory: Array.isArray(schedule.runHistory)
      ? schedule.runHistory
          .filter((entry): entry is AgentScheduleRun => {
            return Boolean(
              entry &&
              typeof entry.ts === 'number' &&
              typeof entry.result === 'string' &&
              typeof entry.success === 'boolean',
            )
          })
          .slice(-MAX_RUN_HISTORY)
      : [],
  }
}

// ── persistence ───────────────────────────────────────────────────────────────

function loadSchedules(): AgentSchedule[] {
  if (!existsSync(SCHEDULES_FILE)) return []
  try {
    const raw = JSON.parse(readFileSync(SCHEDULES_FILE, 'utf-8'))
    return Array.isArray(raw) ? raw.map((schedule) => normalizeSchedule(schedule as Partial<AgentSchedule>)) : []
  } catch {
    return []
  }
}

function saveSchedules(schedules: AgentSchedule[]): void {
  writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2), 'utf-8')
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function findSchedule(schedules: AgentSchedule[], args: Record<string, unknown>): AgentSchedule | undefined {
  return schedules.find((schedule) =>
    (typeof args.id === 'string' && schedule.id === args.id) ||
    (typeof args.name === 'string' && schedule.name.toLowerCase() === args.name.toLowerCase()),
  )
}

function updateScheduleRun(scheduleId: string, result: string, retryCount: number): AgentSchedule | null {
  const schedules = loadSchedules()
  const index = schedules.findIndex((schedule) => schedule.id === scheduleId)
  if (index < 0) return null

  const success = !result.startsWith('Error:')
  const runEntry: AgentScheduleRun = { ts: Date.now(), result: result.slice(0, 500), success }
  const next = normalizeSchedule({
    ...schedules[index],
    lastRun: runEntry.ts,
    lastResult: runEntry.result,
    retryCount: clampInt(retryCount, 0, 3, 0),
    runHistory: [...schedules[index].runHistory, runEntry].slice(-MAX_RUN_HISTORY),
  })
  schedules[index] = next
  saveSchedules(schedules)
  return next
}

async function writeScheduleLog(
  schedule: AgentSchedule,
  result: string,
  trigger: 'cron' | 'manual',
  retryCount: number,
): Promise<void> {
  const logFile = path.join(LOG_DIR, `${schedule.id}-${Date.now()}.json`)
  await fs
    .writeFile(
      logFile,
      JSON.stringify(
        {
          schedule: schedule.name,
          trigger,
          timezone: schedule.timezone ?? null,
          ran: new Date().toISOString(),
          retryCount,
          success: !result.startsWith('Error:'),
          result,
        },
        null,
        2,
      ),
    )
    .catch(() => {})
}

async function executeSchedule(schedule: AgentSchedule, trigger: 'cron' | 'manual'): Promise<string> {
  if (!_runner) return 'Error: scheduler not initialized.'

  let result = 'Error: scheduler did not run.'
  let retryCount = 0

  for (let attempt = 0; attempt <= schedule.maxRetries; attempt += 1) {
    result = await _runner(schedule.task, schedule.model).catch((err: unknown) =>
      `Error: ${err instanceof Error ? err.message : String(err)}`,
    )
    retryCount = attempt
    if (!result.startsWith('Error:') || attempt >= schedule.maxRetries) break
    await delay(5_000)
  }

  updateScheduleRun(schedule.id, result, retryCount)
  await writeScheduleLog(schedule, result, trigger, retryCount)
  return result
}

function formatRunHistory(schedule: AgentSchedule): string {
  const recentRuns = schedule.runHistory.slice(-RUN_HISTORY_PREVIEW).reverse()
  if (recentRuns.length === 0) return 'none'
  return recentRuns
    .map((run) => {
      const when = new Date(run.ts).toLocaleString()
      const status = run.success ? 'ok' : 'error'
      return `${when} (${status}) ${run.result.slice(0, 80)}`
    })
    .join('\n    - ')
}

// ── scheduler init ────────────────────────────────────────────────────────────

type HeadlessRunner = (task: string, model: string) => Promise<string>
let _runner: HeadlessRunner | null = null
const _tasks = new Map<string, ReturnType<typeof cronSchedule>>()

export function startScheduler(runner: HeadlessRunner): void {
  _runner = runner
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true })
  const schedules = loadSchedules()
  for (const schedule of schedules) {
    if (schedule.enabled) _registerCron(schedule)
  }
  console.log(`[scheduler] started with ${schedules.filter((schedule) => schedule.enabled).length} active schedule(s)`)
}

function _registerCron(schedule: AgentSchedule): void {
  _tasks.get(schedule.id)?.stop()
  _tasks.delete(schedule.id)
  if (!cronValidate(schedule.cron)) return

  const task = cronSchedule(schedule.cron, async () => {
    if (!_runner) return
    console.log(`[scheduler] running: ${schedule.name}`)
    await executeSchedule(schedule, 'cron')
    console.log(`[scheduler] done: ${schedule.name}`)
  })

  _tasks.set(schedule.id, task)
}

// ── schedule_task ─────────────────────────────────────────────────────────────

export const scheduleTaskDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'schedule_task',
    description:
      'Schedule an agent task to run automatically on a cron schedule. The stored timezone is for display only; actual cron execution uses system time. Examples: "0 8 * * *" = every day at 8am, "*/30 * * * *" = every 30 min.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'A short name for this schedule, e.g. "Morning briefing".' },
        cron: { type: 'string', description: 'Cron expression: "min hour day month weekday". E.g. "0 9 * * 1-5" = weekdays at 9am.' },
        task: { type: 'string', description: 'The agent task/prompt to run, e.g. "Search for AI news today and save a summary to Desktop/morning-news.txt".' },
        model: { type: 'string', description: 'Model to use (defaults to qwen2.5:14b).' },
        timezone: { type: 'string', description: 'Optional display timezone like "America/New_York". Stored for user clarity; cron still uses system time.' },
        max_retries: { type: 'string', description: 'Optional retry count for failures, 0-3.' },
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
  const timezone = typeof args.timezone === 'string' && args.timezone.trim() ? args.timezone.trim() : undefined
  const maxRetries = clampInt(args.max_retries, 0, 3, 0)

  if (!name || !cron || !task) return 'Error: name, cron, and task are required'
  if (!cronValidate(cron)) {
    return `Error: invalid cron expression '${cron}'. Examples: '0 8 * * *' (daily 8am), '*/15 * * * *' (every 15 min), '0 9 * * 1' (Monday 9am)`
  }

  const schedule: AgentSchedule = {
    id: crypto.randomUUID(),
    name,
    cron,
    task,
    model,
    timezone,
    enabled: true,
    createdAt: Date.now(),
    lastRun: null,
    lastResult: null,
    maxRetries,
    retryCount: 0,
    runHistory: [],
  }

  const schedules = loadSchedules()
  schedules.push(schedule)
  saveSchedules(schedules)
  _registerCron(schedule)

  const timezoneLine = timezone ? `\nTimezone: ${timezone} (display only; cron uses system time)` : ''
  return `Schedule created: "${name}" (${cron})\nID: ${schedule.id}\nTask: ${task}${timezoneLine}\nMax retries: ${maxRetries}`
}

// ── list_schedules ────────────────────────────────────────────────────────────

export const listSchedulesDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'list_schedules',
    description: 'List all scheduled agent tasks, their cron expressions, timezone notes, recent run history, and status.',
    parameters: { type: 'object', properties: {} },
  },
}

export const listSchedules: ToolHandler = async (_args) => {
  const schedules = loadSchedules()
  if (schedules.length === 0) return 'No scheduled tasks. Use schedule_task to create one.'
  return schedules
    .map((schedule) => {
      const last = schedule.lastRun ? new Date(schedule.lastRun).toLocaleString() : 'never'
      const status = schedule.enabled ? 'active' : 'paused'
      const timezone = schedule.timezone ? `${schedule.timezone} (display only; cron uses system time)` : 'system time'
      return `[${status}] ${schedule.name} (${schedule.cron})\n  ID: ${schedule.id}\n  Task: ${schedule.task.slice(0, 80)}\n  Timezone: ${timezone}\n  Max retries: ${schedule.maxRetries}\n  Last run: ${last}\n  Recent runs: ${formatRunHistory(schedule)}`
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
  const target = findSchedule(schedules, args)
  if (!target) return `Schedule not found: ${args.id ?? args.name}`
  _tasks.get(target.id)?.stop()
  _tasks.delete(target.id)
  const updated = schedules.filter((schedule) => schedule.id !== target.id)
  saveSchedules(updated)
  return `Cancelled schedule: "${target.name}"`
}

// ── schedule_enable / schedule_disable ───────────────────────────────────────

export const scheduleEnableDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'schedule_enable',
    description: 'Enable an existing schedule by ID without deleting it, and restart its cron job.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Schedule ID to enable.' },
      },
      required: ['id'],
    },
  },
}

export const scheduleEnable: ToolHandler = async (args) => {
  const id = (args.id ?? '').trim()
  if (!id) return 'Error: id is required'

  const schedules = loadSchedules()
  const index = schedules.findIndex((schedule) => schedule.id === id)
  if (index < 0) return `Schedule not found: ${id}`
  if (!cronValidate(schedules[index].cron)) {
    return `Error: cannot enable schedule "${schedules[index].name}" because its cron expression is invalid`
  }

  schedules[index] = normalizeSchedule({ ...schedules[index], enabled: true })
  saveSchedules(schedules)
  _registerCron(schedules[index])
  return `Enabled schedule: "${schedules[index].name}"`
}

export const scheduleDisableDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'schedule_disable',
    description: 'Disable an existing schedule by ID without deleting it, and stop its cron job.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Schedule ID to disable.' },
      },
      required: ['id'],
    },
  },
}

export const scheduleDisable: ToolHandler = async (args) => {
  const id = (args.id ?? '').trim()
  if (!id) return 'Error: id is required'

  const schedules = loadSchedules()
  const index = schedules.findIndex((schedule) => schedule.id === id)
  if (index < 0) return `Schedule not found: ${id}`

  _tasks.get(id)?.stop()
  _tasks.delete(id)
  schedules[index] = normalizeSchedule({ ...schedules[index], enabled: false })
  saveSchedules(schedules)
  return `Disabled schedule: "${schedules[index].name}"`
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
  const target = findSchedule(schedules, args)
  if (!target) return `Schedule not found: ${args.id ?? args.name}`
  const result = await executeSchedule(target, 'manual')
  return `Ran "${target.name}":\n\n${result}`
}
