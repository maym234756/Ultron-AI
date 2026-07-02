/**
 * Advanced web scraping tools — structured extraction, pagination, bulk, monitoring.
 * Uses Playwright for JS-rendered pages + Node fetch as fallback.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { getPage } from './playwright.js'
import { runTerminal } from './terminal.js'
import type { ToolDefinition, ToolHandler } from './types.js'

// ── Shared text extraction (fetch fallback) ────────────────────────────────────

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36' },
    signal: AbortSignal.timeout(15_000),
  })
  return res.text()
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 30000)
}

// ── web_scrape ─────────────────────────────────────────────────────────────────

export const webScrapeDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'web_scrape',
    description: 'Extract structured data from any web page using CSS selectors. Returns clean JSON. Works on JS-rendered pages. Example fields: {"title":"h1","price":".price","links":"a[href]"}',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to scrape.' },
        fields: { type: 'string', description: 'JSON object mapping field names to CSS selectors. e.g. {"title":"h1","price":".price","description":"p.desc"}' },
        all: { type: 'string', description: 'Set "true" to return all matching elements per selector (not just first).' },
        wait_for: { type: 'string', description: 'Optional CSS selector to wait for before extracting (for JS-heavy pages).' },
        output_file: { type: 'string', description: 'Optional: save result as JSON to ~/Desktop/<name>.json' },
      },
      required: ['url', 'fields'],
    },
  },
}

export const webScrape: ToolHandler = async (args) => {
  if (!args.url || !args.fields) return 'Error: url and fields required'
  let fields: Record<string, string>
  try { fields = JSON.parse(args.fields) as Record<string, string> }
  catch { return 'Error: fields must be valid JSON object, e.g. {"title":"h1","price":".price"}' }

  try {
    const page = await getPage()
    await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    if (args.wait_for) await page.waitForSelector(args.wait_for, { timeout: 10_000 }).catch(() => {})

    const getAll = args.all === 'true'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await page.evaluate(({ fields: f, getAll: ga }: { fields: Record<string, string>; getAll: boolean }) => {
      const doc = (globalThis as any).document
      const out: Record<string, unknown> = {}
      for (const [key, sel] of Object.entries(f)) {
        try {
          if (ga) {
            out[key] = Array.from(doc.querySelectorAll(sel)).map((el: any) =>
              el.tagName === 'A' ? { text: el.innerText?.trim(), href: el.href } : el.innerText?.trim() ?? el.getAttribute('value') ?? ''
            )
          } else {
            const el: any = doc.querySelector(sel)
            if (!el) { out[key] = null; continue }
            out[key] = el.tagName === 'A' ? { text: el.innerText?.trim(), href: el.href }
              : el.tagName === 'IMG' ? { src: el.src, alt: el.alt }
              : el.tagName === 'INPUT' ? (el.value || el.getAttribute('placeholder'))
              : el.innerText?.trim() ?? ''
          }
        } catch { out[key] = null }
      }
      return out
    }, { fields, getAll })

    const json = JSON.stringify(result, null, 2)
    if (args.output_file) {
      const dest = join(homedir(), 'Desktop', `${args.output_file}.json`)
      await writeFile(dest, json, 'utf-8')
      return `Scraped ${Object.keys(result as object).length} fields. Saved to ${dest}\n\n${json}`
    }
    return json
  } catch (err) {
    // Fallback: simple fetch + regex
    try {
      const html = await fetchText(args.url)
      return `[Playwright unavailable — plain text only]\n${stripHtml(html).slice(0, 5000)}`
    } catch {
      return `Error: ${err instanceof Error ? err.message : String(err)}`
    }
  }
}

// ── web_scrape_pages ───────────────────────────────────────────────────────────

export const webScrapePagesDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'web_scrape_pages',
    description: 'Scrape multiple pages by following "Next page" links. Aggregates all results.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Starting URL.' },
        fields: { type: 'string', description: 'JSON field→selector map (same as web_scrape).' },
        next_selector: { type: 'string', description: 'CSS selector for the "Next page" button/link. e.g. "a.next", "[aria-label=Next]".' },
        row_selector: { type: 'string', description: 'CSS selector for each result ROW (for table/list data). If provided, extracts one object per row.' },
        max_pages: { type: 'string', description: 'Max pages to follow (default 5).' },
        output_file: { type: 'string', description: 'Save results to ~/Desktop/<name>.json' },
      },
      required: ['url', 'fields', 'next_selector'],
    },
  },
}

export const webScrapePages: ToolHandler = async (args) => {
  if (!args.url || !args.fields || !args.next_selector) return 'Error: url, fields, and next_selector required'
  let fields: Record<string, string>
  try { fields = JSON.parse(args.fields) as Record<string, string> }
  catch { return 'Error: fields must be valid JSON' }

  const maxPages = parseInt(args.max_pages ?? '5', 10) || 5
  const allResults: unknown[] = []

  try {
    const page = await getPage()
    let currentUrl = args.url
    for (let p = 0; p < maxPages; p++) {
      await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 })
      await page.waitForTimeout(800)

      if (args.row_selector) {
        // Row-based extraction
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows = await page.evaluate(({ rowSel, f }: { rowSel: string; f: Record<string, string> }) => {
          const doc = (globalThis as any).document
          return Array.from(doc.querySelectorAll(rowSel)).map((row: any) => {
            const obj: Record<string, string | null> = {}
            for (const [key, sel] of Object.entries(f)) {
              const el = row.querySelector(sel) as any
              obj[key] = el ? (el.innerText?.trim() ?? el.href ?? null) : null
            }
            return obj
          })
        }, { rowSel: args.row_selector, f: fields })
        allResults.push(...rows)
      } else {
        // Page-level extraction
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const row = await page.evaluate(({ f }: { f: Record<string, string> }) => {
          const doc = (globalThis as any).document
          const obj: Record<string, string | null> = {}
          for (const [key, sel] of Object.entries(f)) {
            const el = doc.querySelector(sel) as any
            obj[key] = el ? el.innerText?.trim() ?? null : null
          }
          return obj
        }, { f: fields })
        allResults.push(row)
      }

      // Try to click Next
      const nextEl = await page.locator(args.next_selector).first()
      const visible = await nextEl.isVisible().catch(() => false)
      if (!visible) { console.log(`[scraper] No next button on page ${p + 1}`); break }
      const nextUrl = await nextEl.getAttribute('href').catch(() => null)
      if (nextUrl) {
        currentUrl = nextUrl.startsWith('http') ? nextUrl : new URL(nextUrl, currentUrl).toString()
      } else {
        await nextEl.click()
        await page.waitForTimeout(1500)
        currentUrl = page.url()
      }
    }

    const json = JSON.stringify(allResults, null, 2)
    if (args.output_file) {
      const dest = join(homedir(), 'Desktop', `${args.output_file}.json`)
      await writeFile(dest, json, 'utf-8')
      return `Scraped ${allResults.length} results across up to ${maxPages} pages. Saved to ${dest}`
    }
    return `${allResults.length} results:\n${json.slice(0, 8000)}`
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── web_scrape_list ────────────────────────────────────────────────────────────

export const webScrapeListDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'web_scrape_list',
    description: 'Scrape multiple URLs in parallel and aggregate results. Export to JSON or CSV on Desktop.',
    parameters: {
      type: 'object',
      properties: {
        urls: { type: 'string', description: 'JSON array of URLs to scrape.' },
        fields: { type: 'string', description: 'JSON field→selector map.' },
        output_file: { type: 'string', description: 'Output filename on Desktop (no extension — adds .json or .csv).' },
        format: { type: 'string', description: 'json (default) or csv.' },
      },
      required: ['urls', 'fields'],
    },
  },
}

export const webScrapeList: ToolHandler = async (args) => {
  if (!args.urls || !args.fields) return 'Error: urls and fields required'
  let urls: string[]
  let fields: Record<string, string>
  try { urls = JSON.parse(args.urls) as string[]; fields = JSON.parse(args.fields) as Record<string, string> }
  catch { return 'Error: urls and fields must be valid JSON' }
  if (!urls.length) return 'Error: urls array is empty'

  try {
    // Scrape concurrently with limit of 3
    const results: Array<Record<string, unknown>> = []
    const chunks: string[][] = []
    for (let i = 0; i < urls.length; i += 3) chunks.push(urls.slice(i, i + 3))

    for (const chunk of chunks) {
      const batch = await Promise.all(chunk.map(async (url) => {
        try {
          const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10_000) })
          const html = await res.text()
          // Simple regex extraction for bulk (no browser)
          const obj: Record<string, string | null> = { _url: url }
          for (const [key, _sel] of Object.entries(fields)) {
            // Extract from plain HTML using simple heuristics
            const match = html.match(new RegExp(`<[^>]*class="[^"]*${_sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/^\./, '')}[^"]*"[^>]*>([^<]{1,300})`, 'i'))
            obj[key] = match?.[1]?.trim() ?? null
          }
          return obj
        } catch {
          return { _url: url, _error: 'Failed to fetch' }
        }
      }))
      results.push(...batch)
    }

    const fmt = args.format === 'csv' ? 'csv' : 'json'
    const name = args.output_file ?? `scrape_${Date.now()}`
    const dest = join(homedir(), 'Desktop', `${name}.${fmt}`)

    if (fmt === 'csv') {
      const headers = ['_url', ...Object.keys(fields)]
      const rows = results.map(r => headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','))
      await writeFile(dest, [headers.join(','), ...rows].join('\n'), 'utf-8')
    } else {
      await writeFile(dest, JSON.stringify(results, null, 2), 'utf-8')
    }

    return `Scraped ${results.length} URLs. Saved to ${dest}`
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── web_monitor ────────────────────────────────────────────────────────────────

export const webMonitorDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'web_monitor',
    description: 'Monitor a web page for changes. Checks the value of a CSS selector on an interval and notifies when it changes. Great for price tracking, stock alerts, dashboard monitoring.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to monitor.' },
        selector: { type: 'string', description: 'CSS selector to watch.' },
        interval_mins: { type: 'string', description: 'Check interval in minutes (default 30).' },
        name: { type: 'string', description: 'Monitor name (used in notifications).' },
        notify_on: { type: 'string', description: 'any_change (default), decrease, increase (for numeric values).' },
      },
      required: ['url', 'selector'],
    },
  },
}

// Store: .web-monitors.json
const MONITOR_STORE = join(process.cwd(), '.web-monitors.json')

type MonitorEntry = {
  id: string
  name: string
  url: string
  selector: string
  interval_mins: number
  notify_on: string
  last_value: string | null
  last_checked: string | null
  created: string
}

async function loadMonitors(): Promise<MonitorEntry[]> {
  try {
    const { readFile } = await import('node:fs/promises')
    return JSON.parse(await readFile(MONITOR_STORE, 'utf-8')) as MonitorEntry[]
  } catch { return [] }
}

async function saveMonitors(monitors: MonitorEntry[]): Promise<void> {
  const { writeFile: wf } = await import('node:fs/promises')
  await wf(MONITOR_STORE, JSON.stringify(monitors, null, 2), 'utf-8')
}

export const webMonitor: ToolHandler = async (args) => {
  if (!args.url || !args.selector) return 'Error: url and selector required'
  const intervalMins = parseInt(args.interval_mins ?? '30', 10) || 30
  const monitors = await loadMonitors()
  const id = Date.now().toString(36)
  monitors.push({
    id,
    name: args.name ?? `Monitor ${id}`,
    url: args.url,
    selector: args.selector,
    interval_mins: intervalMins,
    notify_on: args.notify_on ?? 'any_change',
    last_value: null,
    last_checked: null,
    created: new Date().toISOString(),
  })
  await saveMonitors(monitors)
  // Register as cron schedule via PowerShell (check every interval)
  const checkCmd = `$url='${args.url}';$sel='${args.selector.replace(/'/g, "\\'")}';$id='${id}';$storeFile='${MONITOR_STORE.replace(/\\/g, '\\\\')}';$store=Get-Content $storeFile | ConvertFrom-Json;$mon=$store | Where-Object { $_.id -eq $id };if($mon){Write-Output "Monitor $id checked"}`
  return `Web monitor created (id: ${id})\nURL: ${args.url}\nSelector: ${args.selector}\nInterval: ${intervalMins} min\n\nUse schedule_task to automate: cron "every ${intervalMins} minutes", task "check web monitor ${id} for changes at ${args.url}"\n\nOr check manually with: web_check_monitor {id:"${id}"}\n\nNote: ${checkCmd.slice(0, 50)}...`
}

// ── web_check_monitor ─────────────────────────────────────────────────────────

export const webCheckMonitorDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'web_check_monitor',
    description: 'Manually check a web monitor — fetches current value and compares to last known. Returns change status.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Monitor ID from web_monitor.' },
      },
      required: ['id'],
    },
  },
}

export const webCheckMonitor: ToolHandler = async (args) => {
  if (!args.id) return 'Error: id required'
  try {
    const monitors = await loadMonitors()
    const mon = monitors.find(m => m.id === args.id)
    if (!mon) return `No monitor found: ${args.id}`

    const page = await getPage()
    await page.goto(mon.url, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const current = await page.evaluate((sel: string) => {
      const el = (globalThis as any).document.querySelector(sel)
      return el ? el.innerText?.trim() ?? el.getAttribute('value') ?? '' : null
    }, mon.selector)

    const prev = mon.last_value
    mon.last_value = current
    mon.last_checked = new Date().toISOString()
    await saveMonitors(monitors)

    if (prev === null) return `First check for "${mon.name}".\nCurrent value: ${current ?? '(not found)'}`
    if (current === prev) return `No change for "${mon.name}".\nValue: ${current}`

    const changed = `⚠️ CHANGED: "${mon.name}"\nPrevious: ${prev}\nCurrent:  ${current}`
    // Attempt desktop notification
    await runTerminal({ command: `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('${changed.replace(/'/g, "''")}','Ultron Web Monitor')` }).catch(() => {})
    return changed
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── web_list_monitors ─────────────────────────────────────────────────────────

export const webListMonitorsDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'web_list_monitors',
    description: 'List all active web monitors.',
    parameters: { type: 'object', properties: {} },
  },
}

export const webListMonitors: ToolHandler = async () => {
  const monitors = await loadMonitors()
  if (!monitors.length) return 'No web monitors configured.'
  return monitors.map(m =>
    `[${m.id}] ${m.name}\n  URL: ${m.url}\n  Selector: ${m.selector}\n  Interval: ${m.interval_mins}min\n  Last value: ${m.last_value ?? '(unchecked)'}\n  Last checked: ${m.last_checked ?? 'never'}`
  ).join('\n\n')
}
