import type { ToolDefinition, ToolHandler } from './types.js'

export const searchWebDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'search_web',
    description: 'Search the web and return titles, URLs, and snippets for the top results. Uses DuckDuckGo. For best results use concise, specific queries.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query.' },
        limit: { type: 'string', description: 'Max results to return (default 8, max 20).' },
      },
      required: ['query'],
    },
  },
}

type DDGInstantResponse = {
  Answer?: string
  AbstractText?: string
  AbstractURL?: string
  AbstractSource?: string
  RelatedTopics?: Array<{
    Text?: string
    FirstURL?: string
    Topics?: Array<{ Text?: string; FirstURL?: string }>
  }>
  Results?: Array<{ Text?: string; FirstURL?: string }>
}

type SearchResult = { title: string; url: string; snippet: string }

/** Parse DuckDuckGo HTML search results page for real organic links. */
async function ddgHtmlSearch(query: string, limit: number): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Ultron/2.0)',
      Accept: 'text/html',
    },
    signal: AbortSignal.timeout(12_000),
  })
  const html = await res.text()

  const results: SearchResult[] = []

  // Each result is in <div class="result"> ... <a class="result__a" href="...">title</a>
  // snippet is in <a class="result__snippet">...</a>
  const resultBlockRe = /<div[^>]+class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div|$)/g
  const linkRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/
  const snippetRe = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/

  let block: RegExpExecArray | null
  while ((block = resultBlockRe.exec(html)) !== null && results.length < limit) {
    const content = block[1]
    const linkMatch = linkRe.exec(content)
    if (!linkMatch) continue
    let href = linkMatch[1]
    // DDG redirects: //duckduckgo.com/l/?uddg=... — decode the real URL
    if (href.includes('uddg=')) {
      try {
        const u = new URL(href.startsWith('//') ? `https:${href}` : href)
        href = decodeURIComponent(u.searchParams.get('uddg') ?? href)
      } catch { /* keep original */ }
    } else if (href.startsWith('//')) {
      href = `https:${href}`
    }
    // Strip HTML tags, then remove all residual angle brackets to prevent injection.
    // Multi-statement form ensures CodeQL can track that no < characters remain.
    const stripHtml = (s: string): string => {
      let t = s.replace(/<[^>]*>/g, ' ')  // remove complete tags
      t = t.replace(/</g, '')             // remove any remaining < (e.g. unclosed tags)
      t = t.replace(/>/g, '')             // remove any remaining >
      return t.trim()
    }
    const title = stripHtml(linkMatch[2])
    const snippetMatch = snippetRe.exec(content)
    const snippet = snippetMatch ? stripHtml(snippetMatch[1]) : ''
    // Only include external http(s) URLs; reject duckduckgo.com and all its subdomains
    let isExternal = false
    try {
      const parsed = new URL(href)
      const host = parsed.hostname
      const isDDG = host === 'duckduckgo.com' || host.endsWith('.duckduckgo.com')
      isExternal = (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !isDDG
    } catch { /* skip malformed URLs */ }
    if (title && isExternal) {
      results.push({ title, url: href, snippet })
    }
  }
  return results
}

export const searchWeb: ToolHandler = async (args) => {
  const query = (args.query ?? '').trim()
  if (!query) return 'Error: query is required'
  const limit = Math.min(20, Math.max(1, parseInt(args.limit ?? '8', 10) || 8))

  try {
    // 1. Try HTML scraping for real organic results
    const htmlResults = await ddgHtmlSearch(query, limit).catch(() => [] as SearchResult[])

    // 2. Also call the Instant Answer API for answers/abstracts
    let instantLines: string[] = []
    try {
      const iaUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
      const iaRes = await fetch(iaUrl, {
        headers: { 'User-Agent': 'Ultron/2.0' },
        signal: AbortSignal.timeout(8_000),
      })
      const ia = await iaRes.json() as DDGInstantResponse
      if (ia.Answer) instantLines.push(`Answer: ${ia.Answer}`)
      if (ia.AbstractText) {
        instantLines.push(`Summary (${ia.AbstractSource ?? 'DDG'}): ${ia.AbstractText}`)
        if (ia.AbstractURL) instantLines.push(`Source: ${ia.AbstractURL}`)
      }
    } catch { /* ignore instant answer failures */ }

    const lines: string[] = []
    if (instantLines.length) lines.push(...instantLines, '')

    if (htmlResults.length > 0) {
      lines.push(`Top ${htmlResults.length} results for "${query}":`, '')
      htmlResults.forEach((r, i) => {
        lines.push(`${i + 1}. ${r.title}`)
        lines.push(`   ${r.url}`)
        if (r.snippet) lines.push(`   ${r.snippet}`)
      })
    } else if (instantLines.length === 0) {
      // Fallback to related topics from instant answer
      try {
        const iaUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
        const iaRes = await fetch(iaUrl, { headers: { 'User-Agent': 'Ultron/2.0' }, signal: AbortSignal.timeout(8_000) })
        const ia = await iaRes.json() as DDGInstantResponse
        const topics = (ia.RelatedTopics ?? []).flatMap(t => t.Topics?.length ? t.Topics : [t])
        const results2 = (ia.Results ?? []).map(r => ({ title: r.Text ?? '', url: r.FirstURL ?? '', snippet: '' }))
        const all = [...results2, ...topics.map(t => ({ title: t.Text ?? '', url: t.FirstURL ?? '', snippet: '' }))]
        if (all.length) {
          lines.push(`Related (${all.length}):`)
          all.slice(0, limit).forEach((t, i) => {
            if (t.title) lines.push(`${i + 1}. ${t.title}${t.url ? `\n   ${t.url}` : ''}`)
          })
        } else {
          lines.push('No results found.')
        }
      } catch { lines.push('No results found.') }
    }

    return lines.join('\n') || 'No results found.'
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`
  }
}
