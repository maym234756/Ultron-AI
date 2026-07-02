/**
 * Plugin system — auto-discovers and loads .ts/.js files from plugins/
 * Each plugin exports: { definitions: ToolDefinition[], handlers: Record<string, ToolHandler> }
 */
import { readdir, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import type { ToolDefinition, ToolHandler } from '../tools/types.js'

export type Plugin = {
  definitions: ToolDefinition[]
  handlers: Record<string, ToolHandler>
}

const PLUGINS_DIR = resolve(process.cwd(), 'plugins')

const EXAMPLE_PLUGIN = `/**
 * Example Ultron plugin — drop this file in the plugins/ folder and restart.
 * Must export: definitions (ToolDefinition[]) and handlers (Record<string, ToolHandler>)
 */
import type { ToolDefinition, ToolHandler } from '../server/tools/types.js'

export const definitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'hello_plugin',
      description: 'Example plugin tool — says hello.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name to greet.' },
        },
      },
    },
  },
]

export const handlers: Record<string, ToolHandler> = {
  hello_plugin: async (args) => {
    return \`Hello from plugin, \${args.name ?? 'world'}!\`
  },
}
`

export async function loadPlugins(): Promise<Plugin[]> {
  // Ensure plugins dir exists with an example
  if (!existsSync(PLUGINS_DIR)) {
    await mkdir(PLUGINS_DIR, { recursive: true })
    await writeFile(join(PLUGINS_DIR, '_example.ts.disabled'), EXAMPLE_PLUGIN, 'utf-8')
    console.log('[plugins] created plugins/ directory with example')
    return []
  }

  const files = (await readdir(PLUGINS_DIR)).filter(
    f => (f.endsWith('.ts') || f.endsWith('.js')) && !f.startsWith('_') && !f.startsWith('.')
  )

  const loaded: Plugin[] = []
  for (const file of files) {
    const filePath = join(PLUGINS_DIR, file)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod = await import(filePath) as any
      if (
        mod &&
        Array.isArray(mod.definitions) &&
        typeof mod.handlers === 'object' &&
        mod.handlers !== null
      ) {
        loaded.push({ definitions: mod.definitions as ToolDefinition[], handlers: mod.handlers as Record<string, ToolHandler> })
        const names = Object.keys(mod.handlers as object).join(', ')
        console.log(`[plugins] loaded: ${file} → tools: ${names}`)
      } else {
        console.warn(`[plugins] ${file} must export 'definitions' (array) and 'handlers' (object)`)
      }
    } catch (err) {
      console.error(`[plugins] failed to load ${file}:`, err instanceof Error ? err.message : String(err))
    }
  }

  return loaded
}
