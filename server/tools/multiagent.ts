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
      },
      required: ['prompt'],
    },
  },
}

export const agentRun: ToolHandler = async (args) => {
  if (!args.prompt) return 'Error: prompt required'
  if (!_runner) return 'Error: multi-agent not initialized'
  try {
    const result = await _runner(args.prompt, {
      model: args.model ?? _defaults.model,
      temperature: 0.3,
      systemContent: args.system,
      ollamaBaseUrl: _defaults.ollamaBaseUrl,
      maxIterations: parseInt(args.max_steps ?? '10', 10) || 10,
    })
    return `Sub-agent result:\n${result}`
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
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
      },
      required: ['tasks'],
    },
  },
}

export const agentParallel: ToolHandler = async (args) => {
  if (!args.tasks) return 'Error: tasks required'
  if (!_runner) return 'Error: multi-agent not initialized'
  let tasks: string[]
  try { tasks = JSON.parse(args.tasks) as string[] } catch { return 'Error: tasks must be a valid JSON array of strings' }
  if (!Array.isArray(tasks) || !tasks.length) return 'Error: tasks must be a non-empty array'
  try {
    const results = await Promise.all(
      tasks.map(async (task, i) => {
        const result = await _runner!(task, {
          model: args.model ?? _defaults.model,
          temperature: 0.3,
          ollamaBaseUrl: _defaults.ollamaBaseUrl,
          maxIterations: 10,
        })
        return `=== Sub-agent ${i + 1}: "${task.slice(0, 60)}" ===\n${result}`
      })
    )
    return results.join('\n\n')
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}
