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
