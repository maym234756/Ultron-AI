/**
 * Advanced Playwright tools:
 * - Credential vault (AES-256-GCM encrypted)
 * - Stealth mode (remove bot detection indicators)
 * - Page change watcher
 * - Action recorder
 * - Network request capture
 */
import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'node:crypto'
import { hostname, userInfo } from 'node:os'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getPage } from './playwright.js'
import type { ToolDefinition, ToolHandler } from './types.js'
import type { Page, Response } from 'playwright'

// ── Credential vault (AES-256-GCM) ───────────────────────────────────────────

const VAULT_FILE = join(process.cwd(), '.cred-vault.json')

function getMachineKey(): Buffer {
  const seed = `${hostname()}-${userInfo().username}-astra-vault-v1`
  return pbkdf2Sync(seed, 'astra-vault-salt-2024', 100_000, 32, 'sha256')
}

function encrypt(text: string): string {
  const key = getMachineKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

function decrypt(encoded: string): string {
  const key = getMachineKey()
  const buf = Buffer.from(encoded, 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const enc = buf.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}

type VaultEntry = { site: string; username: string; password: string; notes?: string }
type Vault = Record<string, string> // site → encrypted JSON

async function loadVault(): Promise<Vault> {
  try { return JSON.parse(await readFile(VAULT_FILE, 'utf-8')) as Vault }
  catch { return {} }
}

async function saveVault(v: Vault): Promise<void> {
  await writeFile(VAULT_FILE, JSON.stringify(v, null, 2), 'utf-8')
}

// ── browser_vault_save ────────────────────────────────────────────────────────

export const browserVaultSaveDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_vault_save',
    description: 'Securely save login credentials for a site. Encrypted with AES-256-GCM using a machine-specific key. Use browser_login to fill them automatically.',
    parameters: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Site name/domain (e.g. "github.com", "gmail").' },
        username: { type: 'string', description: 'Username or email.' },
        password: { type: 'string', description: 'Password.' },
        notes: { type: 'string', description: 'Optional notes.' },
      },
      required: ['site', 'username', 'password'],
    },
  },
}

export const browserVaultSave: ToolHandler = async (args) => {
  if (!args.site || !args.username || !args.password) return 'Error: site, username, and password required'
  const vault = await loadVault()
  const entry: VaultEntry = { site: args.site, username: args.username, password: args.password, notes: args.notes }
  vault[args.site.toLowerCase()] = encrypt(JSON.stringify(entry))
  await saveVault(vault)
  return `Credentials saved for ${args.site} (encrypted on disk).`
}

// ── browser_vault_list ────────────────────────────────────────────────────────

export const browserVaultListDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_vault_list',
    description: 'List all sites with saved credentials (usernames only, passwords hidden).',
    parameters: { type: 'object', properties: {} },
  },
}

export const browserVaultList: ToolHandler = async () => {
  const vault = await loadVault()
  const sites = Object.keys(vault)
  if (!sites.length) return 'No credentials saved. Use browser_vault_save to add some.'
  return sites.map(site => {
    try {
      const e = JSON.parse(decrypt(vault[site])) as VaultEntry
      return `${e.site}: ${e.username}${e.notes ? ` (${e.notes})` : ''}`
    } catch { return `${site}: [corrupt]` }
  }).join('\n')
}

// ── browser_login ─────────────────────────────────────────────────────────────

export const browserLoginDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_login',
    description: 'Auto-fill login credentials from the vault and submit. Uses saved credentials from browser_vault_save.',
    parameters: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Site key from vault (e.g. "github.com").' },
        url: { type: 'string', description: 'Login page URL (optional — navigates there first).' },
        username_selector: { type: 'string', description: 'CSS selector for username field (default: input[type=email],input[name*=user],input[name*=email]).' },
        password_selector: { type: 'string', description: 'CSS selector for password field (default: input[type=password]).' },
        submit_selector: { type: 'string', description: 'CSS selector for submit button (default: button[type=submit],input[type=submit]).' },
      },
      required: ['site'],
    },
  },
}

export const browserLogin: ToolHandler = async (args) => {
  if (!args.site) return 'Error: site required'
  const vault = await loadVault()
  const encrypted = vault[args.site.toLowerCase()]
  if (!encrypted) return `No credentials for "${args.site}". Use browser_vault_save first.`
  let creds: VaultEntry
  try { creds = JSON.parse(decrypt(encrypted)) as VaultEntry }
  catch { return 'Error: could not decrypt credentials (vault may be from a different machine)' }

  try {
    const page = await getPage()
    if (args.url) await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 20_000 })

    const userSel = args.username_selector ?? 'input[type="email"],input[name*="user" i],input[name*="email" i],input[id*="user" i],input[id*="email" i]'
    const passSel = args.password_selector ?? 'input[type="password"]'
    const submitSel = args.submit_selector ?? 'button[type="submit"],input[type="submit"]'

    await page.locator(userSel).first().click({ timeout: 8_000 })
    await page.locator(userSel).first().fill(creds.username)
    await page.locator(passSel).first().fill(creds.password)
    await page.locator(submitSel).first().click({ timeout: 8_000 })
    await page.waitForTimeout(2000)

    return `Logged in as ${creds.username} on ${creds.site}. Current page: ${page.url()}`
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── browser_stealth ───────────────────────────────────────────────────────────

export const browserStealthDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_stealth',
    description: 'Enable stealth mode on the current browser context — removes bot detection indicators (navigator.webdriver, headless flags). Call before browser_go when scraping sites with bot protection.',
    parameters: {
      type: 'object',
      properties: {
        user_agent: { type: 'string', description: 'Custom user agent (default: realistic Chrome 125 on Windows).' },
      },
    },
  },
}

export const browserStealth: ToolHandler = async (args) => {
  try {
    const page = await getPage()
    const ua = args.user_agent ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

    await page.addInitScript(() => {
      // Remove webdriver indicator
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true })
      // Fake chrome runtime
      ;(globalThis as any).chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) }
      // Fix permissions API
      const nav = navigator as any
      const origQuery = nav.permissions?.query?.bind(nav.permissions)
      if (origQuery) {
        Object.defineProperty(nav.permissions, 'query', {
          value: (params: { name: string }) =>
            params.name === 'notifications'
              ? Promise.resolve({ state: (globalThis as any).Notification?.permission ?? 'default', onchange: null })
              : origQuery(params),
        })
      }
      // Realistic plugins
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] })
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] })
      // Remove headless indicators
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 })
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 })
    })

    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'User-Agent': ua,
    })

    return `Stealth mode enabled. User-agent: ${ua.slice(0, 80)}...`
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── browser_watch ─────────────────────────────────────────────────────────────

const _watchers = new Map<string, NodeJS.Timeout>()

export const browserWatchDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_watch',
    description: 'Watch a CSS selector on the current page for changes. Polls every N seconds and logs/notifies when value changes.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector to watch.' },
        interval_sec: { type: 'string', description: 'Poll interval in seconds (default 10).' },
        duration_sec: { type: 'string', description: 'How long to watch in seconds (default 120). Set 0 to watch indefinitely.' },
        id: { type: 'string', description: 'Watch ID for cancelling. Auto-generated if omitted.' },
      },
      required: ['selector'],
    },
  },
}

export const browserWatch: ToolHandler = async (args) => {
  if (!args.selector) return 'Error: selector required'
  const intervalSec = parseInt(args.interval_sec ?? '10', 10) || 10
  const durationSec = parseInt(args.duration_sec ?? '120', 10)
  const id = args.id ?? Date.now().toString(36)

  if (_watchers.has(id)) {
    clearInterval(_watchers.get(id))
    _watchers.delete(id)
    return `Stopped watcher: ${id}`
  }

  let lastVal: string | null = null
  let elapsed = 0
  const changes: string[] = []

  const timer = setInterval(async () => {
    elapsed += intervalSec
    if (durationSec > 0 && elapsed >= durationSec) {
      clearInterval(timer)
      _watchers.delete(id)
      return
    }
    try {
      const page = await getPage()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const val = await page.evaluate((sel: string) => {
        const el = (globalThis as any).document.querySelector(sel)
        return el ? el.innerText?.trim() ?? '' : null
      }, args.selector)
      if (lastVal !== null && val !== lastVal) {
        const msg = `[${new Date().toLocaleTimeString()}] "${args.selector}" changed: "${lastVal}" → "${val}"`
        changes.push(msg)
        console.log(`[browser_watch:${id}]`, msg)
      }
      lastVal = val
    } catch { /* page navigated away */ }
  }, intervalSec * 1000)

  _watchers.set(id, timer)
  return `Watching selector "${args.selector}" every ${intervalSec}s for ${durationSec > 0 ? `${durationSec}s` : 'indefinitely'} (id: ${id}).\nCancel with: browser_watch {selector:"${args.selector}", id:"${id}"}`
}

// ── browser_record_start ──────────────────────────────────────────────────────

const _recordedActions: string[] = []
let _recording = false

export const browserRecordStartDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_record_start',
    description: 'Start recording browser actions (clicks, typing, navigation). Interact with the page — Astra captures everything. Stop with browser_record_stop to get the replay script.',
    parameters: { type: 'object', properties: {} },
  },
}

export const browserRecordStart: ToolHandler = async () => {
  try {
    const page = await getPage()
    _recordedActions.length = 0
    _recording = true

    // Record navigation
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame() && _recording) {
        _recordedActions.push(`{"tool":"browser_go","args":{"url":"${frame.url()}"}}`)
      }
    })

    // Inject click + input listener
    await page.addInitScript(() => {
      const doc = (globalThis as any).document
      const send = (action: string) => {
        const el = doc.getElementById('__astra_recorder__')
        if (el) el.setAttribute('data-last', action)
      }
      doc.addEventListener('click', (e: any) => {
        const el = e.target
        const tag = el.tagName?.toLowerCase() ?? ''
        const text = el.innerText?.trim().slice(0, 60) ?? ''
        const id = el.id ? `#${el.id}` : ''
        const cls = el.className ? `.${String(el.className).split(' ')[0]}` : ''
        send(JSON.stringify({ tool: 'browser_click', args: { selector: id || cls || tag, text } }))
      }, true)
      doc.addEventListener('change', (e: any) => {
        const el = e.target
        if (el.tagName === 'SELECT') {
          send(JSON.stringify({ tool: 'browser_select', args: { selector: el.id ? `#${el.id}` : el.name ? `[name="${el.name}"]` : 'select', value: el.value } }))
        }
      }, true)
    })

    return 'Recording started. Interact with the page normally. Call browser_record_stop when done.'
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── browser_record_stop ───────────────────────────────────────────────────────

export const browserRecordStopDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_record_stop',
    description: 'Stop recording and return the captured sequence of browser tool calls.',
    parameters: {
      type: 'object',
      properties: {
        save_to: { type: 'string', description: 'Optional: save the script to ~/Desktop/<name>.json' },
      },
    },
  },
}

export const browserRecordStop: ToolHandler = async (args) => {
  _recording = false
  if (!_recordedActions.length) return 'No actions were recorded.'
  const script = _recordedActions.join('\n')
  if (args.save_to) {
    const dest = join(process.cwd(), `${args.save_to}.json`)
    await writeFile(dest, JSON.stringify(_recordedActions, null, 2), 'utf-8')
    return `Recorded ${_recordedActions.length} actions. Saved to ${dest}\n\n${script}`
  }
  return `Recorded ${_recordedActions.length} actions:\n\n${script}`
}

// ── browser_network_capture ───────────────────────────────────────────────────

const _capturedRequests: Array<{ url: string; method: string; status: number; contentType: string; size: number; capturedAt: number; body: string }> = []
let _capturing = false
let _networkCapturePage: Page | null = null
let _networkCaptureHandler: ((response: Response) => Promise<void>) | null = null
let _networkCaptureStartedAt = 0

export const browserNetworkCaptureDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_network_capture',
    description: 'Capture XHR/fetch API responses from the page. Useful for scraping data that comes from API calls rather than HTML.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'start, stop, or get (default: get captured so far).' },
        filter: { type: 'string', description: 'URL substring filter (e.g. "/api/", "graphql").' },
        method: { type: 'string', description: 'Optional comma-separated HTTP methods to capture, e.g. GET,POST.' },
        status: { type: 'string', description: 'Optional comma-separated HTTP statuses to capture, e.g. 200,201,404.' },
        content_type: { type: 'string', description: 'Optional content-type substring filter, e.g. json, text, graphql.' },
        max_body_chars: { type: 'string', description: 'Maximum response body characters to store per response (default 5000).' },
        save_to: { type: 'string', description: 'For action=get, optional filename to save captured responses as JSON in the workspace.' },
      },
    },
  },
}

export const browserNetworkCapture: ToolHandler = async (args) => {
  const action = args.action ?? 'get'

  if (action === 'start') {
    try {
      const page = await getPage()
      if (_networkCapturePage && _networkCaptureHandler) {
        _networkCapturePage.off('response', _networkCaptureHandler)
      }
      _capturedRequests.length = 0
      _capturing = true
      _networkCaptureStartedAt = Date.now()
      const methods = new Set((args.method ?? '').split(',').map(method => method.trim().toUpperCase()).filter(Boolean))
      const statuses = new Set((args.status ?? '').split(',').map(status => parseInt(status.trim(), 10)).filter(Number.isFinite))
      const maxBodyChars = Math.max(200, Math.min(200_000, parseInt(args.max_body_chars ?? '5000', 10) || 5000))
      const contentTypeFilter = args.content_type?.toLowerCase()

      _networkCaptureHandler = async (response: Response) => {
        if (!_capturing) return
        const url = response.url()
        if (args.filter && !url.includes(args.filter)) return
        const method = response.request().method()
        if (methods.size && !methods.has(method.toUpperCase())) return
        const status = response.status()
        if (statuses.size && !statuses.has(status)) return
        const ct = response.headers()['content-type'] ?? ''
        if (contentTypeFilter && !ct.toLowerCase().includes(contentTypeFilter)) return
        if (!contentTypeFilter && !ct.includes('json') && !ct.includes('text')) return
        try {
          const body = await response.text()
          _capturedRequests.push({
            url,
            method,
            status,
            contentType: ct,
            size: Buffer.byteLength(body, 'utf8'),
            capturedAt: Date.now(),
            body: body.slice(0, maxBodyChars),
          })
        } catch { /* skip */ }
      }
      _networkCapturePage = page
      page.on('response', _networkCaptureHandler)

      const filters = [
        args.filter && `url includes "${args.filter}"`,
        methods.size && `method in ${Array.from(methods).join(',')}`,
        statuses.size && `status in ${Array.from(statuses).join(',')}`,
        contentTypeFilter && `content-type includes "${contentTypeFilter}"`,
      ].filter(Boolean).join('; ')
      return `Network capture started${filters ? ` (${filters})` : ''}. Interact with the page, then call browser_network_capture {action:"get"} to see responses.`
    } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
  }

  if (action === 'stop') {
    _capturing = false
    if (_networkCapturePage && _networkCaptureHandler) {
      _networkCapturePage.off('response', _networkCaptureHandler)
      _networkCapturePage = null
      _networkCaptureHandler = null
    }
    return `Capture stopped. ${_capturedRequests.length} responses captured. Call browser_network_capture {action:"get"} to view.`
  }

  // get
  if (!_capturedRequests.length) return 'No requests captured. Call browser_network_capture {action:"start"} first.'
  if (args.save_to) {
    const dest = join(process.cwd(), `${args.save_to.replace(/\.json$/i, '')}.json`)
    await writeFile(dest, JSON.stringify({ startedAt: _networkCaptureStartedAt, captured: _capturedRequests }, null, 2), 'utf-8')
    return `Saved ${_capturedRequests.length} captured response(s) to ${dest}`
  }
  return _capturedRequests.map((r, i) =>
    `[${i + 1}] ${r.method} ${r.url}\nStatus: ${r.status} · ${r.contentType || 'unknown type'} · ${r.size.toLocaleString()} bytes\n${r.body.slice(0, 1000)}`
  ).join('\n\n---\n\n')
}

// -- browser_performance_audit -------------------------------------------------

export const browserPerformanceAuditDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_performance_audit',
    description: 'Audit the current Playwright page for response time, navigation timing, resource counts, DOM size, forms, images, scripts, and basic public UX signals.',
    parameters: {
      type: 'object',
      properties: {
        include_resources: { type: 'string', description: 'Set to "true" to include the slowest resource URLs.' },
        max_resources: { type: 'string', description: 'Maximum slow resources to return when include_resources is true. Default 12.' },
      },
    },
  },
}

export const browserPerformanceAudit: ToolHandler = async (args) => {
  try {
    const page = await getPage()
    const includeResources = args.include_resources === 'true'
    const maxResources = Math.max(1, Math.min(50, parseInt(args.max_resources ?? '12', 10) || 12))
    const audit = await page.evaluate(({ includeResources, maxResources }) => {
      const win = globalThis as any
      const doc = win.document
      const perf = win.performance
      const navLocation = win.location
      const navigation = perf.getEntriesByType('navigation')[0]
      const resources = perf.getEntriesByType('resource') as any[]
      const paintEntries = perf.getEntriesByType('paint') as any[]
      const byType = resources.reduce<Record<string, { count: number; transfer: number; duration: number }>>((acc, item) => {
        const type = item.initiatorType || 'other'
        acc[type] ??= { count: 0, transfer: 0, duration: 0 }
        acc[type].count++
        acc[type].transfer += item.transferSize || 0
        acc[type].duration += item.duration || 0
        return acc
      }, {})
      const slowest = resources
        .slice()
        .sort((a, b) => b.duration - a.duration)
        .slice(0, maxResources)
        .map(item => ({
          url: item.name.slice(0, 220),
          type: item.initiatorType || 'other',
          durationMs: Math.round(item.duration),
          transferKb: Math.round((item.transferSize || 0) / 1024),
        }))
      const timings = navigation ? {
        domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd - navigation.startTime),
        loadEventMs: Math.round(navigation.loadEventEnd - navigation.startTime),
        responseStartMs: Math.round(navigation.responseStart - navigation.startTime),
        responseEndMs: Math.round(navigation.responseEnd - navigation.startTime),
        transferKb: Math.round((navigation.transferSize || 0) / 1024),
      } : null
      const paints = Object.fromEntries(paintEntries.map(entry => [entry.name, Math.round(entry.startTime)]))
      return {
        url: navLocation.href,
        title: doc.title,
        timings,
        paints,
        resources: {
          total: resources.length,
          byType,
          slowest: includeResources ? slowest : undefined,
        },
        page: {
          domNodes: doc.querySelectorAll('*').length,
          headings: doc.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
          links: doc.links.length,
          buttons: doc.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"]').length,
          forms: doc.forms.length,
          images: doc.images.length,
          videos: doc.querySelectorAll('video').length,
          iframes: doc.querySelectorAll('iframe').length,
        },
        publicUxSignals: {
          hasViewportMeta: Boolean(doc.querySelector('meta[name="viewport"]')),
          hasDescription: Boolean(doc.querySelector('meta[name="description"]')),
          h1Text: Array.from(doc.querySelectorAll('h1')).map((h: any) => h.textContent?.trim()).filter(Boolean).slice(0, 3),
          emptyButtons: Array.from(doc.querySelectorAll('button')).filter((button: any) => !button.textContent?.trim() && !button.getAttribute('aria-label')).length,
          imagesWithoutAlt: Array.from(doc.images).filter((img: any) => !img.alt).length,
        },
      }
    }, { includeResources, maxResources })
    return JSON.stringify(audit, null, 2).slice(0, 20000)
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// -- browser_smart_extract -----------------------------------------------------

export const browserSmartExtractDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_smart_extract',
    description: 'Extract structured content from the current page: title, headings, main text, links, forms, buttons, images, videos, and tables.',
    parameters: {
      type: 'object',
      properties: {
        max_items: { type: 'string', description: 'Maximum items per category. Default 25.' },
        include_text: { type: 'string', description: 'Set to "false" to omit main text preview.' },
      },
    },
  },
}

export const browserSmartExtract: ToolHandler = async (args) => {
  try {
    const page = await getPage()
    const maxItems = Math.max(5, Math.min(100, parseInt(args.max_items ?? '25', 10) || 25))
    const includeText = args.include_text !== 'false'
    const extracted = await page.evaluate(({ maxItems, includeText }) => {
      const win = globalThis as any
      const doc = win.document
      const navLocation = win.location
      const cssEscape = win.CSS?.escape ?? ((value: string) => value.replace(/"/g, '\\"'))
      const text = (el: any) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
      const attr = (el: any, name: string) => el?.getAttribute?.(name) ?? ''
      const main = doc.querySelector('main,article,[role="main"]') ?? doc.body
      const tables = Array.from(doc.querySelectorAll('table')).slice(0, Math.min(8, maxItems)).map((table: any) => {
        const rows = Array.from(table.querySelectorAll('tr')).slice(0, 8).map((row: any) =>
          Array.from(row.querySelectorAll('th,td')).slice(0, 8).map(cell => text(cell))
        )
        return { caption: text(table.querySelector('caption')), rows }
      })
      return {
        url: navLocation.href,
        title: doc.title,
        description: attr(doc.querySelector('meta[name="description"]') ?? doc.createElement('meta'), 'content'),
        headings: Array.from(doc.querySelectorAll('h1,h2,h3')).slice(0, maxItems).map((heading: any) => ({ tag: heading.tagName.toLowerCase(), text: text(heading) })),
        textPreview: includeText ? text(main).slice(0, 5000) : undefined,
        links: Array.from(doc.links).slice(0, maxItems).map((link: any) => ({ text: text(link), href: link.href })),
        buttons: Array.from(doc.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"]')).slice(0, maxItems).map((button: any) => ({ text: text(button), ariaLabel: attr(button, 'aria-label'), type: attr(button, 'type') })),
        forms: Array.from(doc.forms).slice(0, maxItems).map((form: any) => ({
          action: form.action,
          method: form.method,
          fields: Array.from(form.querySelectorAll('input,textarea,select')).slice(0, 30).map((field: any) => ({
            tag: field.tagName.toLowerCase(),
            type: attr(field, 'type'),
            name: attr(field, 'name'),
            id: attr(field, 'id'),
            placeholder: attr(field, 'placeholder'),
            label: text(doc.querySelector(`label[for="${cssEscape(attr(field, 'id'))}"]`)),
          })),
        })),
        images: Array.from(doc.images).slice(0, maxItems).map((img: any) => ({ src: img.currentSrc || img.src, alt: img.alt, width: img.naturalWidth, height: img.naturalHeight })),
        videos: Array.from(doc.querySelectorAll('video')).slice(0, maxItems).map((video: any) => ({ src: video.currentSrc || attr(video, 'src'), poster: attr(video, 'poster'), duration: Number.isFinite(video.duration) ? video.duration : null })),
        tables,
      }
    }, { maxItems, includeText })
    return JSON.stringify(extracted, null, 2).slice(0, 24000)
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}
