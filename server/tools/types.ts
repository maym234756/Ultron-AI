export type ToolParameter = {
  type: string
  description: string
  enum?: string[]
}

export type ToolDefinition = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, ToolParameter>
      required?: string[]
    }
  }
}

export type ToolArgs = Record<string, string>
export type ToolHandler = (args: ToolArgs) => Promise<string>

/**
 * Validate required args and optional value checks.
 * Returns an error string to return directly, or null if valid.
 *
 * Usage:
 *   const err = validateArgs(['url'], args)
 *   if (err) return err
 */
export function validateArgs(
  required: string[],
  args: ToolArgs,
  checks?: Record<string, (v: string) => string | null>,
): string | null {
  for (const key of required) {
    if (!args[key] || (args[key] as string).trim() === '') {
      return `Error: "${key}" is required`
    }
  }
  if (checks) {
    for (const [key, check] of Object.entries(checks)) {
      if (args[key] !== undefined && args[key] !== '') {
        const err = check(args[key])
        if (err) return `Error in "${key}": ${err}`
      }
    }
  }
  return null
}

/** Clamp a numeric string param to [min, max], returning the clamped number. */
export function clampInt(value: string | undefined, defaultVal: number, min: number, max: number): number {
  const n = parseInt(value ?? String(defaultVal), 10)
  return isNaN(n) ? defaultVal : Math.max(min, Math.min(max, n))
}
