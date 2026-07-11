import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { PROJECT_TEMPLATES } from './projectBuilder.js'
import type { ProjectBuildResult } from './projectBuilder.js'

export type ReferenceScanRequest = {
  url?: string
  imageBase64?: string
  goal?: string
  approved?: boolean
}

export type ReferenceBuildRequest = ReferenceScanRequest & {
  projectName?: string
  basePath?: string
  runBuild?: boolean
  visualCompare?: boolean
  openVsCode?: boolean
  openExplorer?: boolean
}

export type ReferenceVisualCompare = {
  ok: boolean
  report: string
  referenceScreenshot?: string
  generatedScreenshot?: string
}

export type ReferenceSourceFacts = {
  url?: string
  title?: string
  description?: string
  headings: string[]
  navigation: string[]
  callsToAction: string[]
  forms: string[]
  colors: string[]
  imageAlts: string[]
  textSample?: string
  screenshotSummary?: string
}

export type ReferenceBlueprint = {
  ok: boolean
  sourceType: 'url' | 'screenshot' | 'url+screenshot'
  summary: string
  blueprint: string
  sourceFacts: ReferenceSourceFacts
  suggestedProject: {
    name: string
    template: 'vanilla-ts' | 'react-vite'
    buildPrompt: string
  }
  guardrails: string[]
}

export type ReferenceBuildResult = {
  ok: boolean
  reference: ReferenceBlueprint
  project: ProjectBuildResult
  visualCompare?: ReferenceVisualCompare
}

type ReferenceScanOptions = {
  ollamaBaseUrl: string
  model: string
  visionModel?: string
}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 UltronReferenceBuilder/1.0'
const VISUAL_COMPARE_PAGE_TIMEOUT_MS = 15_000
const VISUAL_COMPARE_MODEL_TIMEOUT_MS = 45_000

function cleanProjectName(value: string | undefined): string {
  const cleaned = (value ?? 'reference-site').trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned || 'reference-site'
}

function resolveBasePath(value: string | undefined): string {
  const fallback = os.homedir()
  if (!value?.trim()) return fallback
  const expanded = value.trim().replace(/^~(?=[/\\]|$)/, os.homedir())
  return path.resolve(expanded)
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function js(value: unknown): string {
  return JSON.stringify(value).replace(/<\//g, '<\\/')
}

function markdownList(values: string[], fallback: string): string {
  const items = values.length ? values : [fallback]
  return items.map(item => `- ${item}`).join('\n')
}

function stripTags(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function cleanText(value: string | undefined, maxLength = 180): string {
  return stripTags(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function unique(values: string[], max = 16): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values.map(item => cleanText(item)).filter(Boolean)) {
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
    if (out.length >= max) break
  }
  return out
}

function matches(html: string, regex: RegExp, max = 20): string[] {
  const out: string[] = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(html)) !== null && out.length < max) out.push(match[1] ?? '')
  return unique(out, max)
}

function extractAttribute(html: string, tag: string, attr: string, max = 16): string[] {
  const out: string[] = []
  const regex = new RegExp(`<${tag}\\b[^>]*\\s${attr}=["']([^"']+)["'][^>]*>`, 'gi')
  let match: RegExpExecArray | null
  while ((match = regex.exec(html)) !== null && out.length < max) out.push(match[1] ?? '')
  return unique(out, max)
}

function extractColors(html: string): string[] {
  const colors = html.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]{5,80}\)/gi) ?? []
  return unique(colors, 18)
}

function projectNameFromGoal(goal: string | undefined, title: string | undefined): string {
  const source = goal?.trim() || title?.trim() || 'reference-site'
  const words = source.toLowerCase().replace(/[^a-z0-9\s-]+/g, '').split(/\s+/).filter(Boolean).slice(0, 4)
  return (words.join('-') || 'reference-site').replace(/^-+|-+$/g, '')
}

async function runCommand(command: string, cwd: string, timeoutSec = 180): Promise<string> {
  return new Promise(resolve => {
    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      cwd,
      windowsHide: true,
      stdio: 'pipe',
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      settled = true
      proc.kill('SIGTERM')
      resolve(`Error: command timed out after ${timeoutSec}s`)
    }, timeoutSec * 1000)
    proc.stdout.on('data', chunk => { stdout += chunk.toString() })
    proc.stderr.on('data', chunk => { stderr += chunk.toString() })
    proc.on('close', code => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const output = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n') || '(no output)'
      resolve(code === 0 ? output : `${output}\n[exit code ${code ?? '?'}]`)
    })
    proc.on('error', err => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(`Error: ${err.message}`)
    })
  })
}

async function writeFiles(root: string, files: Record<string, string>): Promise<string[]> {
  const written: string[] = []
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = path.join(root, relativePath)
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, content, 'utf-8')
    written.push(relativePath)
  }
  return written
}

function sourceTypeFor(request: ReferenceScanRequest): ReferenceBlueprint['sourceType'] {
  if (request.url && request.imageBase64) return 'url+screenshot'
  if (request.imageBase64) return 'screenshot'
  return 'url'
}

async function scanUrl(url: string): Promise<ReferenceSourceFacts> {
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only http and https URLs can be scanned.')
  const response = await fetch(parsed.toString(), {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`Reference URL returned HTTP ${response.status}`)
  const html = await response.text()
  const title = cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1], 120)
  const description = cleanText(html.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i)?.[1], 240)
  const headings = unique([
    ...matches(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, 10),
    ...matches(html, /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, 14),
    ...matches(html, /<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, 10),
  ], 20)
  const navigation = matches(html, /<a\b[^>]*>([\s\S]*?)<\/a>/gi, 24)
  const buttons = unique([
    ...matches(html, /<button\b[^>]*>([\s\S]*?)<\/button>/gi, 16),
    ...matches(html, /<a\b[^>]*(?:class|role)=["'][^"']*(?:btn|button|cta)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi, 16),
  ], 18)
  const forms = unique([
    ...extractAttribute(html, 'input', 'placeholder', 18),
    ...extractAttribute(html, 'textarea', 'placeholder', 6),
    ...matches(html, /<label\b[^>]*>([\s\S]*?)<\/label>/gi, 12),
  ], 18)
  return {
    url: parsed.toString(),
    title,
    description,
    headings,
    navigation,
    callsToAction: buttons,
    forms,
    colors: extractColors(html),
    imageAlts: extractAttribute(html, 'img', 'alt', 18),
    textSample: stripTags(html).slice(0, 2000),
  }
}

async function analyzeScreenshot(imageBase64: string, options: ReferenceScanOptions): Promise<string> {
  if (!options.visionModel) return 'No local vision model is available, so screenshot analysis was skipped.'
  const base64 = imageBase64.replace(/^data:[^;]+;base64,/, '')
  const response = await fetch(`${options.ollamaBaseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: options.visionModel,
      stream: false,
      messages: [{
        role: 'user',
        content: 'Analyze this website screenshot as a product/design reference. Identify page type, layout, sections, navigation, forms, data displays, visual hierarchy, colors, and interaction patterns. Do not suggest copying logos, brand names, exact text, or proprietary artwork.',
        images: [base64],
      }],
      options: { temperature: 0.15, num_ctx: 8192, num_predict: 1200 },
    }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!response.ok) throw new Error(`Vision model returned HTTP ${response.status}`)
  const data = await response.json() as { message?: { content?: string } }
  return data.message?.content?.trim() || 'Screenshot analysis returned no text.'
}

function deterministicBlueprint(facts: ReferenceSourceFacts, goal: string | undefined): string {
  const pageKind = goal?.trim() || facts.title || facts.headings[0] || 'reference-inspired website'
  return [
    `Build an original ${pageKind}.`,
    '',
    'Recommended structure:',
    `- Navigation: ${facts.navigation.slice(0, 6).join(', ') || 'brand, product, pricing, support, account'}`,
    `- Hero: clear value proposition with a primary action${facts.forms.length ? ` and form fields such as ${facts.forms.slice(0, 4).join(', ')}` : ''}`,
    `- Sections: ${facts.headings.slice(0, 8).join('; ') || 'overview, feature cards, workflow, trust signals, pricing, FAQ'}`,
    `- Actions: ${facts.callsToAction.slice(0, 6).join(', ') || 'search, get started, view sample, sign in'}`,
    `- Visual direction: use an original palette inspired by these observed colors: ${facts.colors.slice(0, 8).join(', ') || 'professional contrast with accessible accents'}`,
    '',
    'Guardrail: do not copy brand names, logos, exact page copy, protected imagery, or distinctive trade dress. Recreate the category and workflow in a new design.',
  ].join('\n')
}

async function buildBlueprint(facts: ReferenceSourceFacts, request: ReferenceScanRequest, options: ReferenceScanOptions): Promise<string> {
  const prompt = [
    'Create a build-ready blueprint for an ORIGINAL website inspired by the reference facts below.',
    'Important guardrails: do not copy brand names, logos, exact text, proprietary images, or distinctive trade dress. Extract product patterns, layout concepts, information architecture, and workflows only.',
    `User goal: ${request.goal?.trim() || 'Build a website inspired by this reference.'}`,
    `Reference facts:\n${JSON.stringify(facts, null, 2).slice(0, 18000)}`,
    'Return concise Markdown with: Product concept, Pages, Components, Data/workflows, Visual direction, Build prompt for Ultron.',
  ].join('\n\n')

  try {
    const response = await fetch(`${options.ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model,
        stream: false,
        messages: [{ role: 'user', content: prompt }],
        options: { temperature: 0.22, num_ctx: 16384, num_predict: 1800 },
      }),
      signal: AbortSignal.timeout(120_000),
    })
    if (!response.ok) throw new Error(`Blueprint model returned HTTP ${response.status}`)
    const data = await response.json() as { message?: { content?: string } }
    return data.message?.content?.trim() || deterministicBlueprint(facts, request.goal)
  } catch {
    return deterministicBlueprint(facts, request.goal)
  }
}

function buildApiContracts(facts: ReferenceSourceFacts): Array<{ name: string; purpose: string; mockFile: string; endpoint: string }> {
  const lookupLabel = facts.forms[0] || 'primary lookup form'
  const sections = facts.headings.slice(0, 4).join(', ') || 'page sections and report cards'
  return [
    {
      name: 'getPrimaryReport',
      purpose: `Return mock results for the ${lookupLabel}. Replace this with the real provider/search API.`,
      mockFile: 'mockReport',
      endpoint: 'GET /api/report/:id',
    },
    {
      name: 'getLandingContent',
      purpose: `Load navigation, hero content, CTAs, and sections inspired by: ${sections}.`,
      mockFile: 'mockLandingContent',
      endpoint: 'GET /api/content/landing',
    },
    {
      name: 'getPricingPlans',
      purpose: 'Return plan cards, billing labels, and feature limits. Replace with billing/product catalog data.',
      mockFile: 'mockPricingPlans',
      endpoint: 'GET /api/pricing',
    },
    {
      name: 'getDashboardSummary',
      purpose: 'Return saved searches, recent reports, account status, and next actions for a signed-in user.',
      mockFile: 'mockDashboardSummary',
      endpoint: 'GET /api/dashboard',
    },
  ]
}

function referenceDiffFile(projectName: string, reference: ReferenceBlueprint, facts: ReferenceSourceFacts): string {
  return `# Reference Diff - ${projectName}

This project is an original build generated from a reference scan. Use this file to keep the implementation useful without copying protected brand assets, exact copy, logos, or distinctive trade dress.

## Learned From The Reference

${markdownList([
    ...facts.navigation.slice(0, 5).map(item => `Navigation pattern: ${item}`),
    ...facts.headings.slice(0, 6).map(item => `Content section: ${item}`),
    ...facts.callsToAction.slice(0, 4).map(item => `Action pattern: ${item}`),
  ], reference.summary)}

## Intentionally Changed

- Original color, spacing, and component treatment should be adjusted before launch.
- Copy is generated as placeholder/product copy and should be rewritten for the final brand.
- Any logos, screenshots, proprietary imagery, icons, and exact phrases from the source are excluded.
- Data flows are mocked until real provider APIs are supplied.

## Missing Real Integrations

${markdownList(buildApiContracts(facts).map(item => `${item.name}: ${item.endpoint}`), 'No integration requirements were detected yet.')}

## Guardrails

${reference.guardrails.map(item => `- ${item}`).join('\n')}
`
}

function mockDataGuideFile(projectName: string, facts: ReferenceSourceFacts): string {
  return `# Mock Data - ${projectName}

The generated site uses mock data so the UI can be built before paid/private APIs are available.

## Mock Modules

- \`src/data/mockData.js\`: static data for landing content, reports, pricing, and dashboard states.
- \`src/services/apiClient.js\`: async functions that simulate future API calls.

## Replace Later

${markdownList(buildApiContracts(facts).map(item => `${item.mockFile} -> ${item.name} -> ${item.endpoint}`), 'Add provider-specific records as the product requirements become clear.')}

## Notes

- Keep mock response shapes close to the future API contract.
- Do not hard-code real customer, payment, credential, or provider data in mock files.
- When real APIs arrive, update \`src/services/apiClient.js\` first and leave UI components mostly unchanged.
`
}

function apiTodoFile(projectName: string, facts: ReferenceSourceFacts): string {
  const contracts = buildApiContracts(facts)
  return `# API TODO - ${projectName}

Use this checklist when replacing mock data with real integrations.

${contracts.map(item => `## ${item.name}

- Purpose: ${item.purpose}
- Planned endpoint: \`${item.endpoint}\`
- Current mock: \`${item.mockFile}\`
- Needed from provider: auth method, rate limits, request schema, response schema, error states, test credentials, and production credentials.
`).join('\n')}
## Environment Variables To Define Later

- \`VITE_API_BASE_URL\`
- \`API_PROVIDER_KEY\`
- \`API_PROVIDER_SECRET\`
- \`PAYMENTS_SECRET_KEY\` if checkout is added
- \`AUTH_PROVIDER_CLIENT_ID\` if third-party login is added
`
}

function mockDataJs(projectName: string, facts: ReferenceSourceFacts): string {
  const sectionTitles = facts.headings.length ? facts.headings.slice(0, 6) : ['Instant search', 'Report timeline', 'Trust signals', 'Pricing options']
  const nav = facts.navigation.length ? facts.navigation.slice(0, 5) : ['Home', 'Reports', 'Pricing', 'Dashboard']
  const actions = facts.callsToAction.length ? facts.callsToAction.slice(0, 4) : ['Start search', 'View sample', 'Compare plans']
  return `export const mockLandingContent = ${js({
    projectName,
    nav,
    hero: {
      eyebrow: 'Original reference build',
      title: projectName,
      description: facts.description || 'A production-ready interface inspired by a reference scan, powered by mock data until real APIs are connected.',
      actions,
    },
    sections: sectionTitles.map((title, index) => ({ id: `section-${index + 1}`, title, body: 'Original placeholder content. Replace with final product copy and real data when available.' })),
  })}

export const mockReport = ${js({
    id: 'sample-report-001',
    status: 'Ready for review',
    score: 92,
    summary: 'Mock report data is shaping the UI before provider APIs are connected.',
    timeline: ['Search submitted', 'Provider records checked', 'Risk flags reviewed', 'Report ready'],
    cards: ['Ownership history', 'Status checks', 'Market signals', 'Saved notes'],
  })}

export const mockPricingPlans = ${js([
    { name: 'Starter', price: '$19', detail: 'Single report workflow', features: ['Instant mock lookup', 'Printable summary', 'Email-ready output'] },
    { name: 'Pro', price: '$49', detail: 'Repeat users and teams', features: ['Saved reports', 'Dashboard view', 'Priority support'] },
    { name: 'Business', price: 'Custom', detail: 'API-backed operations', features: ['Bulk workflows', 'Team seats', 'Provider integrations'] },
  ])}

export const mockDashboardSummary = ${js({
    savedReports: 8,
    recentSearches: ['AB12-CD34', 'ZX98-YT76', 'LM45-PQ12'],
    nextActions: ['Connect real provider API', 'Add authentication', 'Replace mock checkout'],
  })}
`
}

function apiClientJs(): string {
  return `import { mockDashboardSummary, mockLandingContent, mockPricingPlans, mockReport } from '../data/mockData.js'

const wait = (value) => new Promise(resolve => setTimeout(() => resolve(value), 180))

export async function getLandingContent() {
  return wait(mockLandingContent)
}

export async function getPrimaryReport(_lookupValue) {
  return wait(mockReport)
}

export async function getPricingPlans() {
  return wait(mockPricingPlans)
}

export async function getDashboardSummary() {
  return wait(mockDashboardSummary)
}
`
}

function pageModuleJs(pageName: string, purpose: string): string {
  return `export const page = {
  name: ${js(pageName)},
  purpose: ${js(purpose)},
}
`
}

function referenceSiteFiles(projectName: string, reference: ReferenceBlueprint): Record<string, string> {
  const facts = reference.sourceFacts
  const apiContracts = buildApiContracts(facts)
  const nav = facts.navigation.length ? facts.navigation.slice(0, 5) : ['Overview', 'Workflow', 'Reports', 'Pricing', 'Contact']
  const sections = facts.headings.length ? facts.headings.slice(0, 8) : ['Fast lookup', 'Clear report cards', 'Timeline view', 'Account dashboard']
  const actions = facts.callsToAction.length ? facts.callsToAction.slice(0, 4) : ['Start lookup', 'View sample', 'Compare plans']
  const forms = facts.forms.length ? facts.forms.slice(0, 3) : ['Enter reference ID or search value']
  const colors = facts.colors.length ? facts.colors.slice(0, 5) : ['#0f766e', '#111827', '#f8fafc']
  const title = reference.summary || projectName
  const description = facts.description || `An original ${projectName} experience generated from a reference blueprint.`
  const brief = `# ${projectName}\n\nGenerated by Ultron Reference Builder.\n\n## Reference Summary\n\n${reference.summary}\n\n## Guardrails\n\n${reference.guardrails.map(item => `- ${item}`).join('\n')}\n\n## Blueprint\n\n${reference.blueprint}\n\n## Mock/API Contract\n\n${apiContracts.map(item => `- ${item.name}: ${item.purpose}`).join('\n')}\n`

  return {
    'package.json': JSON.stringify({
      name: projectName,
      version: '0.1.0',
      private: true,
      type: 'module',
      scripts: { dev: 'node scripts/dev-server.mjs', build: 'node scripts/check.mjs', check: 'node scripts/check.mjs' },
    }, null, 2) + '\n',
    'README.md': `# ${projectName}\n\nOriginal website generated from a reference scan.\n\n## Commands\n\n- npm run dev\n- npm run build\n\n## Handoff Files\n\n- PROJECT_BRIEF.md\n- REFERENCE_DIFF.md\n- MOCK_DATA.md\n- API_TODO.md\n`,
    'PROJECT_BRIEF.md': brief,
    'REFERENCE_DIFF.md': referenceDiffFile(projectName, reference, facts),
    'MOCK_DATA.md': mockDataGuideFile(projectName, facts),
    'API_TODO.md': apiTodoFile(projectName, facts),
    'index.html': `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>${escapeHtml(projectName)}</title>\n    <link rel="stylesheet" href="./src/styles.css" />\n  </head>\n  <body>\n    <main id="app"></main>\n    <script type="module" src="./src/main.js"></script>\n  </body>\n</html>\n`,
    'src/main.js': `const reference = ${js({ title, description, nav, sections, actions, forms, colors, screenshotSummary: facts.screenshotSummary })}\n\nfunction el(tag, className, text) {\n  const node = document.createElement(tag)\n  if (className) node.className = className\n  if (text) node.textContent = text\n  return node\n}\n\nfunction render() {\n  const app = document.querySelector('#app')\n  const topbar = el('nav', 'topbar')\n  topbar.append(el('strong', '', reference.title))\n  const links = el('div')\n  reference.nav.forEach(item => links.append(el('a', '', item)))\n  topbar.append(links)\n\n  const hero = el('section', 'hero')\n  const heroCopy = el('div')\n  heroCopy.append(el('p', 'eyebrow', 'Original reference build'))\n  heroCopy.append(el('h1', '', reference.title))\n  heroCopy.append(el('p', '', reference.description))\n  const form = el('form', 'lookup')\n  form.onsubmit = event => { event.preventDefault(); document.body.classList.add('searched') }\n  const input = el('input')\n  input.setAttribute('aria-label', 'Lookup')\n  input.setAttribute('placeholder', reference.forms[0] || 'Enter lookup value')\n  form.append(input, el('button', '', reference.actions[0] || 'Start lookup'))\n  heroCopy.append(form)\n  const preview = el('aside', 'report-preview')\n  preview.append(el('span', '', 'Live preview'), el('strong', '', 'Clear status'), el('p', '', 'Timeline, trust signals, and report cards are ready for real data.'))\n  hero.append(heroCopy, preview)\n\n  const grid = el('section', 'grid')\n  reference.sections.forEach((item, index) => {\n    const card = el('article', 'feature-card')\n    card.style.setProperty('--card-accent', reference.colors[index % reference.colors.length] || '#0f766e')\n    card.append(el('span', '', String(index + 1).padStart(2, '0')), el('h3', '', item), el('p', '', 'Designed as an original workflow module inspired by the reference structure, with new copy and visual treatment.'))\n    grid.append(card)\n  })\n\n  const blueprint = el('section', 'blueprint')\n  const blueprintCopy = el('div')\n  blueprintCopy.append(el('p', 'eyebrow', 'Workflow'), el('h2', '', 'Built around the reference pattern, not copied from it.'))\n  const steps = el('ol')\n  ;['Collect a user input or intent.', 'Show a credible preview state.', 'Guide the user into a next action.'].forEach(item => steps.append(el('li', '', item)))\n  blueprint.append(blueprintCopy, steps)\n  app.append(topbar, hero, grid, blueprint)\n}\n\nrender()\n`,
    'src/styles.css': `:root { color-scheme: light; font-family: 'Aptos', 'Segoe UI', sans-serif; background: #f7f8f4; color: #111827; }\n* { box-sizing: border-box; }\nbody { margin: 0; min-height: 100vh; background: radial-gradient(circle at top left, rgba(15,118,110,.16), transparent 34%), #f7f8f4; }\na { color: inherit; text-decoration: none; }\n.topbar { min-height: 64px; display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 0 32px; border-bottom: 1px solid #d9ded4; background: rgba(255,255,255,.72); backdrop-filter: blur(16px); position: sticky; top: 0; z-index: 2; }\n.topbar div { display: flex; gap: 16px; flex-wrap: wrap; color: #4b5563; font-size: 14px; }\n.hero { width: min(1180px, calc(100vw - 32px)); margin: 42px auto 28px; display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(280px, .65fr); gap: 22px; align-items: stretch; }\n.hero > div, .report-preview, .blueprint { border: 1px solid #d9ded4; background: rgba(255,255,255,.86); border-radius: 8px; box-shadow: 0 22px 70px rgba(17,24,39,.09); }\n.hero > div { padding: 44px; }\n.eyebrow { margin: 0 0 12px; color: #0f766e; font-size: 12px; font-weight: 900; text-transform: uppercase; letter-spacing: .12em; }\nh1 { max-width: 820px; margin: 0 0 18px; font-size: 64px; line-height: .94; letter-spacing: 0; }\nh2 { margin: 0; font-size: 34px; line-height: 1.05; letter-spacing: 0; }\np { color: #4b5563; font-size: 17px; line-height: 1.6; }\n.lookup { display: flex; gap: 10px; margin-top: 28px; max-width: 620px; }\n.lookup input { flex: 1; min-width: 0; min-height: 46px; padding: 0 14px; border: 1px solid #c7cec2; border-radius: 7px; font: inherit; }\nbutton { min-height: 46px; border: 0; border-radius: 7px; background: #0f766e; color: white; padding: 0 18px; font-weight: 900; cursor: pointer; }\n.report-preview { padding: 28px; display: flex; flex-direction: column; justify-content: flex-end; background: linear-gradient(145deg, #10231f, #0f766e); color: white; }\n.report-preview span { color: #a7f3d0; font-size: 12px; text-transform: uppercase; font-weight: 900; }\n.report-preview strong { margin: 12px 0; font-size: 40px; line-height: 1; }\n.report-preview p { color: rgba(255,255,255,.78); }\n.grid { width: min(1180px, calc(100vw - 32px)); margin: 0 auto 28px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }\n.feature-card { min-height: 210px; padding: 22px; border: 1px solid #d9ded4; border-radius: 8px; background: white; border-top: 5px solid var(--card-accent); }\n.feature-card span { color: var(--card-accent); font-weight: 900; }\n.feature-card h3 { margin: 18px 0 8px; font-size: 21px; }\n.feature-card p { font-size: 14px; }\n.blueprint { width: min(1180px, calc(100vw - 32px)); margin: 0 auto 44px; padding: 30px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }\n.blueprint ol { margin: 0; display: grid; gap: 10px; color: #374151; font-size: 16px; }\nbody.searched .report-preview strong::after { content: ' ready'; color: #a7f3d0; }\n@media (max-width: 860px) { .topbar, .topbar div { align-items: flex-start; flex-direction: column; padding: 16px; } .hero, .blueprint { grid-template-columns: 1fr; } .grid { grid-template-columns: 1fr; } .hero > div { padding: 28px; } h1 { font-size: 42px; } .lookup { flex-direction: column; } }\n`,
    'src/data/mockData.js': mockDataJs(projectName, facts),
    'src/services/apiClient.js': apiClientJs(),
    'src/pages/home.js': pageModuleJs('Home', 'Landing page, primary lookup, value proposition, and trust sections.'),
    'src/pages/report.js': pageModuleJs('Report', 'Mock report detail view ready for provider data.'),
    'src/pages/pricing.js': pageModuleJs('Pricing', 'Plan cards and checkout placeholders.'),
    'src/pages/dashboard.js': pageModuleJs('Dashboard', 'Saved records, recent activity, and account workflow placeholders.'),
    'scripts/check.mjs': `import fs from 'node:fs'\n\nconst required = ['index.html', 'src/main.js', 'src/styles.css', 'PROJECT_BRIEF.md', 'REFERENCE_DIFF.md', 'MOCK_DATA.md', 'API_TODO.md', 'src/data/mockData.js', 'src/services/apiClient.js', 'src/pages/home.js', 'src/pages/report.js', 'src/pages/pricing.js', 'src/pages/dashboard.js']\nconst missing = required.filter(file => !fs.existsSync(file))\nif (missing.length) {\n  console.error('Missing files:', missing.join(', '))\n  process.exit(1)\n}\nconsole.log('Reference build structure valid:', required.join(', '))\n`,
    'scripts/dev-server.mjs': `import { createServer } from 'node:http'\nimport { readFile } from 'node:fs/promises'\nimport path from 'node:path'\n\nconst types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }\nconst server = createServer(async (req, res) => {\n  const urlPath = req.url === '/' ? '/index.html' : req.url ?? '/index.html'\n  const file = path.join(process.cwd(), urlPath.replace(/^\\//, ''))\n  try {\n    const body = await readFile(file)\n    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'text/plain' })\n    res.end(body)\n  } catch {\n    res.writeHead(404); res.end('Not found')\n  }\n})\nserver.listen(5174, () => console.log('Dev server: http://localhost:5174'))\n`,
  }
}

function imageBufferFromDataUrl(value: string): Buffer {
  const base64 = value.replace(/^data:[^;]+;base64,/, '')
  return Buffer.from(base64, 'base64')
}

async function startStaticServer(root: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(async (request, response) => {
    const requestedPath = request.url === '/' ? '/index.html' : request.url ?? '/index.html'
    const safePath = path.resolve(root, requestedPath.replace(/^\//, ''))
    if (safePath !== path.resolve(root) && !safePath.startsWith(path.resolve(root) + path.sep)) {
      response.writeHead(403)
      response.end('Forbidden')
      return
    }
    try {
      const body = await fs.readFile(safePath)
      const ext = path.extname(safePath).toLowerCase()
      const type = ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : 'text/plain'
      response.writeHead(200, { 'content-type': type })
      response.end(body)
    } catch {
      response.writeHead(404)
      response.end('Not found')
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise(resolve => server.close(() => resolve())),
  }
}

async function captureUrlScreenshot(url: string, filePath: string): Promise<void> {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })
    await page.goto(url, { waitUntil: 'networkidle', timeout: VISUAL_COMPARE_PAGE_TIMEOUT_MS }).catch(async () => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: VISUAL_COMPARE_PAGE_TIMEOUT_MS })
    })
    await page.screenshot({ path: filePath, fullPage: true })
  } finally {
    await browser.close().catch(() => {})
  }
}

async function compareScreenshots(referenceScreenshot: string, generatedScreenshot: string, options: ReferenceScanOptions): Promise<string> {
  const manualReviewReport = (reason: string) => [
    `Visual compare captured screenshots, but automated vision comparison was unavailable: ${reason}`,
    'Review the two images and adjust layout, spacing, color, hierarchy, and missing sections manually.',
  ].join('\n')

  if (!options.visionModel) {
    return manualReviewReport('no local vision model is available')
  }

  const referenceBase64 = (await fs.readFile(referenceScreenshot)).toString('base64')
  const generatedBase64 = (await fs.readFile(generatedScreenshot)).toString('base64')
  try {
    const response = await fetch(`${options.ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.visionModel,
        stream: false,
        messages: [{
          role: 'user',
          content: 'Compare these two website screenshots. Image 1 is the reference. Image 2 is Ultron\'s original generated site. Identify high-level layout, spacing, hierarchy, section, color, and mobile/desktop quality gaps. Do not recommend copying logos, exact text, brand assets, or protected trade dress. Return concise Markdown with: What matches, What differs, Next fixes.',
          images: [referenceBase64, generatedBase64],
        }],
        options: { temperature: 0.18, num_ctx: 8192, num_predict: 1400 },
      }),
      signal: AbortSignal.timeout(VISUAL_COMPARE_MODEL_TIMEOUT_MS),
    })
    if (!response.ok) return manualReviewReport(`vision model returned HTTP ${response.status}`)
    const data = await response.json() as { message?: { content?: string } }
    return data.message?.content?.trim() || manualReviewReport('vision model returned no comparison text')
  } catch (err) {
    return manualReviewReport(err instanceof Error ? err.message : String(err))
  }
}

async function runVisualCompare(projectPath: string, reference: ReferenceBlueprint, request: ReferenceBuildRequest, options: ReferenceScanOptions): Promise<ReferenceVisualCompare> {
  const compareDir = path.join(projectPath, 'visual-compare')
  await fs.mkdir(compareDir, { recursive: true })
  const referenceScreenshot = path.join(compareDir, 'reference.png')
  const generatedScreenshot = path.join(compareDir, 'generated.png')
  const reportPath = path.join(projectPath, 'VISUAL_COMPARE.md')

  try {
    if (request.imageBase64?.trim()) {
      await fs.writeFile(referenceScreenshot, imageBufferFromDataUrl(request.imageBase64))
    } else if (request.url?.trim()) {
      await captureUrlScreenshot(request.url.trim(), referenceScreenshot)
    } else {
      throw new Error('Visual compare needs a reference URL or screenshot.')
    }

    const staticServer = await startStaticServer(projectPath)
    try {
      await captureUrlScreenshot(staticServer.url, generatedScreenshot)
    } finally {
      await staticServer.close().catch(() => {})
    }

    const compareText = await compareScreenshots(referenceScreenshot, generatedScreenshot, options)
    const report = [
      `# Visual Compare - ${reference.suggestedProject.name}`,
      '',
      `Reference: ${request.url?.trim() || 'uploaded screenshot'}`,
      `Reference screenshot: ${path.relative(projectPath, referenceScreenshot).replace(/\\/g, '/')}`,
      `Generated screenshot: ${path.relative(projectPath, generatedScreenshot).replace(/\\/g, '/')}`,
      '',
      '## Guardrail',
      'Use this report to improve structure, clarity, responsiveness, and original visual quality. Do not copy protected logos, exact text, brand assets, or distinctive trade dress.',
      '',
      '## Comparison',
      compareText,
      '',
    ].join('\n')
    await fs.writeFile(reportPath, report, 'utf-8')
    return { ok: true, report, referenceScreenshot, generatedScreenshot }
  } catch (err) {
    const report = [
      `# Visual Compare - ${reference.suggestedProject.name}`,
      '',
      `Visual compare could not complete: ${err instanceof Error ? err.message : String(err)}`,
      '',
      'The project was still built and checked. Try again after confirming Playwright browsers and the reference URL are reachable.',
    ].join('\n')
    await fs.writeFile(reportPath, report, 'utf-8').catch(() => {})
    return { ok: false, report }
  }
}

export async function scanReference(request: ReferenceScanRequest, options: ReferenceScanOptions): Promise<ReferenceBlueprint> {
  if (!request.approved) throw new Error('Approval is required before Ultron scans a reference website or screenshot.')
  if (!request.url?.trim() && !request.imageBase64?.trim()) throw new Error('Provide a public URL or screenshot image to scan.')

  const facts: ReferenceSourceFacts = {
    headings: [],
    navigation: [],
    callsToAction: [],
    forms: [],
    colors: [],
    imageAlts: [],
  }

  if (request.url?.trim()) Object.assign(facts, await scanUrl(request.url.trim()))
  if (request.imageBase64?.trim()) facts.screenshotSummary = await analyzeScreenshot(request.imageBase64, options)

  const blueprint = await buildBlueprint(facts, request, options)
  const projectName = projectNameFromGoal(request.goal, facts.title)
  const buildPrompt = `Build an original website called ${projectName} from this reference blueprint. Do not copy protected brand assets, exact copy, logos, or trade dress.\n\n${blueprint}`

  return {
    ok: true,
    sourceType: sourceTypeFor(request),
    summary: facts.title || facts.headings[0] || facts.screenshotSummary?.split('\n')[0]?.slice(0, 120) || 'Reference scanned.',
    blueprint,
    sourceFacts: facts,
    suggestedProject: {
      name: projectName,
      template: 'vanilla-ts',
      buildPrompt,
    },
    guardrails: [
      'Use the reference to understand category, workflow, and layout patterns only.',
      'Do not copy logos, brand names, exact marketing copy, protected images, or distinctive trade dress.',
      'Build an original implementation with original text, colors, assets, and component styling.',
    ],
  }
}

export async function buildReferenceProject(request: ReferenceBuildRequest, options: ReferenceScanOptions): Promise<ReferenceBuildResult> {
  const reference = await scanReference(request, options)
  const projectName = cleanProjectName(request.projectName || reference.suggestedProject.name)
  const basePath = resolveBasePath(request.basePath)
  const projectPath = path.join(basePath, projectName)
  const template = PROJECT_TEMPLATES.find(item => item.id === 'vanilla-ts') ?? PROJECT_TEMPLATES[0]
  const logs: string[] = []

  await fs.mkdir(projectPath, { recursive: true })
  logs.push(`Created project folder: ${projectPath}`)
  const filesWritten = await writeFiles(projectPath, referenceSiteFiles(projectName, reference))
  logs.push(`Wrote ${filesWritten.length} file(s).`)

  if (request.runBuild ?? true) {
    logs.push('Running: npm run build')
    logs.push(await runCommand('npm run build', projectPath, 180))
  }
  let visualCompare: ReferenceVisualCompare | undefined
  if (request.visualCompare) {
    logs.push('Running visual compare against the reference.')
    visualCompare = await runVisualCompare(projectPath, reference, request, options)
    if (visualCompare.ok) {
      logs.push('Visual compare saved: VISUAL_COMPARE.md')
      if (!filesWritten.includes('VISUAL_COMPARE.md')) filesWritten.push('VISUAL_COMPARE.md')
      if (!filesWritten.includes('visual-compare/reference.png')) filesWritten.push('visual-compare/reference.png')
      if (!filesWritten.includes('visual-compare/generated.png')) filesWritten.push('visual-compare/generated.png')
    } else {
      logs.push(`Visual compare needs attention: ${visualCompare.report.split('\n')[2] ?? 'unknown issue'}`)
      if (!filesWritten.includes('VISUAL_COMPARE.md')) filesWritten.push('VISUAL_COMPARE.md')
    }
  }
  if (request.openExplorer) {
    logs.push('Opening project folder in File Explorer.')
    logs.push(await runCommand(`Start-Process explorer.exe -ArgumentList ${quotePowerShell(projectPath)}`, projectPath, 20))
  }
  if (request.openVsCode) {
    logs.push('Opening project in VS Code.')
    logs.push(await runCommand(`Start-Process code -ArgumentList ${quotePowerShell(projectPath)}`, projectPath, 20))
  }

  return {
    ok: true,
    reference,
    visualCompare,
    project: {
      ok: true,
      projectName,
      projectPath,
      template,
      filesWritten,
      logs,
      nextCommands: ['npm run build', 'npm run dev'],
    },
  }
}