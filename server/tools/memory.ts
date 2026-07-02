import fs from 'node:fs/promises'
import path from 'node:path'
import type { ToolDefinition, ToolHandler } from './types.js'

const MEMORY_FILE = path.resolve(process.cwd(), 'workspace', '.agent-memory.json')

async function loadMemory(): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(MEMORY_FILE, 'utf-8')
    return JSON.parse(raw) as Record<string, string>
  } catch {
    return {}
  }
}

async function saveMemory(data: Record<string, string>): Promise<void> {
  await fs.mkdir(path.dirname(MEMORY_FILE), { recursive: true })
  await fs.writeFile(MEMORY_FILE, JSON.stringify(data, null, 2), 'utf-8')
}

export const memoryWriteDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'memory_write',
    description:
      'Persist a named piece of information that survives across conversation turns. Use this to remember important facts, user preferences, task state, file paths, or decisions so you can recall them in future messages.',
    parameters: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'Short descriptive key, e.g. "user_goal", "project_root", "last_error"',
        },
        value: {
          type: 'string',
          description: 'The value to store. Can be plain text, JSON, or a code snippet.',
        },
      },
      required: ['key', 'value'],
    },
  },
}

export const memoryWrite: ToolHandler = async (args) => {
  if (!args.key) return 'Error: key is required'
  try {
    const mem = await loadMemory()
    mem[args.key] = args.value ?? ''
    await saveMemory(mem)
    return `Memory saved: "${args.key}"`
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`
  }
}

export const memoryReadDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'memory_read',
    description:
      'Read previously stored memories. Provide a key to read a specific entry, or omit key to list all stored memories.',
    parameters: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'Optional. The key to read. If omitted, all stored memories are returned.',
        },
      },
    },
  },
}

export const memoryRead: ToolHandler = async (args) => {
  try {
    const mem = await loadMemory()
    if (args.key) {
      return args.key in mem ? mem[args.key] : `No memory found for key: "${args.key}"`
    }
    const entries = Object.entries(mem)
    if (entries.length === 0) return '(No memories stored yet)'
    return entries.map(([k, v]) => `${k}: ${v}`).join('\n')
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`
  }
}
