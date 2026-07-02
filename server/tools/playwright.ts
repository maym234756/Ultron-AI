import { join } from 'node:path'
import { homedir } from 'node:os'
import type { ToolDefinition, ToolHandler } from './types.js'
import type { Browser, Page } from 'playwright'

// ── singleton browser session (multi-tab) ─────────────────────────────────────

let _browser: Browser | null = null
let _pages: Page[] = []
let _currentTab = 0

export async function getPage(): Promise<Page> {
  if (!_browser || !_browser.isConnected()) {
    const { chromium } = await import('playwright')
    _browser = await chromium.launch({ headless: false, args: ['--start-maximized'] })
    _pages = []
    _currentTab = 0
  }
  _pages = _pages.filter((p) => !p.isClosed())
  if (_currentTab >= _pages.length) _currentTab = Math.max(0, _pages.length - 1)
  if (_pages.length === 0) {
    const page = await _browser.newPage()
    await page.setViewportSize({ width: 1280, height: 800 })
    _pages.push(page)
    _currentTab = 0
  }
  return _pages[_currentTab]
}

export async function closeBrowserSession(): Promise<void> {
  if (_browser) {
    await _browser.close().catch(() => {})
    _browser = null
    _pages = []
    _currentTab = 0
  }
}

// ── browser_go ────────────────────────────────────────────────────────────────

export const browserGoDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_go',
    description: 'Navigate the Playwright browser to a URL. Opens the browser if not open. Use for login, forms, and web automation.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full URL to navigate to.' },
        wait_for: { type: 'string', description: 'Optional CSS selector to wait for after navigation.' },
      },
      required: ['url'],
    },
  },
}

export const browserGo: ToolHandler = async (args) => {
  const url = (args.url ?? '').trim()
  if (!url) return 'Error: url is required'
  try {
    const page = await getPage()
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    if (args.wait_for) await page.waitForSelector(args.wait_for, { timeout: 10_000 }).catch(() => {})
    return `Navigated to: ${page.url()}\nTitle: ${await page.title()}`
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`
  }
}

// ── browser_click ─────────────────────────────────────────────────────────────

export const browserClickDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_click',
    description: 'Click an element by CSS selector or visible text.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector.' },
        text: { type: 'string', description: 'Visible text of element.' },
      },
    },
  },
}

export const browserClick: ToolHandler = async (args) => {
  try {
    const page = await getPage()
    if (args.selector) { await page.click(args.selector, { timeout: 10_000 }); return `Clicked: ${args.selector}` }
    if (args.text) { await page.getByText(args.text, { exact: false }).first().click({ timeout: 10_000 }); return `Clicked text: "${args.text}"` }
    return 'Error: provide selector or text'
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── browser_fill ──────────────────────────────────────────────────────────────

export const browserFillDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_fill',
    description: 'Fill a text input. Target by CSS selector, label text, or placeholder.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector.' },
        label: { type: 'string', description: 'Label text.' },
        placeholder: { type: 'string', description: 'Placeholder text.' },
        value: { type: 'string', description: 'Text to type.' },
      },
      required: ['value'],
    },
  },
}

export const browserFill: ToolHandler = async (args) => {
  const value = args.value ?? ''
  try {
    const page = await getPage()
    if (args.selector) { await page.fill(args.selector, value, { timeout: 10_000 }); return `Filled "${args.selector}"` }
    if (args.label) { await page.getByLabel(args.label, { exact: false }).first().fill(value, { timeout: 10_000 }); return `Filled label "${args.label}"` }
    if (args.placeholder) { await page.getByPlaceholder(args.placeholder, { exact: false }).first().fill(value, { timeout: 10_000 }); return `Filled placeholder "${args.placeholder}"` }
    return 'Error: provide selector, label, or placeholder'
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── browser_read ──────────────────────────────────────────────────────────────

export const browserReadDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_read',
    description: 'Read the current page: title, URL, visible text, form fields, links.',
    parameters: {
      type: 'object',
      properties: {
        section: { type: 'string', description: 'Optional CSS selector to limit to a section.' },
      },
    },
  },
}

export const browserRead: ToolHandler = async (args) => {
  try {
    const page = await getPage()
    const root = args.section ?? 'body'
    const text = await page.evaluate((sel: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = (globalThis as any).document
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const el: any = doc.querySelector(sel)
      return el ? (el.innerText ?? el.textContent ?? '') : ''
    }, root)
    const fields = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = (globalThis as any).document
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return Array.from(doc.querySelectorAll('input, textarea, select')).slice(0, 20).map((el: any) => {
        const lbl = el.id ? doc.querySelector(`label[for="${el.id}"]`)?.textContent?.trim() : ''
        return { tag: el.tagName.toLowerCase(), type: el.type ?? '', name: el.name ?? '', id: el.id ?? '', placeholder: el.placeholder ?? '', label: lbl ?? '' }
      })
    })
    const links = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = (globalThis as any).document
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return Array.from(doc.querySelectorAll('a[href]')).slice(0, 15).map((a: any) => {
        return { text: (a.innerText ?? '').trim().slice(0, 60), href: a.href }
      }).filter((l: { text: string }) => l.text)
    })
    const fieldList = fields.map((f) => `  [${f.tag}] name="${f.name}" id="${f.id}" type="${f.type}" placeholder="${f.placeholder}" label="${f.label}"`).join('\n') || '  (none)'
    const linkList = links.map((l) => `  ${l.text} → ${l.href}`).join('\n') || '  (none)'
    return `URL: ${page.url()}\nTitle: ${await page.title()}\n\nText:\n${text.replace(/\s{3,}/g, '\n').trim().slice(0, 4000)}\n\nFields:\n${fieldList}\n\nLinks:\n${linkList}`
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── browser_screenshot ────────────────────────────────────────────────────────

export const browserScreenshotDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_screenshot',
    description: 'Screenshot the current Playwright page to the Desktop.',
    parameters: {
      type: 'object',
      properties: { filename: { type: 'string', description: 'Optional filename (no extension).' } },
    },
  },
}

export const browserScreenshot: ToolHandler = async (args) => {
  try {
    const page = await getPage()
    const dest = join(homedir(), 'Desktop', `${(args.filename ?? 'browser-screenshot').replace(/[^\w-]/g, '_')}.png`)
    await page.screenshot({ path: dest })
    return `Saved: ${dest} — URL: ${page.url()}`
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── browser_eval ──────────────────────────────────────────────────────────────

export const browserEvalDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_eval',
    description: 'Execute JavaScript in the current page and return the result.',
    parameters: {
      type: 'object',
      properties: { code: { type: 'string', description: 'JavaScript to evaluate.' } },
      required: ['code'],
    },
  },
}

export const browserEval: ToolHandler = async (args) => {
  if (!args.code) return 'Error: code is required'
  try {
    const page = await getPage()
    return `Result: ${JSON.stringify(await page.evaluate(args.code), null, 2)}`
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── browser_wait ──────────────────────────────────────────────────────────────

export const browserWaitDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_wait',
    description: 'Wait for a CSS selector to appear/disappear on the page.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector to wait for.' },
        timeout: { type: 'string', description: 'Seconds (default 15).' },
        state: { type: 'string', description: 'visible (default), hidden, attached, detached.' },
      },
      required: ['selector'],
    },
  },
}

export const browserWait: ToolHandler = async (args) => {
  if (!args.selector) return 'Error: selector required'
  try {
    const page = await getPage()
    const state = (args.state ?? 'visible') as 'visible' | 'hidden' | 'attached' | 'detached'
    await page.waitForSelector(args.selector, { timeout: (parseInt(args.timeout ?? '15', 10) || 15) * 1000, state })
    return `"${args.selector}" is now ${state}`
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── browser_select ────────────────────────────────────────────────────────────

export const browserSelectDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_select',
    description: 'Select a dropdown option by value or label.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for <select>.' },
        value: { type: 'string', description: 'Option value.' },
        label: { type: 'string', description: 'Visible option label.' },
      },
      required: ['selector'],
    },
  },
}

export const browserSelect: ToolHandler = async (args) => {
  if (!args.selector) return 'Error: selector required'
  try {
    const page = await getPage()
    if (args.value) { await page.selectOption(args.selector, { value: args.value }, { timeout: 10_000 }); return `Selected value "${args.value}"` }
    if (args.label) { await page.selectOption(args.selector, { label: args.label }, { timeout: 10_000 }); return `Selected label "${args.label}"` }
    return 'Error: provide value or label'
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── browser_close ─────────────────────────────────────────────────────────────

export const browserCloseDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_close',
    description: 'Close the entire Playwright browser session.',
    parameters: { type: 'object', properties: {} },
  },
}

export const browserClose: ToolHandler = async (_args) => { await closeBrowserSession(); return 'Browser closed.' }

// ── browser_new_tab ───────────────────────────────────────────────────────────

export const browserNewTabDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_new_tab',
    description: 'Open a new browser tab and optionally navigate to a URL.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'Optional URL to open.' } },
    },
  },
}

export const browserNewTab: ToolHandler = async (args) => {
  try {
    if (!_browser || !_browser.isConnected()) await getPage()
    const page = await _browser!.newPage()
    await page.setViewportSize({ width: 1280, height: 800 })
    _pages.push(page)
    _currentTab = _pages.length - 1
    if (args.url) await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    return `New tab ${_currentTab}: ${page.url()}`
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── browser_tabs ─────────────────────────────────────────────────────────────

export const browserTabsDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_tabs',
    description: 'List all open browser tabs with their index, title, URL, and active status.',
    parameters: { type: 'object', properties: {} },
  },
}

export const browserTabs: ToolHandler = async (_args) => {
  if (_pages.length === 0) return 'No tabs open.'
  const lines = await Promise.all(_pages.map(async (p, i) => {
    if (p.isClosed()) return `  [${i}] (closed)`
    return `  [${i}]${i === _currentTab ? ' ←' : '  '} ${await p.title().catch(() => '?')} — ${p.url()}`
  }))
  return lines.join('\n')
}

// ── browser_switch_tab ────────────────────────────────────────────────────────

export const browserSwitchTabDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_switch_tab',
    description: 'Switch to a browser tab by index.',
    parameters: {
      type: 'object',
      properties: { index: { type: 'string', description: 'Tab index (0-based).' } },
      required: ['index'],
    },
  },
}

export const browserSwitchTab: ToolHandler = async (args) => {
  const idx = parseInt(args.index ?? '0', 10)
  _pages = _pages.filter((p) => !p.isClosed())
  if (idx < 0 || idx >= _pages.length) return `Error: no tab ${idx}. ${_pages.length} open.`
  _currentTab = idx
  return `Switched to tab ${idx}: ${await _pages[idx].title()} (${_pages[idx].url()})`
}

// ── browser_close_tab ─────────────────────────────────────────────────────────

export const browserCloseTabDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_close_tab',
    description: 'Close a browser tab by index (defaults to current tab).',
    parameters: {
      type: 'object',
      properties: { index: { type: 'string', description: 'Tab index to close.' } },
    },
  },
}

export const browserCloseTab: ToolHandler = async (args) => {
  const idx = args.index != null ? parseInt(args.index, 10) : _currentTab
  if (idx < 0 || idx >= _pages.length) return `Error: no tab ${idx}`
  await _pages[idx].close().catch(() => {})
  _pages.splice(idx, 1)
  if (_currentTab >= _pages.length) _currentTab = Math.max(0, _pages.length - 1)
  return `Closed tab ${idx}. ${_pages.length} remaining.`
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADVANCED PLAYWRIGHT TOOLS
// ═══════════════════════════════════════════════════════════════════════════════

// ── browser_connect_chrome ────────────────────────────────────────────────────
// Connect to the user's REAL Chrome/Edge (with all logins, Gmail, etc.).
// Relaunches the browser with --remote-debugging-port so Playwright can attach.

export const browserConnectChromeDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_connect_chrome',
    description:
      "Connect Playwright to the user's real Chrome browser (with all their logins, Gmail, etc.). Closes Chrome, relaunches it with debugging enabled, then connects. After this, all browser_* tools operate in the user's real Chrome with their actual sessions.",
    parameters: {
      type: 'object',
      properties: {
        browser: { type: 'string', description: 'chrome (default) or edge.' },
      },
    },
  },
}

export const browserConnectChrome: ToolHandler = async (args) => {
  const { chromium } = await import('playwright')
  const { spawn, execSync } = await import('node:child_process')

  const useEdge = (args.browser ?? 'chrome').toLowerCase() === 'edge'
  const procName = useEdge ? 'msedge' : 'chrome'
  const exePath = useEdge
    ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    : 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

  // Close existing instance
  try { execSync(`taskkill /F /IM ${procName}.exe 2>nul`, { stdio: 'ignore' }) } catch { /* ok */ }
  await new Promise(r => setTimeout(r, 1200))

  // Relaunch with debugging port
  spawn(exePath, ['--remote-debugging-port=9222', '--restore-last-session'], {
    detached: true, stdio: 'ignore',
  }).unref()
  await new Promise(r => setTimeout(r, 2500))

  // Connect Playwright
  try {
    if (_browser) await _browser.close().catch(() => {})
    _browser = await chromium.connectOverCDP('http://localhost:9222')
    const ctx = _browser.contexts()[0] ?? await _browser.newContext()
    _pages = ctx.pages()
    _currentTab = 0
    if (_pages.length === 0) {
      const p = await ctx.newPage()
      _pages.push(p)
    }
    return `Connected to ${useEdge ? 'Edge' : 'Chrome'} with ${_pages.length} existing tab(s). All your sessions and logins are available.`
  } catch (err) {
    return `Error connecting: ${err instanceof Error ? err.message : String(err)}\nMake sure Chrome/Edge is installed at the default path.`
  }
}

// ── browser_type ──────────────────────────────────────────────────────────────

export const browserTypeDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_type',
    description: 'Type text character-by-character (like a human). Better than browser_fill for rich-text editors (Gmail compose, Google Docs, etc.).',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to type.' },
        selector: { type: 'string', description: 'CSS selector of element to type into (clicks it first).' },
        delay_ms: { type: 'string', description: 'Delay between keystrokes in ms (default 30).' },
      },
      required: ['text'],
    },
  },
}

export const browserType: ToolHandler = async (args) => {
  const text = args.text ?? ''
  const delay = parseInt(args.delay_ms ?? '30', 10) || 30
  try {
    const page = await getPage()
    if (args.selector) await page.click(args.selector, { timeout: 8_000 })
    await page.keyboard.type(text, { delay })
    return `Typed ${text.length} characters.`
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── browser_key ───────────────────────────────────────────────────────────────

export const browserKeyDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_key',
    description: 'Press a keyboard shortcut or key. Examples: "Enter", "Escape", "Control+a", "Control+Enter", "Tab", "Backspace", "ArrowDown".',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key or shortcut to press.' },
      },
      required: ['key'],
    },
  },
}

export const browserKey: ToolHandler = async (args) => {
  if (!args.key) return 'Error: key required'
  try {
    const page = await getPage()
    await page.keyboard.press(args.key)
    return `Pressed: ${args.key}`
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── browser_hover ─────────────────────────────────────────────────────────────

export const browserHoverDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_hover',
    description: 'Hover the mouse over an element to reveal tooltips, dropdowns, or hover menus.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector.' },
        text: { type: 'string', description: 'Visible text of element.' },
      },
    },
  },
}

export const browserHover: ToolHandler = async (args) => {
  try {
    const page = await getPage()
    if (args.selector) { await page.hover(args.selector, { timeout: 8_000 }); return `Hovered: ${args.selector}` }
    if (args.text) { await page.getByText(args.text, { exact: false }).first().hover({ timeout: 8_000 }); return `Hovered text: "${args.text}"` }
    return 'Error: provide selector or text'
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── browser_scroll ────────────────────────────────────────────────────────────

export const browserScrollDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_scroll',
    description: 'Scroll the page up, down, to the top, to the bottom, or to a specific element.',
    parameters: {
      type: 'object',
      properties: {
        direction: { type: 'string', description: 'up, down, top, bottom (default: down).' },
        amount: { type: 'string', description: 'Pixels to scroll (default 600).' },
        selector: { type: 'string', description: 'Scroll to bring this CSS selector into view.' },
      },
    },
  },
}

export const browserScroll: ToolHandler = async (args) => {
  try {
    const page = await getPage()
    if (args.selector) {
      await page.locator(args.selector).first().scrollIntoViewIfNeeded({ timeout: 8_000 })
      return `Scrolled to: ${args.selector}`
    }
    const amt = parseInt(args.amount ?? '600', 10) || 600
    const dir = args.direction ?? 'down'
    if (dir === 'top') { await page.evaluate(() => (globalThis as any).window.scrollTo(0, 0)); return 'Scrolled to top' }
    if (dir === 'bottom') { await page.evaluate(() => { const w = (globalThis as any).window; w.scrollTo(0, w.document.body.scrollHeight) }); return 'Scrolled to bottom' }
    const delta = dir === 'up' ? -amt : amt
    await page.evaluate((dy: number) => (globalThis as any).window.scrollBy(0, dy), delta)
    return `Scrolled ${dir} ${amt}px`
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── browser_check ─────────────────────────────────────────────────────────────

export const browserCheckDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_check',
    description: 'Check or uncheck a checkbox or radio button.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the checkbox.' },
        checked: { type: 'string', description: 'true to check, false to uncheck (default true).' },
      },
      required: ['selector'],
    },
  },
}

export const browserCheck: ToolHandler = async (args) => {
  if (!args.selector) return 'Error: selector required'
  try {
    const page = await getPage()
    const shouldCheck = args.checked !== 'false'
    if (shouldCheck) { await page.check(args.selector, { timeout: 8_000 }) }
    else { await page.uncheck(args.selector, { timeout: 8_000 }) }
    return `${shouldCheck ? 'Checked' : 'Unchecked'}: ${args.selector}`
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── browser_get_text ──────────────────────────────────────────────────────────

export const browserGetTextDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_get_text',
    description: 'Get the inner text or value of a specific element by CSS selector.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector.' },
        all: { type: 'string', description: 'Set to "true" to get text from all matching elements.' },
      },
      required: ['selector'],
    },
  },
}

export const browserGetText: ToolHandler = async (args) => {
  if (!args.selector) return 'Error: selector required'
  try {
    const page = await getPage()
    if (args.all === 'true') {
      const texts = await page.locator(args.selector).allInnerTexts()
      return texts.join('\n')
    }
    return await page.locator(args.selector).first().innerText({ timeout: 8_000 })
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── browser_get_attr ──────────────────────────────────────────────────────────

export const browserGetAttrDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_get_attr',
    description: 'Get an HTML attribute value from an element (e.g. href, src, value, data-*).',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector.' },
        attr: { type: 'string', description: 'Attribute name (e.g. "href", "value", "src").' },
      },
      required: ['selector', 'attr'],
    },
  },
}

export const browserGetAttr: ToolHandler = async (args) => {
  if (!args.selector || !args.attr) return 'Error: selector and attr required'
  try {
    const page = await getPage()
    const val = await page.locator(args.selector).first().getAttribute(args.attr, { timeout: 8_000 })
    return val ?? '(attribute not found)'
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── browser_extract_table ─────────────────────────────────────────────────────

export const browserExtractTableDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_extract_table',
    description: 'Extract all rows from an HTML table on the page as structured data.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for <table> (default: first table on page).' },
      },
    },
  },
}

export const browserExtractTable: ToolHandler = async (args) => {
  try {
    const page = await getPage()
    const sel = args.selector ?? 'table'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await page.evaluate((s: string) => {
      const doc = (globalThis as any).document
      const table = doc.querySelector(s)
      if (!table) return null
      const rows = Array.from(table.querySelectorAll('tr'))
      return rows.map((row: any) =>
        Array.from(row.querySelectorAll('td,th')).map((cell: any) => cell.innerText?.trim() ?? '')
      )
    }, sel)
    if (!data) return `No table found: ${sel}`
    const [headers, ...rows] = data as string[][]
    return [`Headers: ${(headers ?? []).join(' | ')}`, ...rows.map((r) => r.join(' | '))].join('\n')
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── browser_find_text ─────────────────────────────────────────────────────────

export const browserFindTextDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_find_text',
    description: 'Search for text on the current page and return whether it was found, and surrounding context.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to find.' },
      },
      required: ['text'],
    },
  },
}

export const browserFindText: ToolHandler = async (args) => {
  if (!args.text) return 'Error: text required'
  try {
    const page = await getPage()
    const found = await page.getByText(args.text, { exact: false }).first().isVisible().catch(() => false)
    if (!found) return `Text not found: "${args.text}"`
    const ctx = await page.getByText(args.text, { exact: false }).first().evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (el: any) => (el.closest('p,li,div,td,h1,h2,h3,span') ?? el).innerText?.trim().slice(0, 300) ?? ''
    ).catch(() => '')
    return `Found: "${args.text}"\nContext: ${ctx}`
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── browser_upload ────────────────────────────────────────────────────────────

export const browserUploadDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_upload',
    description: 'Upload a local file to a file input on the page.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the file <input>.' },
        file: { type: 'string', description: 'Absolute path to the file to upload.' },
      },
      required: ['selector', 'file'],
    },
  },
}

export const browserUpload: ToolHandler = async (args) => {
  if (!args.selector || !args.file) return 'Error: selector and file required'
  try {
    const page = await getPage()
    await page.setInputFiles(args.selector, args.file, { timeout: 10_000 })
    return `Uploaded: ${args.file} → ${args.selector}`
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── browser_dialog ────────────────────────────────────────────────────────────

export const browserDialogDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_dialog',
    description: 'Handle the next browser dialog (alert, confirm, prompt). Must call BEFORE the action that triggers the dialog.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'accept (default) or dismiss.' },
        prompt_text: { type: 'string', description: 'Text to enter if dialog is a prompt().' },
      },
    },
  },
}

export const browserDialog: ToolHandler = async (args) => {
  try {
    const page = await getPage()
    const action = args.action ?? 'accept'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    page.once('dialog', async (dialog: any) => {
      if (action === 'dismiss') await dialog.dismiss()
      else await dialog.accept(args.prompt_text ?? '')
    })
    return `Set to ${action} next dialog.`
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── browser_pdf ───────────────────────────────────────────────────────────────

export const browserPdfDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_pdf',
    description: 'Save the current page as a PDF to the Desktop.',
    parameters: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Output filename (no extension).' },
      },
    },
  },
}

export const browserPdf: ToolHandler = async (args) => {
  try {
    const page = await getPage()
    const dest = join(homedir(), 'Desktop', `${(args.filename ?? 'page').replace(/[^\w-]/g, '_')}.pdf`)
    await page.pdf({ path: dest, format: 'A4', printBackground: true })
    return `Saved PDF: ${dest}`
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── browser_read_emails (Gmail) ───────────────────────────────────────────────

export const browserReadEmailsDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_read_emails',
    description:
      'Read emails from Gmail (or any webmail) currently open in the Playwright browser. First use browser_go to open Gmail or browser_connect_chrome to use real Chrome with logins.',
    parameters: {
      type: 'object',
      properties: {
        count: { type: 'string', description: 'Max emails to retrieve (default 10).' },
        unread_only: { type: 'string', description: 'Set to "true" for unread only.' },
      },
    },
  },
}

export const browserReadEmails: ToolHandler = async (args) => {
  const count = parseInt(args.count ?? '10', 10) || 10
  try {
    const page = await getPage()
    const url = page.url()
    if (!url.includes('mail.google.com')) {
      return 'Not on Gmail. Navigate to https://mail.google.com first (or use browser_connect_chrome to use your real Chrome session).'
    }
    if (args.unread_only === 'true') {
      await page.goto('https://mail.google.com/mail/u/0/#inbox', { waitUntil: 'networkidle', timeout: 20_000 })
    }
    await page.waitForSelector('tr.zA', { timeout: 15_000 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emails = await page.evaluate((n: number) => {
      const doc = (globalThis as any).document
      return Array.from(doc.querySelectorAll('tr.zA')).slice(0, n).map((row: any) => ({
        unread: row.classList.contains('zE'),
        from: row.querySelector('.yP, .zF')?.textContent?.trim() ?? '',
        subject: row.querySelector('.bog span, .y6 span')?.textContent?.trim() ?? row.querySelector('.bog')?.textContent?.trim() ?? '',
        snippet: row.querySelector('.y2')?.textContent?.trim() ?? '',
        time: row.querySelector('.xW span, .xW')?.getAttribute('title') ?? row.querySelector('.xW')?.textContent?.trim() ?? '',
      }))
    }, count)
    if (!emails.length) return 'No emails visible. Make sure Gmail is loaded.'
    return emails
      .map((e: { unread: boolean; from: string; subject: string; snippet: string; time: string }, i: number) =>
        `[${i + 1}]${e.unread ? ' ★' : ''} From: ${e.from}\n   Subject: ${e.subject}\n   ${e.snippet}\n   ${e.time}`
      )
      .join('\n\n')
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── browser_click_email ───────────────────────────────────────────────────────

export const browserClickEmailDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_click_email',
    description: 'Open an email in Gmail by its position in the inbox list (1 = first/most recent).',
    parameters: {
      type: 'object',
      properties: {
        index: { type: 'string', description: 'Email position in list (1-based).' },
      },
      required: ['index'],
    },
  },
}

export const browserClickEmail: ToolHandler = async (args) => {
  const idx = (parseInt(args.index ?? '1', 10) || 1) - 1
  try {
    const page = await getPage()
    await page.waitForSelector('tr.zA', { timeout: 10_000 })
    const rows = await page.locator('tr.zA').all()
    if (idx >= rows.length) return `Only ${rows.length} emails visible.`
    await rows[idx].click()
    await page.waitForSelector('.h7', { timeout: 10_000 }).catch(() => {})
    // Read the email body
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = await page.evaluate(() => {
      const doc = (globalThis as any).document
      return doc.querySelector('.a3s.aiL')?.innerText?.trim().slice(0, 3000) ?? doc.querySelector('.ii.gt')?.innerText?.trim().slice(0, 3000) ?? '(could not read email body)'
    })
    const subject = await page.locator('h2.hP').first().innerText({ timeout: 5_000 }).catch(() => '?')
    return `Subject: ${subject}\n\n${body}`
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── browser_compose_reply ─────────────────────────────────────────────────────

export const browserComposeReplyDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_compose_reply',
    description: 'Reply to the currently open email in Gmail. Call browser_click_email first to open it.',
    parameters: {
      type: 'object',
      properties: {
        body: { type: 'string', description: 'Reply text to type.' },
        send: { type: 'string', description: 'Set to "true" to send immediately. Default: leave as draft.' },
      },
      required: ['body'],
    },
  },
}

export const browserComposeReply: ToolHandler = async (args) => {
  if (!args.body) return 'Error: body required'
  try {
    const page = await getPage()
    // Click Reply button
    await page.locator('[data-tooltip="Reply"], [aria-label*="Reply"]').first().click({ timeout: 8_000 })
    await page.waitForSelector('[role="textbox"][aria-label*="Message Body"], .Am.Al.editable', { timeout: 8_000 })
    await page.locator('[role="textbox"][aria-label*="Message Body"], .Am.Al.editable').first().click()
    await page.keyboard.type(args.body, { delay: 20 })
    if (args.send === 'true') {
      await page.locator('[data-tooltip="Send"], [aria-label*="Send"]').first().click({ timeout: 8_000 })
      return 'Reply sent.'
    }
    return 'Reply composed. Review it and click Send when ready.'
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}


