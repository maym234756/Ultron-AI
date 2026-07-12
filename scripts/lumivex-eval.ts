import fs from 'node:fs'
import path from 'node:path'
import type { AppSettings, IntelligenceMode } from '../src/types.ts'
import { routePrompt } from '../src/lib/promptRouter.ts'

type EvalResult = {
  name: string
  passed: boolean
  detail: string
}

type ExpectedRoute = {
  useAgent: boolean
  intelligenceMode: IntelligenceMode
  minConfidence?: number
}

const root = process.cwd()

const settings: AppSettings = {
  temperature: 0.35,
  maxIterations: 20,
  systemPrompt: '',
  fastModel: '',
  intelligenceMode: 'balanced',
  autoRoute: true,
  autoIntelligence: true,
  observationEnabled: true,
  observationMode: 'fast',
  observationIntervalSec: 45,
  domainExpertise: '',
  numCtx: 8192,
  answerStyle: 'detailed',
}

function routeEval(name: string, prompt: string, expected: ExpectedRoute): EvalResult {
  const route = routePrompt(prompt, false, false, settings, false)
  const minConfidence = expected.minConfidence ?? 0
  const passed = route.useAgent === expected.useAgent
    && route.intelligenceMode === expected.intelligenceMode
    && route.confidence >= minConfidence
  return {
    name,
    passed,
    detail: `${route.useAgent ? 'Agent' : 'Chat'} / ${route.intelligenceMode} / ${Math.round(route.confidence * 100)}%`,
  }
}

function fileContains(file: string, needle: string): boolean {
  return fs.readFileSync(path.join(root, file), 'utf8').includes(needle)
}

function protectedRouteEval(route: string): EvalResult {
  const server = fs.readFileSync(path.join(root, 'server/index.ts'), 'utf8')
  const routeIndex = server.indexOf(route)
  const nextRouteIndex = server.indexOf("app.", routeIndex + route.length)
  const block = routeIndex >= 0 ? server.slice(routeIndex, nextRouteIndex > routeIndex ? nextRouteIndex : routeIndex + 1200) : ''
  const passed = block.includes('requireActionPermission(') || block.includes('requireAuth(')
  return {
    name: `protected ${route}`,
    passed,
    detail: passed ? 'server-side session check found' : 'missing server-side session check',
  }
}

const results: EvalResult[] = [
  routeEval('safe factual question stays chat', 'What is Postgres?', { useAgent: false, intelligenceMode: 'instant', minConfidence: 0.65 }),
  routeEval('local action routes to agent', 'Create a new React project and run the build', { useAgent: true, intelligenceMode: 'deep', minConfidence: 0.65 }),
  routeEval('fresh research routes to research', 'Research the latest AI browser agent releases with sources', { useAgent: true, intelligenceMode: 'research', minConfidence: 0.65 }),
  protectedRouteEval("app.post('/api/agent'"),
  protectedRouteEval("app.post('/api/project-builder/build'"),
  protectedRouteEval("app.post('/api/self-upgrade'"),
  protectedRouteEval("app.post('/api/run-code'"),
  protectedRouteEval("app.post('/api/engine/benchmark'"),
  {
    name: 'engine capability search present',
    passed: fileContains('server/index.ts', "app.get('/api/engine/search'") && fileContains('server/index.ts', 'engineSearchItems'),
    detail: 'engine search route and index builder found',
  },
  {
    name: 'health panel exposes engine lab',
    passed: fileContains('src/components/HealthPanel.tsx', 'Engine Search') && fileContains('src/components/HealthPanel.tsx', 'Response Benchmark'),
    detail: 'engine search and benchmark UI found',
  },
  {
    name: 'PWA manifest present',
    passed: fileContains('public/manifest.webmanifest', '"display": "standalone"'),
    detail: 'manifest declares standalone display',
  },
  {
    name: 'service worker avoids API cache',
    passed: fileContains('public/service-worker.js', "url.pathname.startsWith('/api/')"),
    detail: 'service worker skips API requests',
  },
]

console.table(results)

const failures = results.filter(result => !result.passed)
if (failures.length > 0) {
  console.error(`Lumivex AI eval failed: ${failures.length}/${results.length} case(s) failed.`)
  process.exit(1)
}

console.log(`Lumivex AI eval passed: ${results.length}/${results.length} cases.`)