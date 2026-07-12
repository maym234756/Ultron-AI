import type { ToolDefinition, ToolHandler } from './types.js'

// Redact the value portion of Authorization/API-key headers from error strings
function redactSecrets(text: string): string {
  return text
    .replace(/(authorization:\s*(?:Bearer|Basic|Token)\s+)\S+/gi, '$1[REDACTED]')
    .replace(/(x-api-key:\s+)\S+/gi, '$1[REDACTED]')
}

export const httpRequestDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'http_request',
    description:
      'Make a raw HTTP request (GET, POST, PUT, DELETE, PATCH) to any URL. Supports custom headers, request body, form data, authentication, retries on 429/5xx, and response size limits. Returns status code, response headers, and body.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full URL to request.' },
        method: { type: 'string', description: 'HTTP method: GET, POST, PUT, DELETE, PATCH (default: GET).' },
        headers: { type: 'string', description: 'JSON object of request headers, e.g. {"Content-Type":"application/json","X-API-Key":"abc"}' },
        body: { type: 'string', description: 'Request body (for POST/PUT/PATCH). String or JSON string.' },
        form_body: { type: 'string', description: 'URL-encoded form fields as a JSON object, e.g. {"username":"alice","password":"secret"}. Sets Content-Type to application/x-www-form-urlencoded.' },
        auth: { type: 'string', description: 'Auth shorthand: "bearer:TOKEN" or "basic:user:pass"' },
        timeout: { type: 'string', description: 'Timeout in seconds (default 30).' },
        retries: { type: 'string', description: 'Number of retries on 429 or 5xx responses (default 0, max 3).' },
        max_response_kb: { type: 'string', description: 'Truncate response body to this size in KB (default 32, max 512).' },
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
  const maxRetries = Math.min(3, Math.max(0, parseInt(args.retries ?? '0', 10) || 0))
  const maxResponseBytes = Math.min(512, Math.max(1, parseInt(args.max_response_kb ?? '32', 10) || 32)) * 1024

  const headers: Record<string, string> = {
    'User-Agent': 'Ultron/1.0',
  }

  // Parse extra headers
  if (args.headers) {
    try {
      const parsed = JSON.parse(args.headers) as Record<string, string>
      Object.assign(headers, parsed)
    } catch {
      return 'Error: headers must be valid JSON, e.g. {"Authorization":"******"}'
    }
  }

  // Auth shorthand
  if (args.auth) {
    if (args.auth.startsWith('bearer:')) {
      headers['Authorization'] = 'Bearer ' + args.auth.slice(7)
    } else if (args.auth.startsWith('basic:')) {
      const creds = args.auth.slice(6)
      headers['Authorization'] = 'Basic ' + Buffer.from(creds).toString('base64')
    }
  }

  // Resolve request body — form_body takes priority over body
  let requestBody: string | undefined
  if (args.form_body) {
    try {
      const fields = JSON.parse(args.form_body) as Record<string, string>
      requestBody = Object.entries(fields)
        .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
        .join('&')
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
    } catch {
      return 'Error: form_body must be a JSON object, e.g. {"username":"alice"}'
    }
  } else if (args.body) {
    requestBody = args.body
    if (!headers['Content-Type']) {
      try {
        JSON.parse(args.body)
        headers['Content-Type'] = 'application/json'
      } catch {
        headers['Content-Type'] = 'text/plain'
      }
    }
  }

  let lastError = ''
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: ['GET', 'HEAD'].includes(method) ? undefined : requestBody,
        signal: AbortSignal.timeout(timeoutSec * 1000),
        redirect: 'follow',
      })

      // Retry on 429 or 5xx
      if (attempt < maxRetries && (res.status === 429 || res.status >= 500)) {
        const rawRetryAfter = res.headers.get('retry-after') ?? ''
        let retryDelaySec = 2
        if (rawRetryAfter) {
          const asSeconds = parseInt(rawRetryAfter, 10)
          if (!isNaN(asSeconds)) {
            retryDelaySec = asSeconds
          } else {
            // HTTP-date format (e.g. "Wed, 21 Oct 2025 07:28:00 GMT")
            const targetMs = Date.parse(rawRetryAfter)
            if (!isNaN(targetMs)) retryDelaySec = Math.max(1, Math.ceil((targetMs - Date.now()) / 1000))
          }
        }
        await new Promise((r) => setTimeout(r, Math.min(retryDelaySec, 10) * 1000))
        lastError = 'HTTP ' + res.status + ' (retrying ' + (attempt + 1) + '/' + maxRetries + ')'
        continue
      }

      const resHeaders: Record<string, string> = {}
      res.headers.forEach((v, k) => { resHeaders[k] = v })

      const contentType = res.headers.get('content-type') ?? ''
      let body: string
      if (contentType.includes('application/json')) {
        try {
          const json: unknown = await res.json()
          const jsonStr = JSON.stringify(json, null, 2)
          body = jsonStr.length > maxResponseBytes
            ? jsonStr.slice(0, maxResponseBytes) + '\n... [truncated at ' + (args.max_response_kb ?? '32') + ' KB]'
            : jsonStr
        } catch {
          body = await res.text()
        }
      } else {
        const text = await res.text()
        body = text.length > maxResponseBytes
          ? text.slice(0, maxResponseBytes) + '\n... [truncated at ' + (args.max_response_kb ?? '32') + ' KB]'
          : text
      }

      const retryNote = attempt > 0 ? 'Retried ' + attempt + ' time(s). ' : ''
      return [
        retryNote + 'Status: ' + res.status + ' ' + res.statusText,
        'URL: ' + res.url,
        'Headers: ' + JSON.stringify(resHeaders, null, 2),
        'Body:\n' + body,
      ].join('\n\n')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      lastError = redactSecrets(msg)
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 2000))
        continue
      }
    }
  }
  return 'HTTP request failed' + (maxRetries > 0 ? ' after ' + (maxRetries + 1) + ' attempts' : '') + ': ' + lastError
}
