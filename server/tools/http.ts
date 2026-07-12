import type { ToolDefinition, ToolHandler } from './types.js'

export const httpRequestDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'http_request',
    description:
      'Make a raw HTTP request (GET, POST, PUT, DELETE, PATCH) to any URL. Supports custom headers, request body, and authentication. Returns status code, response headers, and body.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full URL to request.' },
        method: { type: 'string', description: 'HTTP method: GET, POST, PUT, DELETE, PATCH (default: GET).' },
        headers: { type: 'string', description: 'JSON object of request headers, e.g. {"Content-Type":"application/json","X-API-Key":"abc"}' },
        body: { type: 'string', description: 'Request body (for POST/PUT/PATCH). String or JSON string.' },
        auth: { type: 'string', description: 'Auth shorthand: "bearer:TOKEN" or "basic:user:pass"' },
        timeout: { type: 'string', description: 'Timeout in seconds (default 30).' },
      },
      required: ['url'],
    },
  },
}

export const httpRequest: ToolHandler = async (args) => {
  const url = (args.url ?? '').trim()
  if (!url) return 'Error: url is required'

  const method = (args.method ?? 'GET').toUpperCase()
  const timeoutSec = parseInt(args.timeout ?? '30', 10) || 30

  const headers: Record<string, string> = {
    'User-Agent': 'Astra/1.0',
  }

  // Parse extra headers
  if (args.headers) {
    try {
      const parsed = JSON.parse(args.headers) as Record<string, string>
      Object.assign(headers, parsed)
    } catch {
      return 'Error: headers must be valid JSON, e.g. {"Authorization":"Bearer token"}'
    }
  }

  // Auth shorthand
  if (args.auth) {
    if (args.auth.startsWith('bearer:')) {
      headers['Authorization'] = `Bearer ${args.auth.slice(7)}`
    } else if (args.auth.startsWith('basic:')) {
      const creds = args.auth.slice(6)
      headers['Authorization'] = `Basic ${Buffer.from(creds).toString('base64')}`
    }
  }

  // Auto-set Content-Type for JSON body
  if (args.body && !headers['Content-Type']) {
    try {
      JSON.parse(args.body)
      headers['Content-Type'] = 'application/json'
    } catch {
      headers['Content-Type'] = 'text/plain'
    }
  }

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: ['GET', 'HEAD'].includes(method) ? undefined : (args.body ?? undefined),
      signal: AbortSignal.timeout(timeoutSec * 1000),
    })

    const resHeaders: Record<string, string> = {}
    res.headers.forEach((v, k) => { resHeaders[k] = v })

    const contentType = res.headers.get('content-type') ?? ''
    let body: string
    if (contentType.includes('application/json')) {
      try {
        const json: unknown = await res.json()
        body = JSON.stringify(json, null, 2)
      } catch {
        body = await res.text()
      }
    } else {
      const text = await res.text()
      body = text.length > 8000 ? `${text.slice(0, 8000)}\n... [truncated]` : text
    }

    return [
      `Status: ${res.status} ${res.statusText}`,
      `Headers: ${JSON.stringify(resHeaders, null, 2)}`,
      `Body:\n${body}`,
    ].join('\n\n')
  } catch (err) {
    return `HTTP request failed: ${err instanceof Error ? err.message : String(err)}`
  }
}
