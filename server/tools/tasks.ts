import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ToolDefinition, ToolHandler } from './types.js'

// ── Task store ────────────────────────────────────────────────────────────────

const TASKS_PATH = join(homedir(), '.ultron-tasks.json')

interface Task {
  id: string
  title: string
  done: boolean
  priority: 'low' | 'medium' | 'high'
  due?: string          // YYYY-MM-DD
  tags: string[]
  notes?: string
  createdAt: string
  completedAt?: string
}

function load(): Task[] {
  if (!existsSync(TASKS_PATH)) return []
  try { return JSON.parse(readFileSync(TASKS_PATH, 'utf-8')) as Task[] }
  catch { return [] }
}

function save(tasks: Task[]): void {
  writeFileSync(TASKS_PATH, JSON.stringify(tasks, null, 2), 'utf-8')
}

function resolveDate(raw?: string): string | undefined {
  if (!raw) return undefined
  const today = new Date()
  if (raw === 'today') return today.toISOString().split('T')[0]
  if (raw === 'tomorrow') {
    today.setDate(today.getDate() + 1)
    return today.toISOString().split('T')[0]
  }
  if (raw === 'next week') {
    today.setDate(today.getDate() + 7)
    return today.toISOString().split('T')[0]
  }
  return raw
}

function parseTags(raw?: string): string[] {
  if (!raw) return []
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

function priorityIcon(p: string): string {
  return p === 'high' ? '🔴' : p === 'low' ? '🟢' : '🟡'
}

// ── task_add ──────────────────────────────────────────────────────────────────

export const taskAddDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'task_add',
    description: 'Add a new task or to-do item with optional due date, priority, and tags.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task title or description' },
        due: { type: 'string', description: 'Due date: YYYY-MM-DD, "today", "tomorrow", or "next week"' },
        priority: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Task priority (default: medium)' },
        tags: { type: 'string', description: 'Comma-separated tags e.g. "work,urgent,review"' },
        notes: { type: 'string', description: 'Optional extra notes for the task' },
      },
      required: ['title'],
    },
  },
}

export const taskAdd: ToolHandler = async (args) => {
  const tasks = load()
  const task: Task = {
    id: randomUUID().slice(0, 8),
    title: args.title,
    done: false,
    priority: (args.priority ?? 'medium') as Task['priority'],
    due: resolveDate(args.due),
    tags: parseTags(args.tags),
    notes: args.notes ?? undefined,
    createdAt: new Date().toISOString(),
  }
  tasks.push(task)
  save(tasks)
  const due = task.due ? `, due ${task.due}` : ''
  return `✅ Task added [${task.id}]: ${task.title} (${task.priority}${due})`
}

// ── task_list ─────────────────────────────────────────────────────────────────

export const taskListDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'task_list',
    description: 'List tasks. Filter by status, due date, tag, or priority.',
    parameters: {
      type: 'object',
      properties: {
        filter: { type: 'string', enum: ['all', 'pending', 'done', 'overdue', 'today', 'upcoming'], description: 'Which tasks to show (default: pending)' },
        tag: { type: 'string', description: 'Only show tasks with this tag' },
        priority: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Filter by priority' },
      },
      required: [],
    },
  },
}

export const taskList: ToolHandler = async (args) => {
  let tasks = load()
  const today = new Date().toISOString().split('T')[0]

  switch (args.filter ?? 'pending') {
    case 'pending':   tasks = tasks.filter(t => !t.done); break
    case 'done':      tasks = tasks.filter(t => t.done); break
    case 'overdue':   tasks = tasks.filter(t => !t.done && !!t.due && t.due < today); break
    case 'today':     tasks = tasks.filter(t => !t.done && t.due === today); break
    case 'upcoming':  tasks = tasks.filter(t => !t.done && !!t.due && t.due > today); break
    // 'all' — no filter
  }

  if (args.tag)      tasks = tasks.filter(t => t.tags.includes(args.tag))
  if (args.priority) tasks = tasks.filter(t => t.priority === args.priority)

  if (tasks.length === 0) return 'No tasks found.'

  return tasks.map(t => {
    const status = t.done ? '✓' : '○'
    const icon = priorityIcon(t.priority)
    const due = t.due ? ` due:${t.due}` : ''
    const tags = t.tags.length ? ` #${t.tags.join(' #')}` : ''
    const notes = t.notes ? `\n   📝 ${t.notes}` : ''
    return `[${t.id}] ${status} ${icon} ${t.title}${due}${tags}${notes}`
  }).join('\n')
}

// ── task_done ─────────────────────────────────────────────────────────────────

export const taskDoneDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'task_done',
    description: 'Mark a task as complete by its short ID.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The 8-character task ID shown in task_list' },
      },
      required: ['id'],
    },
  },
}

export const taskDone: ToolHandler = async (args) => {
  const tasks = load()
  const task = tasks.find(t => t.id === args.id)
  if (!task) return `Task "${args.id}" not found`
  task.done = true
  task.completedAt = new Date().toISOString()
  save(tasks)
  return `✅ Completed: ${task.title}`
}

// ── task_delete ───────────────────────────────────────────────────────────────

export const taskDeleteDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'task_delete',
    description: 'Permanently delete a task by its ID.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The 8-character task ID' },
      },
      required: ['id'],
    },
  },
}

export const taskDelete: ToolHandler = async (args) => {
  const tasks = load()
  const idx = tasks.findIndex(t => t.id === args.id)
  if (idx === -1) return `Task "${args.id}" not found`
  const [removed] = tasks.splice(idx, 1)
  save(tasks)
  return `🗑️ Deleted: ${removed.title}`
}

// ── task_update ───────────────────────────────────────────────────────────────

export const taskUpdateDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'task_update',
    description: 'Update fields on an existing task (title, due date, priority, notes, tags).',
    parameters: {
      type: 'object',
      properties: {
        id:       { type: 'string', description: 'Task ID to update' },
        title:    { type: 'string', description: 'New title' },
        due:      { type: 'string', description: 'New due date: YYYY-MM-DD, "today", "tomorrow", or "next week"' },
        priority: { type: 'string', enum: ['low', 'medium', 'high'], description: 'New priority' },
        notes:    { type: 'string', description: 'New notes (replaces old notes)' },
        tags:     { type: 'string', description: 'New comma-separated tags (replaces old tags)' },
      },
      required: ['id'],
    },
  },
}

export const taskUpdate: ToolHandler = async (args) => {
  const tasks = load()
  const task = tasks.find(t => t.id === args.id)
  if (!task) return `Task "${args.id}" not found`
  if (args.title)    task.title    = args.title
  if (args.due)      task.due      = resolveDate(args.due)
  if (args.priority) task.priority = args.priority as Task['priority']
  if (args.notes !== undefined) task.notes = args.notes
  if (args.tags)     task.tags     = parseTags(args.tags)
  save(tasks)
  return `✏️ Updated: ${task.title}`
}

// ── daily_briefing ────────────────────────────────────────────────────────────

export const dailyBriefingDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'daily_briefing',
    description: 'Generate a morning briefing with overdue tasks, tasks due today, upcoming tasks, and a summary count. Run this at the start of the day for an overview.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
}

export const dailyBriefing: ToolHandler = async (_args) => {
  const tasks = load()
  const today = new Date().toISOString().split('T')[0]
  const overdue  = tasks.filter(t => !t.done && !!t.due && t.due < today)
  const dueToday = tasks.filter(t => !t.done && t.due === today)
  const upcoming = tasks.filter(t => !t.done && !!t.due && t.due > today)
  const noDue    = tasks.filter(t => !t.done && !t.due)
  const done     = tasks.filter(t => t.done)

  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  const lines: string[] = [`📅 Daily Briefing — ${dateStr}`, '']

  if (overdue.length) {
    lines.push(`🔴 OVERDUE (${overdue.length}):`)
    overdue.forEach(t => lines.push(`  • [${t.id}] ${t.title} — was due ${t.due}`))
    lines.push('')
  }

  if (dueToday.length) {
    lines.push(`📌 DUE TODAY (${dueToday.length}):`)
    dueToday.forEach(t => lines.push(`  • [${t.id}] ${priorityIcon(t.priority)} ${t.title}`))
    lines.push('')
  }

  if (upcoming.length) {
    lines.push(`📆 UPCOMING (${upcoming.length}):`)
    upcoming.slice(0, 5).forEach(t => lines.push(`  • [${t.id}] ${t.title} — ${t.due}`))
    if (upcoming.length > 5) lines.push(`  ... and ${upcoming.length - 5} more`)
    lines.push('')
  }

  if (noDue.length) {
    lines.push(`📝 NO DUE DATE (${noDue.length}):`)
    noDue.slice(0, 5).forEach(t => lines.push(`  • [${t.id}] ${t.title}`))
    if (noDue.length > 5) lines.push(`  ... and ${noDue.length - 5} more`)
    lines.push('')
  }

  lines.push(`📊 Summary: ${done.length} done, ${tasks.filter(t => !t.done).length} pending, ${tasks.length} total`)

  if (!tasks.filter(t => !t.done).length) lines.push('🎉 All tasks complete!')

  return lines.join('\n')
}
