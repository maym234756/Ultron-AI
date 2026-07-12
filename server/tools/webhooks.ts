/**
 * Webhook ingest tools — register incoming webhooks that trigger agent tasks.
 * Each webhook has a unique path + optional secret. External services POST to
 * /api/webhooks/:id to fire a headless agent run.
 *
 * The webhook registry is persisted to .webhooks.json in the project root.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import type { ToolDefinition, ToolHandler } from './types.js'

const WEBHOOKS_FILE = resolve(process.cwd(), '.webhooks.json')

export interface WebhookEntry {
  id: string
  name: string
  task: string
  model: string
  secret: string
  enabled: boolean
  createdAt: number
  lastTriggeredAt: number | null
  triggerCount: number
}

// ── persistence ───────────────────────────────────────────────────────────────

export function loadWebhooks(): WebhookEntry[] {
  if (!existsSync(WEBHOOKS_FILE)) return []
  try { return JSON.parse(readFileSync(WEBHOOKS_FILE, 'utf-8')) as WebhookEntry[] } catch (err) {
    console.warn('[webhooks] failed to parse webhooks file:', err instanceof Error ? err.message : String(err))
    return []
  }
}

export function saveWebhooks(hooks: WebhookEntry[]): void {
  writeFileSync(WEBHOOKS_FILE, JSON.stringify(hooks, null, 2), 'utf-8')
}

export function findWebhook(id: string): WebhookEntry | undefined {
  return loadWebhooks().find(h => h.id === id)
}

export function recordWebhookTrigger(id: string): void {
  const hooks = loadWebhooks()
  const h = hooks.find(x => x.id === id)
  if (h) { h.lastTriggeredAt = Date.now(); h.triggerCount++ }
  saveWebhooks(hooks)
}

// ── webhook_register ──────────────────────────────────────────────────────────

export const webhookRegisterDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'webhook_register',
    description: 'Register a new incoming webhook. External services can POST to /api/webhooks/:id to trigger an agent task. Returns the webhook URL and secret.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Human-readable name for this webhook, e.g. "GitHub push trigger".' },
        task: { type: 'string', description: 'The agent task to run when the webhook fires. Can reference {{body}} for the request body or {{event}} for the event type header.' },
        model: { type: 'string', description: 'Model to use for the agent task (default: current default model).' },
      },
      required: ['name', 'task'],
    },
  },
}

export const webhookRegister: ToolHandler = async (args) => {
  const name = (args.name ?? '').trim()
  const task = (args.task ?? '').trim()
  if (!name) return 'Error: name is required'
  if (!task) return 'Error: task is required'

  const id = randomBytes(8).toString('hex')
  const secret = randomBytes(16).toString('hex')
  const entry: WebhookEntry = {
    id, name, task,
    model: (args.model ?? '').trim() || 'default',
    secret, enabled: true,
    createdAt: Date.now(),
    lastTriggeredAt: null,
    triggerCount: 0,
  }
  const hooks = loadWebhooks()
  hooks.push(entry)
  saveWebhooks(hooks)

  const port = process.env.PORT ?? '8787'
  return [
    `Webhook registered: ${name}`,
    ``,
    `ID:      ${id}`,
    `URL:     http://localhost:${port}/api/webhooks/${id}`,
    `Secret:  ${secret}`,
    `Task:    ${task}`,
    ``,
    `Usage: POST to the URL with optional header X-Webhook-Secret: ${secret}`,
    `The request body is available as {{body}} in the task template.`,
    `The event type header X-Event-Type is available as {{event}}.`,
  ].join('\n')
}

// ── webhook_list ──────────────────────────────────────────────────────────────

export const webhookListDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'webhook_list',
    description: 'List all registered webhooks with their IDs, names, tasks, and trigger counts.',
    parameters: { type: 'object', properties: {} },
  },
}

export const webhookList: ToolHandler = async () => {
  const hooks = loadWebhooks()
  if (hooks.length === 0) return 'No webhooks registered. Use webhook_register to create one.'
  const lines = [`Registered webhooks (${hooks.length}):\n`]
  for (const h of hooks) {
    lines.push(`${h.enabled ? '✓' : '✗'} ${h.name} [${h.id}]`)
    lines.push(`  Task: ${h.task.slice(0, 80)}${h.task.length > 80 ? '...' : ''}`)
    lines.push(`  Triggers: ${h.triggerCount} | Last: ${h.lastTriggeredAt ? new Date(h.lastTriggeredAt).toLocaleString() : 'never'}`)
    lines.push(`  URL: /api/webhooks/${h.id}`)
    lines.push('')
  }
  return lines.join('\n').trim()
}

// ── webhook_delete ────────────────────────────────────────────────────────────

export const webhookDeleteDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'webhook_delete',
    description: 'Delete a registered webhook by ID.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Webhook ID to delete.' },
      },
      required: ['id'],
    },
  },
}

export const webhookDelete: ToolHandler = async (args) => {
  const id = (args.id ?? '').trim()
  if (!id) return 'Error: id is required'
  const hooks = loadWebhooks()
  const idx = hooks.findIndex(h => h.id === id)
  if (idx < 0) return `Error: webhook "${id}" not found`
  const [removed] = hooks.splice(idx, 1)
  saveWebhooks(hooks)
  return `Deleted webhook: ${removed.name} [${id}]`
}

// ── webhook_toggle ────────────────────────────────────────────────────────────

export const webhookToggleDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'webhook_toggle',
    description: 'Enable or disable a webhook without deleting it.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Webhook ID.' },
        enabled: { type: 'string', description: '"true" to enable, "false" to disable.' },
      },
      required: ['id', 'enabled'],
    },
  },
}

export const webhookToggle: ToolHandler = async (args) => {
  const id = (args.id ?? '').trim()
  if (!id) return 'Error: id is required'
  const hooks = loadWebhooks()
  const h = hooks.find(x => x.id === id)
  if (!h) return `Error: webhook "${id}" not found`
  h.enabled = args.enabled !== 'false'
  saveWebhooks(hooks)
  return `Webhook "${h.name}" [${id}] is now ${h.enabled ? 'enabled' : 'disabled'}.`
}
