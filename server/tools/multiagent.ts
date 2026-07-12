/**
 * Multi-agent: spawn sub-agents that run the full ReAct loop independently.
 * Initialized at startup via initMultiAgent() to avoid circular imports.
 */
import type { ToolDefinition, ToolHandler } from './types.js'

type HeadlessRunner = (
  prompt: string,
  options: {
    model: string
    temperature?: number
    systemContent?: string
    ollamaBaseUrl: string
    maxIterations?: number
  }
) => Promise<string>

let _runner: HeadlessRunner | null = null
let _defaults = { model: 'qwen2.5:14b', ollamaBaseUrl: 'http://127.0.0.1:11434' }

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10)
  if (Number.isNaN(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function buildSystemContent(system: unknown, allowedTools: unknown): string | undefined {
  const toolList = String(allowedTools ?? '')
    .split(',')
    .map((tool) => tool.trim())
    .filter(Boolean)
  const parts = [
    toolList.length ? `Only use these tools: ${toolList.join(', ')}` : '',
    typeof system === 'string' ? system.trim() : '',
  ].filter(Boolean)
  return parts.length ? parts.join('\n\n') : undefined
}

async function runWithTimeout(
  prompt: string,
  options: Parameters<HeadlessRunner>[1],
  timeoutSec: number,
): Promise<string> {
  if (!_runner) return 'Error: multi-agent not initialized'

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null
  const runnerPromise = _runner(prompt, options)
    .catch((err: unknown) => `Error: ${err instanceof Error ? err.message : String(err)}`)
    .finally(() => {
      if (timeoutHandle) clearTimeout(timeoutHandle)
    })
  const timeoutPromise = new Promise<string>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(`Error: sub-agent timed out after ${timeoutSec}s`), timeoutSec * 1000)
  })

  return Promise.race([runnerPromise, timeoutPromise])
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (true) {
      const currentIndex = nextIndex
      nextIndex += 1
      if (currentIndex >= items.length) return
      results[currentIndex] = await mapper(items[currentIndex], currentIndex)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

export function initMultiAgent(
  runner: HeadlessRunner,
  defaults: { model: string; ollamaBaseUrl: string }
): void {
  _runner = runner
  _defaults = defaults
}

// ── agent_run ─────────────────────────────────────────────────────────────────

export const agentRunDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'agent_run',
    description: 'Spawn an independent sub-agent with its own ReAct reasoning loop to complete a task. Returns the final answer. Use for complex subtasks that need multiple tool calls.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The task for the sub-agent.' },
        model: { type: 'string', description: 'Override model (default: same as current).' },
        system: { type: 'string', description: 'Optional system prompt override.' },
        max_steps: { type: 'string', description: 'Max iterations (default 10).' },
        timeout_sec: { type: 'string', description: 'Timeout per sub-agent in seconds (default 120, max 600).' },
        allowed_tools: { type: 'string', description: 'Optional comma-separated list of allowed tool names for the sub-agent.' },
      },
      required: ['prompt'],
    },
  },
}

export const agentRun: ToolHandler = async (args) => {
  if (!args.prompt) return 'Error: prompt required'
  if (!_runner) return 'Error: multi-agent not initialized'

  const timeoutSec = clampInt(args.timeout_sec, 1, 600, 120)
  const maxIterations = parseInt(args.max_steps ?? '10', 10) || 10
  const result = await runWithTimeout(
    args.prompt,
    {
      model: args.model ?? _defaults.model,
      temperature: 0.3,
      systemContent: buildSystemContent(args.system, args.allowed_tools),
      ollamaBaseUrl: _defaults.ollamaBaseUrl,
      maxIterations,
    },
    timeoutSec,
  )

  return result.startsWith('Error:') ? result : `Sub-agent result:\n${result}`
}

// ── agent_parallel ────────────────────────────────────────────────────────────

export const agentParallelDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'agent_parallel',
    description: 'Run multiple sub-agents in parallel on different tasks, then return all results combined. Use for independent research tasks, gathering info from multiple sources simultaneously.',
    parameters: {
      type: 'object',
      properties: {
        tasks: { type: 'string', description: 'JSON array of task strings, e.g. ["research X", "research Y"].' },
        model: { type: 'string', description: 'Model for all sub-agents.' },
        max_parallel: { type: 'string', description: 'Maximum number of concurrent sub-agents (default 4, max 10).' },
      },
      required: ['tasks'],
    },
  },
}

export const agentParallel: ToolHandler = async (args) => {
  if (!args.tasks) return 'Error: tasks required'
  if (!_runner) return 'Error: multi-agent not initialized'

  let tasks: string[]
  try {
    tasks = JSON.parse(args.tasks) as string[]
  } catch {
    return 'Error: tasks must be a valid JSON array of strings'
  }
  if (!Array.isArray(tasks) || !tasks.length || tasks.some((task) => typeof task !== 'string')) {
    return 'Error: tasks must be a non-empty array of strings'
  }

  const maxParallel = clampInt(args.max_parallel, 1, 10, 4)
  const results = await mapWithConcurrency(tasks, maxParallel, async (task, index) => {
    const result = await runWithTimeout(
      task,
      {
        model: args.model ?? _defaults.model,
        temperature: 0.3,
        ollamaBaseUrl: _defaults.ollamaBaseUrl,
        maxIterations: 10,
      },
      120,
    )
    return {
      task,
      success: !result.startsWith('Error:'),
      formatted: `=== Sub-agent ${index + 1}: "${task.slice(0, 60)}" ===\n${result}`,
    }
  })

  const succeeded = results.filter((result) => result.success).length
  const failedTasks = results.filter((result) => !result.success).map((result) => result.task)
  const summary = failedTasks.length
    ? `${succeeded}/${results.length} tasks succeeded. Failures: [${failedTasks.join(', ')}]`
    : `${succeeded}/${results.length} tasks succeeded.`

  return `${summary}\n\n${results.map((result) => result.formatted).join('\n\n')}`
}

// ── agent_status ──────────────────────────────────────────────────────────────

export const agentStatusDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'agent_status',
    description: 'Return multi-agent system diagnostics, including whether the runner is initialized and current defaults.',
    parameters: { type: 'object', properties: {} },
  },
}

export const agentStatus: ToolHandler = async () => {
  return [
    'Multi-agent status:',
    `Runner initialized: ${_runner ? 'yes' : 'no'}`,
    `Default model: ${_defaults.model}`,
    `Base URL: ${_defaults.ollamaBaseUrl}`,
  ].join('\n')
}
