import { join } from 'node:path'
import { homedir } from 'node:os'
import type { ToolDefinition, ToolHandler } from './types.js'
import fs from 'node:fs'
import type { Browser, Locator, Page } from 'playwright'

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

type TargetArgs = {
  selector?: string
  text?: string
  label?: string
  placeholder?: string
  role?: string
  name?: string
  test_id?: string
}

type ResolvedTarget = {
  locator: Locator
  description: string
}

const TARGET_TIMEOUT = 10_000

const EDITABLE_SELECTOR = 'input:not([type="hidden"]), textarea, select, [contenteditable="true"], [role="textbox"], [role="searchbox"], [role="combobox"]'

async function firstVisibleLocator(page: Page, selectors: string[], description: string): Promise<ResolvedTarget | null> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first()
    const visible = await locator.isVisible({ timeout: 700 }).catch(() => false)
    if (visible) return { locator, description }
  }
  return null
}

async function resolveInputTarget(page: Page, args: TargetArgs): Promise<ResolvedTarget | null> {
  const explicit = resolveTarget(page, args)
  if (explicit) return explicit

  const focused = await firstVisibleLocator(page, [
    `${EDITABLE_SELECTOR}:focus`,
    '[aria-expanded="true"] input:not([type="hidden"]):focus',
  ], 'focused editable element')
  if (focused) return focused

  return firstVisibleLocator(page, [
    'input[type="search"]',
    '[role="searchbox"]',
    'input[placeholder*="Search" i]',
    'textarea[placeholder*="Search" i]',
    'input:not([type="hidden"]):not([disabled])',
    'textarea:not([disabled])',
    '[contenteditable="true"]',
    '[role="textbox"]',
  ], 'first visible editable/search field')
}

async function editableValue(target: ResolvedTarget): Promise<string> {
  return target.locator.evaluate((el: any) => {
    const anyEl = el as any
    if ('value' in anyEl) return String(anyEl.value ?? '')
    return anyEl.innerText || anyEl.textContent || ''
  }).catch(() => '')
}

function resolveTarget(page: Page, args: TargetArgs): ResolvedTarget | null {
  if (args.selector) return { locator: page.locator(args.selector).first(), description: `selector "${args.selector}"` }
  if (args.test_id) return { locator: page.getByTestId(args.test_id).first(), description: `test id "${args.test_id}"` }
  if (args.role && args.name) return { locator: page.getByRole(args.role as any, { name: args.name, exact: false }).first(), description: `role "${args.role}" named "${args.name}"` }
  if (args.label) return { locator: page.getByLabel(args.label, { exact: false }).first(), description: `label "${args.label}"` }
  if (args.placeholder) return { locator: page.getByPlaceholder(args.placeholder, { exact: false }).first(), description: `placeholder "${args.placeholder}"` }
  if (args.text) return { locator: page.getByText(args.text, { exact: false }).first(), description: `text "${args.text}"` }
  return null
}

async function visibleTargetHints(page: Page): Promise<string> {
  const hints = await page.evaluate(() => {
    const doc = (globalThis as any).document
    const css = (globalThis as any).CSS
    const getStyle = (globalThis as any).getComputedStyle
    const cssPath = (el: any) => {
      if (el.id) return `#${css.escape(el.id)}`
      if (el.name) return `${el.tagName.toLowerCase()}[name="${css.escape(el.name)}"]`
      const label = el.getAttribute('aria-label') || el.getAttribute('title')
      if (label) return `${el.tagName.toLowerCase()}[aria-label*="${css.escape(label.slice(0, 30))}" i]`
      return el.tagName.toLowerCase()
    }
    return Array.from(doc.querySelectorAll('button, a[href], input, textarea, select, [contenteditable="true"], [role="button"], [role="link"], [role="textbox"], [role="searchbox"], [role="combobox"], [aria-label]'))
      .filter((el: any) => {
        const rect = el.getBoundingClientRect()
        const style = getStyle(el)
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
      })
      .slice(0, 16)
      .map((el: any) => {
        const tag = el.tagName.toLowerCase()
        const role = el.getAttribute('role') ?? ''
        const label = el.getAttribute('aria-label') ?? ''
        const text = (el.innerText ?? el.value ?? el.placeholder ?? '').trim().replace(/\s+/g, ' ').slice(0, 80)
        const id = el.id ? `#${el.id}` : ''
        const name = el.name ? `[name="${el.name}"]` : ''
        return [cssPath(el), tag + id + name, role && `role=${role}`, label && `aria-label="${label}"`, text && `text="${text}"`]
          .filter(Boolean)
          .join(' ')
      })
      .filter(Boolean)
  }).catch(() => [])
  return hints.length ? hints.map((hint, i) => `  ${i + 1}. ${hint}`).join('\n') : '  (no common clickable/input targets found)'
}

async function browserTargetError(page: Page, action: string, target: ResolvedTarget | null, err: unknown): Promise<string> {
  const message = err instanceof Error ? err.message : String(err)
  return [
    `Error: Could not ${action}${target ? ` ${target.description}` : ''}.`,
    `Reason: ${message}`,
    `URL: ${page.url()}`,
    `Title: ${await page.title().catch(() => '(unknown)')}`,
    'Visible targets:',
    await visibleTargetHints(page),
  ].join('\n')
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
    description: 'Click an element by CSS selector, text, label, placeholder, ARIA role/name, or test id. Returns visible target hints when the click fails.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector.' },
        text: { type: 'string', description: 'Visible text of element.' },
        label: { type: 'string', description: 'Accessible label text.' },
        placeholder: { type: 'string', description: 'Placeholder text.' },
        role: { type: 'string', description: 'ARIA role, such as button, link, checkbox, textbox, tab, menuitem.' },
        name: { type: 'string', description: 'Accessible name to use with role.' },
        test_id: { type: 'string', description: 'data-testid value.' },
      },
    },
  },
}

export const browserClick: ToolHandler = async (args) => {
  let page: Page | null = null
  let target: ResolvedTarget | null = null
  try {
    page = await getPage()
    target = resolveTarget(page, args)
    if (!target) return 'Error: provide selector, text, label, placeholder, role + name, or test_id'
    await target.locator.click({ timeout: TARGET_TIMEOUT })
    return `Clicked ${target.description}`
  } catch (err) { return page ? browserTargetError(page, 'click', target, err) : `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── browser_fill ──────────────────────────────────────────────────────────────

export const browserFillDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_fill',
    description: 'Fill a text input. Target by CSS selector, label, placeholder, ARIA role/name, test id, or visible text.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector.' },
        label: { type: 'string', description: 'Label text.' },
        placeholder: { type: 'string', description: 'Placeholder text.' },
        text: { type: 'string', description: 'Visible text near or inside the field.' },
        role: { type: 'string', description: 'ARIA role, usually textbox, searchbox, combobox, or spinbutton.' },
        name: { type: 'string', description: 'Accessible name to use with role.' },
        test_id: { type: 'string', description: 'data-testid value.' },
        value: { type: 'string', description: 'Text to type.' },
      },
      required: ['value'],
    },
  },
}

export const browserFill: ToolHandler = async (args) => {
  const value = args.value ?? ''
  let page: Page | null = null
  let target: ResolvedTarget | null = null
  try {
    page = await getPage()
    target = await resolveInputTarget(page, args)
    if (!target) return 'Error: provide selector, label, placeholder, text, role + name, or test_id, or focus an editable field first'
    await target.locator.fill(value, { timeout: TARGET_TIMEOUT })
    const actual = await editableValue(target)
    const verified = actual.includes(value) || actual === value
    return `Filled ${target.description}${verified ? `\nVerified value: ${actual.slice(0, 160)}` : `\nWarning: typed value could not be verified; current value: ${actual.slice(0, 160)}`}`
  } catch (err) { return page ? browserTargetError(page, 'fill', target, err) : `Error: ${err instanceof Error ? err.message : String(err)}` }
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

// ── browser_assert ───────────────────────────────────────────────────────────

export const browserAssertDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_assert',
    description: 'Assert browser page state for automation verification. Supports URL/title checks, text visibility, selector visibility/count, and attribute equality.',
    parameters: {
      type: 'object',
      properties: {
        assertion: {
          type: 'string',
          description: 'Assertion type.',
          enum: ['url_contains', 'url_equals', 'title_contains', 'text_visible', 'text_absent', 'selector_visible', 'selector_hidden', 'selector_count', 'attr_equals'],
        },
        value: { type: 'string', description: 'Expected URL/title/text fragment depending on assertion.' },
        selector: { type: 'string', description: 'CSS selector for selector_* and attr_equals assertions.' },
        attr: { type: 'string', description: 'Attribute name for attr_equals.' },
        expected: { type: 'string', description: 'Expected attribute value for attr_equals.' },
        count: { type: 'string', description: 'Expected element count for selector_count.' },
        timeout: { type: 'string', description: 'Timeout in seconds for visibility checks (default 8).' },
      },
      required: ['assertion'],
    },
  },
}

async function assertionFailure(page: Page, message: string): Promise<string> {
  return [
    `FAIL: ${message}`,
    `URL: ${page.url()}`,
    `Title: ${await page.title().catch(() => '(unknown)')}`,
    'Visible targets:',
    await visibleTargetHints(page),
  ].join('\n')
}

export const browserAssert: ToolHandler = async (args) => {
  const assertion = args.assertion ?? ''
  const timeout = (parseInt(args.timeout ?? '8', 10) || 8) * 1000
  try {
    const page = await getPage()
    const title = await page.title().catch(() => '')
    const url = page.url()

    if (assertion === 'url_contains') {
      if (!args.value) return 'Error: value required for url_contains'
      return url.includes(args.value) ? `PASS: URL contains "${args.value}"` : assertionFailure(page, `URL did not contain "${args.value}"`)
    }
    if (assertion === 'url_equals') {
      if (!args.value) return 'Error: value required for url_equals'
      return url === args.value ? `PASS: URL equals "${args.value}"` : assertionFailure(page, `URL was "${url}" instead of "${args.value}"`)
    }
    if (assertion === 'title_contains') {
      if (!args.value) return 'Error: value required for title_contains'
      return title.includes(args.value) ? `PASS: title contains "${args.value}"` : assertionFailure(page, `Title did not contain "${args.value}"`)
    }
    if (assertion === 'text_visible') {
      if (!args.value) return 'Error: value required for text_visible'
      const visible = await page.getByText(args.value, { exact: false }).first().isVisible({ timeout }).catch(() => false)
      return visible ? `PASS: text visible "${args.value}"` : assertionFailure(page, `Text was not visible: "${args.value}"`)
    }
    if (assertion === 'text_absent') {
      if (!args.value) return 'Error: value required for text_absent'
      const visible = await page.getByText(args.value, { exact: false }).first().isVisible({ timeout: Math.min(timeout, 1500) }).catch(() => false)
      return !visible ? `PASS: text absent "${args.value}"` : assertionFailure(page, `Text was visible but expected absent: "${args.value}"`)
    }
    if (assertion === 'selector_visible') {
      if (!args.selector) return 'Error: selector required for selector_visible'
      const visible = await page.locator(args.selector).first().isVisible({ timeout }).catch(() => false)
      return visible ? `PASS: selector visible "${args.selector}"` : assertionFailure(page, `Selector was not visible: "${args.selector}"`)
    }
    if (assertion === 'selector_hidden') {
      if (!args.selector) return 'Error: selector required for selector_hidden'
      const hidden = await page.locator(args.selector).first().isHidden({ timeout }).catch(() => false)
      return hidden ? `PASS: selector hidden "${args.selector}"` : assertionFailure(page, `Selector was visible but expected hidden: "${args.selector}"`)
    }
    if (assertion === 'selector_count') {
      if (!args.selector || !args.count) return 'Error: selector and count required for selector_count'
      const actual = await page.locator(args.selector).count()
      const expected = parseInt(args.count, 10)
      if (!Number.isFinite(expected)) return 'Error: count must be a number'
      return actual === expected ? `PASS: selector "${args.selector}" count is ${expected}` : assertionFailure(page, `Selector "${args.selector}" count was ${actual}, expected ${expected}`)
    }
    if (assertion === 'attr_equals') {
      if (!args.selector || !args.attr || args.expected == null) return 'Error: selector, attr, and expected required for attr_equals'
      const actual = await page.locator(args.selector).first().getAttribute(args.attr, { timeout }).catch(() => null)
      return actual === args.expected ? `PASS: ${args.selector} ${args.attr} equals "${args.expected}"` : assertionFailure(page, `${args.selector} ${args.attr} was "${actual ?? '(missing)'}", expected "${args.expected}"`)
    }

    return 'Error: assertion must be one of url_contains, url_equals, title_contains, text_visible, text_absent, selector_visible, selector_hidden, selector_count, attr_equals'
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── browser_snapshot ─────────────────────────────────────────────────────────

export const browserSnapshotDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_snapshot',
    description: 'Return a structured snapshot of the current page: URL, title, headings, fields, buttons, links, and landmark-like regions. Useful before deciding the next browser action.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'Optional CSS selector to scope the snapshot.' },
        limit: { type: 'string', description: 'Maximum items per category (default 20).' },
        include_text: { type: 'string', description: 'Set to "true" to include a compact text excerpt.' },
      },
    },
  },
}

export const browserSnapshot: ToolHandler = async (args) => {
  const limit = Math.min(60, Math.max(1, parseInt(args.limit ?? '20', 10) || 20))
  try {
    const page = await getPage()
    const snapshot = await page.evaluate(({ selector, limit, includeText }) => {
      const doc = (globalThis as any).document
      const root = selector ? doc.querySelector(selector) : doc.body
      if (!root) return { error: `No element matched selector: ${selector}` }
      const clean = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim()
      const summarize = (el: any) => ({
        tag: el.tagName.toLowerCase(),
        id: el.id || undefined,
        name: el.name || undefined,
        role: el.getAttribute('role') || undefined,
        label: el.getAttribute('aria-label') || el.getAttribute('title') || undefined,
        text: clean(el.innerText || el.value || el.placeholder).slice(0, 120) || undefined,
        href: el.href || undefined,
      })
      const query = (sel: string) => Array.from(root.querySelectorAll(sel)).slice(0, limit).map(summarize)
      return {
        headings: query('h1,h2,h3,[role="heading"]'),
        fields: query('input,textarea,select,[contenteditable="true"],[role="textbox"],[role="combobox"],[role="searchbox"]'),
        buttons: query('button,[role="button"],input[type="button"],input[type="submit"]'),
        links: query('a[href],[role="link"]'),
        regions: query('main,nav,aside,section,form,[role="main"],[role="navigation"],[role="dialog"],[role="form"]'),
        text: includeText ? clean(root.innerText || root.textContent).slice(0, 1500) : undefined,
      }
    }, { selector: args.selector, limit, includeText: args.include_text === 'true' })
    if ('error' in snapshot) return `Error: ${snapshot.error}`
    return JSON.stringify({ url: page.url(), title: await page.title(), ...snapshot }, null, 2)
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── browser_find_targets ─────────────────────────────────────────────────────

export const browserFindTargetsDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_find_targets',
    description: 'Find actionable page targets for clicking, typing, selecting, or searching. Returns stable selector hints, roles, labels, text, and scores. Use before browser_click/browser_fill/browser_type on complex pages such as Salesforce, Gmail, dashboards, and SPAs.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional text to match against labels, placeholders, visible text, hrefs, names, ids, and roles.' },
        kind: { type: 'string', description: 'Optional filter: any, input, button, link, select, text.' },
        limit: { type: 'string', description: 'Maximum targets to return (default 25, max 80).' },
      },
    },
  },
}

export const browserFindTargets: ToolHandler = async (args) => {
  const query = (args.query ?? '').trim().toLowerCase()
  const kind = (args.kind ?? 'any').trim().toLowerCase()
  const limit = Math.min(80, Math.max(1, parseInt(args.limit ?? '25', 10) || 25))
  try {
    const page = await getPage()
    await page.evaluate('globalThis.__name = globalThis.__name || ((value) => value)').catch(() => {})
    const targets = await page.evaluate(({ query, kind, limit }) => {
      const __name = (value: unknown) => value
      void __name
      const doc = (globalThis as any).document
      const css = (globalThis as any).CSS
      const getStyle = (globalThis as any).getComputedStyle
      const clean = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim()
      const cssPath = (el: any) => {
        if (el.id) return `#${css.escape(el.id)}`
        if (el.getAttribute('data-testid')) return `[data-testid="${css.escape(el.getAttribute('data-testid'))}"]`
        if (el.name) return `${el.tagName.toLowerCase()}[name="${css.escape(el.name)}"]`
        const aria = clean(el.getAttribute('aria-label')).slice(0, 40)
        if (aria) return `${el.tagName.toLowerCase()}[aria-label*="${css.escape(aria)}" i]`
        const text = clean(el.innerText || el.textContent).slice(0, 40)
        if (text && (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button')) return `button:has-text("${text.replace(/"/g, '\\"')}")`
        return el.tagName.toLowerCase()
      }
      const classify = (el: any) => {
        const tag = el.tagName.toLowerCase()
        const role = clean(el.getAttribute('role')).toLowerCase()
        const type = clean(el.type).toLowerCase()
        if (tag === 'a' || role === 'link') return 'link'
        if (tag === 'button' || role === 'button' || type === 'button' || type === 'submit') return 'button'
        if (tag === 'select' || role === 'combobox') return 'select'
        if (tag === 'input' || tag === 'textarea' || role === 'textbox' || role === 'searchbox' || el.isContentEditable) return 'input'
        return 'text'
      }
      const labelFor = (el: any) => {
        const id = el.id ? doc.querySelector(`label[for="${css.escape(el.id)}"]`)?.textContent : ''
        return clean(id || el.getAttribute('aria-label') || el.getAttribute('title') || el.placeholder || el.innerText || el.value || el.textContent)
      }
      const elements = Array.from(doc.querySelectorAll([
        'button', 'a[href]', 'input:not([type="hidden"])', 'textarea', 'select', '[contenteditable="true"]',
        '[role="button"]', '[role="link"]', '[role="textbox"]', '[role="searchbox"]', '[role="combobox"]', '[aria-label]', '[data-testid]',
      ].join(','))) as any[]
      return elements
        .map((el: any, index: number) => {
          const rect = el.getBoundingClientRect()
          const style = getStyle(el)
          const visible = rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
          if (!visible) return null
          const targetKind = classify(el)
          if (kind !== 'any' && kind && targetKind !== kind) return null
          const label = labelFor(el)
          const haystack = clean([label, el.placeholder, el.name, el.id, el.href, el.getAttribute('role'), el.getAttribute('data-testid')].join(' ')).toLowerCase()
          if (query && !haystack.includes(query)) return null
          let score = 1
          if (query && label.toLowerCase().includes(query)) score += 4
          if (query && clean(el.placeholder).toLowerCase().includes(query)) score += 3
          if (targetKind === 'input' && /search|find|lookup|filter/.test(haystack)) score += 2
          return {
            index,
            kind: targetKind,
            selector: cssPath(el),
            role: clean(el.getAttribute('role')) || undefined,
            label: label.slice(0, 120) || undefined,
            placeholder: clean(el.placeholder).slice(0, 120) || undefined,
            text: clean(el.innerText || el.textContent).slice(0, 160) || undefined,
            href: el.href || undefined,
            score,
          }
        })
        .filter(Boolean)
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, limit)
    }, { query, kind, limit })
    return JSON.stringify({ url: page.url(), title: await page.title(), query: args.query ?? '', kind, targets }, null, 2)
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

// ── browser_use_tab ──────────────────────────────────────────────────────────

export const browserUseTabDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_use_tab',
    description: 'Reuse an existing browser automation tab by matching title or URL text. Use after browser_connect_chrome when the user wants to continue inside an already-open Gmail, Salesforce, GitHub, or other external page instead of opening a new tab.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to match in the tab title or URL, e.g. "Gmail", "Salesforce", "github.com".' },
      },
      required: ['query'],
    },
  },
}

export const browserUseTab: ToolHandler = async (args) => {
  const query = (args.query ?? '').trim().toLowerCase()
  if (!query) return 'Error: query is required'
  _pages = _pages.filter((p) => !p.isClosed())
  if (_pages.length === 0) return 'No automation tabs are available. Call browser_connect_chrome first to attach to existing browser tabs.'

  for (let i = 0; i < _pages.length; i += 1) {
    const page = _pages[i]
    const title = await page.title().catch(() => '')
    const url = page.url()
    if (title.toLowerCase().includes(query) || url.toLowerCase().includes(query)) {
      _currentTab = i
      await page.bringToFront().catch(() => {})
      return `Using existing tab ${i}: ${title || '(untitled)'} (${url})`
    }
  }

  const lines = await Promise.all(_pages.map(async (p, i) => `  [${i}] ${await p.title().catch(() => '?')} — ${p.url()}`))
  return `No existing tab matched "${args.query}". Current tabs:\n${lines.join('\n')}`
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

  if (!fs.existsSync(exePath)) {
    return `${useEdge ? 'Edge' : 'Chrome'} was not found at ${exePath}. Install it at the default path or retry with the other browser option.`
  }

  // Close existing instance
  try { execSync(`taskkill /F /IM ${procName}.exe 2>nul`, { stdio: 'ignore' }) } catch { /* ok */ }
  await new Promise(r => setTimeout(r, 1200))

  // Relaunch with debugging port
  const child = spawn(exePath, ['--remote-debugging-port=9222', '--restore-last-session'], {
    detached: true, stdio: 'ignore',
  })
  const launchError = await new Promise<string | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), 800)
    child.once('error', (err) => {
      clearTimeout(timer)
      resolve(err instanceof Error ? err.message : String(err))
    })
  })
  if (launchError) return `Could not launch ${useEdge ? 'Edge' : 'Chrome'}: ${launchError}`
  child.unref()
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
        label: { type: 'string', description: 'Accessible label text.' },
        placeholder: { type: 'string', description: 'Placeholder text.' },
        role: { type: 'string', description: 'ARIA role, such as textbox, searchbox, combobox, or editor.' },
        name: { type: 'string', description: 'Accessible name to use with role.' },
        test_id: { type: 'string', description: 'data-testid value.' },
        delay_ms: { type: 'string', description: 'Delay between keystrokes in ms (default 30).' },
      },
      required: ['text'],
    },
  },
}

export const browserType: ToolHandler = async (args) => {
  const text = args.text ?? ''
  const delay = parseInt(args.delay_ms ?? '30', 10) || 30
  let page: Page | null = null
  let target: ResolvedTarget | null = null
  try {
    page = await getPage()
    target = await resolveInputTarget(page, args)
    if (target) await target.locator.click({ timeout: TARGET_TIMEOUT })
    await page.keyboard.type(text, { delay })
    const actual = target ? await editableValue(target) : ''
    const verified = target ? (actual.includes(text) || actual.endsWith(text)) : false
    return `Typed ${text.length} characters${target ? ` into ${target.description}` : ''}.${target ? `\n${verified ? 'Verified' : 'Could not verify'} current value: ${actual.slice(0, 160)}` : ''}`
  } catch (err) { return page ? browserTargetError(page, 'type into', target, err) : `Error: ${err instanceof Error ? err.message : String(err)}` }
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
    description: 'Hover over an element by CSS selector, text, label, placeholder, ARIA role/name, or test id to reveal tooltips, dropdowns, or hover menus.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector.' },
        text: { type: 'string', description: 'Visible text of element.' },
        label: { type: 'string', description: 'Accessible label text.' },
        placeholder: { type: 'string', description: 'Placeholder text.' },
        role: { type: 'string', description: 'ARIA role, such as button, link, tab, menuitem.' },
        name: { type: 'string', description: 'Accessible name to use with role.' },
        test_id: { type: 'string', description: 'data-testid value.' },
      },
    },
  },
}

export const browserHover: ToolHandler = async (args) => {
  let page: Page | null = null
  let target: ResolvedTarget | null = null
  try {
    page = await getPage()
    target = resolveTarget(page, args)
    if (!target) return 'Error: provide selector, text, label, placeholder, role + name, or test_id'
    await target.locator.hover({ timeout: TARGET_TIMEOUT })
    return `Hovered ${target.description}`
  } catch (err) { return page ? browserTargetError(page, 'hover over', target, err) : `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── browser_scroll ────────────────────────────────────────────────────────────

export const browserScrollDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_scroll',
    description: 'Scroll the page up, down, to the top, to the bottom, or to a target found by CSS selector, text, label, placeholder, ARIA role/name, or test id.',
    parameters: {
      type: 'object',
      properties: {
        direction: { type: 'string', description: 'up, down, top, bottom (default: down).' },
        amount: { type: 'string', description: 'Pixels to scroll (default 600).' },
        selector: { type: 'string', description: 'Scroll to bring this CSS selector into view.' },
        text: { type: 'string', description: 'Visible text of target element.' },
        label: { type: 'string', description: 'Accessible label text.' },
        placeholder: { type: 'string', description: 'Placeholder text.' },
        role: { type: 'string', description: 'ARIA role, such as button, link, heading, textbox.' },
        name: { type: 'string', description: 'Accessible name to use with role.' },
        test_id: { type: 'string', description: 'data-testid value.' },
      },
    },
  },
}

export const browserScroll: ToolHandler = async (args) => {
  let page: Page | null = null
  let target: ResolvedTarget | null = null
  try {
    page = await getPage()
    target = resolveTarget(page, args)
    if (target) {
      await target.locator.scrollIntoViewIfNeeded({ timeout: TARGET_TIMEOUT })
      return `Scrolled to ${target.description}`
    }
    const amt = parseInt(args.amount ?? '600', 10) || 600
    const dir = args.direction ?? 'down'
    if (dir === 'top') { await page.evaluate(() => (globalThis as any).window.scrollTo(0, 0)); return 'Scrolled to top' }
    if (dir === 'bottom') { await page.evaluate(() => { const w = (globalThis as any).window; w.scrollTo(0, w.document.body.scrollHeight) }); return 'Scrolled to bottom' }
    const delta = dir === 'up' ? -amt : amt
    await page.evaluate((dy: number) => (globalThis as any).window.scrollBy(0, dy), delta)
    return `Scrolled ${dir} ${amt}px`
  } catch (err) { return page ? browserTargetError(page, 'scroll to', target, err) : `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── browser_check ─────────────────────────────────────────────────────────────

export const browserCheckDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_check',
    description: 'Check or uncheck a checkbox or radio button by CSS selector, label, text, ARIA role/name, or test id.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the checkbox.' },
        label: { type: 'string', description: 'Accessible label text.' },
        text: { type: 'string', description: 'Visible text of checkbox/radio label.' },
        role: { type: 'string', description: 'ARIA role, usually checkbox, radio, or switch.' },
        name: { type: 'string', description: 'Accessible name to use with role.' },
        test_id: { type: 'string', description: 'data-testid value.' },
        checked: { type: 'string', description: 'true to check, false to uncheck (default true).' },
      },
    },
  },
}

export const browserCheck: ToolHandler = async (args) => {
  let page: Page | null = null
  let target: ResolvedTarget | null = null
  try {
    page = await getPage()
    target = resolveTarget(page, args)
    if (!target) return 'Error: provide selector, label, text, role + name, or test_id'
    const shouldCheck = args.checked !== 'false'
    if (shouldCheck) { await target.locator.check({ timeout: TARGET_TIMEOUT }) }
    else { await target.locator.uncheck({ timeout: TARGET_TIMEOUT }) }
    return `${shouldCheck ? 'Checked' : 'Unchecked'} ${target.description}`
  } catch (err) { return page ? browserTargetError(page, 'toggle', target, err) : `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── browser_get_text ──────────────────────────────────────────────────────────

export const browserGetTextDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_get_text',
    description: 'Get the inner text or value of a target by CSS selector, text, label, placeholder, ARIA role/name, or test id.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector.' },
        text: { type: 'string', description: 'Visible text of target element.' },
        label: { type: 'string', description: 'Accessible label text.' },
        placeholder: { type: 'string', description: 'Placeholder text.' },
        role: { type: 'string', description: 'ARIA role, such as button, link, heading, textbox.' },
        name: { type: 'string', description: 'Accessible name to use with role.' },
        test_id: { type: 'string', description: 'data-testid value.' },
        all: { type: 'string', description: 'Set to "true" to get text from all matching elements.' },
      },
    },
  },
}

export const browserGetText: ToolHandler = async (args) => {
  let page: Page | null = null
  let target: ResolvedTarget | null = null
  try {
    page = await getPage()
    target = resolveTarget(page, args)
    if (!target) return 'Error: provide selector, text, label, placeholder, role + name, or test_id'
    if (args.all === 'true' && args.selector) {
      const texts = await page.locator(args.selector).allInnerTexts()
      return texts.join('\n')
    }
    return await target.locator.innerText({ timeout: TARGET_TIMEOUT })
  } catch (err) { return page ? browserTargetError(page, 'read text from', target, err) : `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── browser_get_attr ──────────────────────────────────────────────────────────

export const browserGetAttrDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_get_attr',
    description: 'Get an HTML attribute value from a target found by CSS selector, text, label, placeholder, ARIA role/name, or test id.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector.' },
        text: { type: 'string', description: 'Visible text of target element.' },
        label: { type: 'string', description: 'Accessible label text.' },
        placeholder: { type: 'string', description: 'Placeholder text.' },
        role: { type: 'string', description: 'ARIA role, such as button, link, textbox.' },
        name: { type: 'string', description: 'Accessible name to use with role.' },
        test_id: { type: 'string', description: 'data-testid value.' },
        attr: { type: 'string', description: 'Attribute name (e.g. "href", "value", "src").' },
      },
      required: ['attr'],
    },
  },
}

export const browserGetAttr: ToolHandler = async (args) => {
  if (!args.attr) return 'Error: attr required'
  let page: Page | null = null
  let target: ResolvedTarget | null = null
  try {
    page = await getPage()
    target = resolveTarget(page, args)
    if (!target) return 'Error: provide selector, text, label, placeholder, role + name, or test_id'
    const val = await target.locator.getAttribute(args.attr, { timeout: TARGET_TIMEOUT })
    return val ?? '(attribute not found)'
  } catch (err) { return page ? browserTargetError(page, 'read attribute from', target, err) : `Error: ${err instanceof Error ? err.message : String(err)}` }
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
        limit: { type: 'string', description: 'Maximum matches to return (default 5, max 30).' },
        scroll: { type: 'string', description: 'Set "true" to scroll the first match into view.' },
      },
      required: ['text'],
    },
  },
}

export const browserFindText: ToolHandler = async (args) => {
  if (!args.text) return 'Error: text required'
  const limit = Math.min(30, Math.max(1, parseInt(args.limit ?? '5', 10) || 5))
  try {
    const page = await getPage()
    const locator = page.getByText(args.text, { exact: false })
    const count = await locator.count().catch(() => 0)
    if (count === 0) return `Text not found: "${args.text}"`
    if (args.scroll === 'true') await locator.first().scrollIntoViewIfNeeded({ timeout: TARGET_TIMEOUT }).catch(() => {})
    const matches: string[] = []
    for (let i = 0; i < Math.min(limit, count); i += 1) {
      const item = locator.nth(i)
      const visible = await item.isVisible().catch(() => false)
      const ctx = await item.evaluate(
        (el: any) => (el.closest('p,li,div,td,h1,h2,h3,span,section,article') ?? el).innerText?.trim().replace(/\s+/g, ' ').slice(0, 360) ?? ''
      ).catch(() => '')
      matches.push(`[${i + 1}] ${visible ? 'visible' : 'hidden'}: ${ctx}`)
    }
    return `Found ${count} match(es) for "${args.text}".\n${matches.join('\n')}`
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


