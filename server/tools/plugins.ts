/**
 * Plugin management tools — list, inspect, and create Ultron plugins.
 * Plugins live in the top-level plugins/ directory.
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ToolDefinition, ToolHandler } from './types.js'

const PLUGINS_DIR = resolve(process.cwd(), 'plugins')

// ── plugin_list ───────────────────────────────────────────────────────────────

export const pluginListDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'plugin_list',
    description: 'List all plugins in the plugins/ directory. Shows enabled plugins (loaded at startup) and disabled ones. Each plugin exports tool definitions and handlers.',
    parameters: { type: 'object', properties: {} },
  },
}

export const pluginList: ToolHandler = async () => {
  try {
    if (!existsSync(PLUGINS_DIR)) {
      return 'No plugins/ directory found. It will be created automatically on next startup.'
    }
    const files = await readdir(PLUGINS_DIR)
    if (files.length === 0) return 'plugins/ directory is empty. Add .ts or .js plugin files to enable them.'

    const enabled = files.filter(f => (f.endsWith('.ts') || f.endsWith('.js')) && !f.startsWith('_') && !f.startsWith('.'))
    const disabled = files.filter(f => f.endsWith('.disabled'))
    const other = files.filter(f => !enabled.includes(f) && !disabled.includes(f))

    const lines: string[] = [`Plugin directory: ${PLUGINS_DIR}`, '']
    if (enabled.length) {
      lines.push(`Enabled (${enabled.length}):`)
      for (const f of enabled) lines.push(`  ✓ ${f}`)
    }
    if (disabled.length) {
      lines.push(`Disabled (${disabled.length}):`)
      for (const f of disabled) lines.push(`  ✗ ${f}`)
    }
    if (other.length) {
      lines.push(`Other files (${other.length}):`)
      for (const f of other) lines.push(`  · ${f}`)
    }
    lines.push('')
    lines.push('To enable: rename file to remove .disabled suffix and restart server.')
    lines.push('To disable: rename file to add .disabled suffix and restart server.')
    return lines.join('\n')
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`
  }
}

// ── plugin_enable ─────────────────────────────────────────────────────────────

export const pluginEnableDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'plugin_enable',
    description: 'Enable a disabled plugin by renaming it to remove the .disabled suffix. Restart the server to load it.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Plugin filename (with or without .disabled suffix), e.g. "my-plugin.ts.disabled" or "my-plugin.ts".' },
      },
      required: ['name'],
    },
  },
}

export const pluginEnable: ToolHandler = async (args) => {
  const name = (args.name ?? '').trim()
  if (!name) return 'Error: name is required'
  try {
    const files = existsSync(PLUGINS_DIR) ? await readdir(PLUGINS_DIR) : []
    // Find the .disabled version
    const disabledName = name.endsWith('.disabled') ? name : `${name}.disabled`
    if (!files.includes(disabledName)) {
      const enabled = name.endsWith('.disabled') ? name.slice(0, -9) : name
      if (files.includes(enabled)) return `Plugin "${enabled}" is already enabled.`
      return `Error: plugin "${disabledName}" not found. Available: ${files.join(', ')}`
    }
    const { rename } = await import('node:fs/promises')
    const enabledName = disabledName.slice(0, -9) // remove .disabled
    await rename(join(PLUGINS_DIR, disabledName), join(PLUGINS_DIR, enabledName))
    return `Enabled: ${enabledName}. Restart the server to load this plugin.`
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`
  }
}

// ── plugin_disable ────────────────────────────────────────────────────────────

export const pluginDisableDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'plugin_disable',
    description: 'Disable a plugin by renaming it to add the .disabled suffix. Restart the server to take effect.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Plugin filename (without .disabled), e.g. "my-plugin.ts".' },
      },
      required: ['name'],
    },
  },
}

export const pluginDisable: ToolHandler = async (args) => {
  const name = (args.name ?? '').trim()
  if (!name) return 'Error: name is required'
  try {
    const files = existsSync(PLUGINS_DIR) ? await readdir(PLUGINS_DIR) : []
    const cleanName = name.endsWith('.disabled') ? name.slice(0, -9) : name
    if (!files.includes(cleanName)) {
      return `Error: plugin "${cleanName}" not found. Available: ${files.join(', ')}`
    }
    const { rename } = await import('node:fs/promises')
    await rename(join(PLUGINS_DIR, cleanName), join(PLUGINS_DIR, cleanName + '.disabled'))
    return `Disabled: ${cleanName}. Restart the server to take effect.`
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`
  }
}

// ── plugin_create ─────────────────────────────────────────────────────────────

export const pluginCreateDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'plugin_create',
    description: 'Create a new plugin file from a template in the plugins/ directory. The plugin will be enabled after server restart.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Plugin filename without extension, e.g. "my-custom-tools". Creates plugins/my-custom-tools.ts.' },
        tool_name: { type: 'string', description: 'Name for the first tool in the plugin, e.g. "my_tool". Defaults to the plugin name with underscores.' },
        description: { type: 'string', description: 'Description for the plugin tool.' },
      },
      required: ['name'],
    },
  },
}

export const pluginCreate: ToolHandler = async (args) => {
  const pluginName = (args.name ?? '').trim().replace(/[^a-z0-9_-]/gi, '-')
  if (!pluginName) return 'Error: name is required'
  const toolName = (args.tool_name ?? pluginName.replace(/-/g, '_')).trim()
  const toolDesc = (args.description ?? `Custom tool from ${pluginName} plugin.`).trim()

  try {
    if (!existsSync(PLUGINS_DIR)) {
      await mkdir(PLUGINS_DIR, { recursive: true })
    }
    const filePath = join(PLUGINS_DIR, `${pluginName}.ts`)
    if (existsSync(filePath)) {
      return `Error: plugins/${pluginName}.ts already exists. Use plugin_list to see existing plugins.`
    }

    const template = `/**
 * Ultron plugin: ${pluginName}
 * Generated automatically — customize and restart server to activate.
 */
import type { ToolDefinition, ToolHandler } from '../server/tools/types.js'

export const definitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: '${toolName}',
      description: '${toolDesc}',
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Input for the tool.' },
        },
        required: ['input'],
      },
    },
  },
]

export const handlers: Record<string, ToolHandler> = {
  ${toolName}: async (args) => {
    const input = args.input ?? ''
    // TODO: implement ${toolName} logic
    return \`${toolName} received: \${input}\`
  },
}
`
    await writeFile(filePath, template, 'utf-8')
    return `Created: plugins/${pluginName}.ts\n\nEdit the file to implement your tool logic, then restart the server to activate it.\nFile: ${filePath}`
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`
  }
}

// ── plugin_read ───────────────────────────────────────────────────────────────

export const pluginReadDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'plugin_read',
    description: 'Read the source code of a plugin file.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Plugin filename, e.g. "my-plugin.ts".' },
      },
      required: ['name'],
    },
  },
}

export const pluginRead: ToolHandler = async (args) => {
  const name = (args.name ?? '').trim()
  if (!name) return 'Error: name is required'
  try {
    const filePath = join(PLUGINS_DIR, name)
    // Ensure path stays inside plugins dir
    if (!filePath.startsWith(PLUGINS_DIR)) return 'Error: path escapes plugins directory'
    const content = await readFile(filePath, 'utf-8')
    return `=== plugins/${name} ===\n\n${content}`
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`
  }
}
