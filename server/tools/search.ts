import type { ToolDefinition, ToolHandler } from './types.js'

export const searchWebDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'search_web',
    description: 'Search the web via DuckDuckGo and return a summary of results.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
      },
      required: ['query'],
    },
  },
}

type DDGResponse = {
  Answer?: string
  AbstractText?: string
  AbstractURL?: string
  RelatedTopics?: Array<{
    Text?: string
    FirstURL?: string
    Topics?: Array<{ Text?: string; FirstURL?: string }>
  }>
}

export const searchWeb: ToolHandler = async (args) => {
  const query = (args.query ?? '').trim()
  if (!query) return 'Error: query is required'
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Ultron/1.0' },
      signal: AbortSignal.timeout(8_000),
    })
    const data = (await res.json()) as DDGResponse
    const lines: string[] = []

    if (data.Answer) lines.push(`Answer: ${data.Answer}`)
    if (data.AbstractText) {
      lines.push(`Summary: ${data.AbstractText}`)
      if (data.AbstractURL) lines.push(`Source: ${data.AbstractURL}`)
    }

    const topics = (data.RelatedTopics ?? []).flatMap((t) => (t.Topics?.length ? t.Topics : [t]))
    if (topics.length > 0) {
      lines.push('\nRelated:')
      for (const t of topics.slice(0, 6)) {
        if (t.Text) lines.push(`• ${t.Text}${t.FirstURL ? `\n  ${t.FirstURL}` : ''}`)
      }
    }

    return lines.length > 0 ? lines.join('\n') : 'No results found.'
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`
  }
}
