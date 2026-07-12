import type { AppSettings, IntelligenceMode } from '../src/types.ts'
import { routePrompt } from '../src/lib/promptRouter.ts'

type ExpectedRoute = {
  useAgent: boolean
  intelligenceMode: IntelligenceMode
  minConfidence?: number
}

type RouterCase = {
  name: string
  prompt: string
  expected: ExpectedRoute
  hasFiles?: boolean
  hasImages?: boolean
  manualAgentMode?: boolean
}

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

const cases: RouterCase[] = [
  {
    name: 'simple connector knowledge',
    prompt: 'What is Salesforce?',
    expected: { useAgent: false, intelligenceMode: 'instant', minConfidence: 0.7 },
  },
  {
    name: 'factual tech history question',
    prompt: 'How was YouTube created and what programming language was it built with?',
    expected: { useAgent: false, intelligenceMode: 'instant', minConfidence: 0.7 },
  },
  {
    name: 'connector account action',
    prompt: 'Connect to my Salesforce account',
    expected: { useAgent: true, intelligenceMode: 'balanced', minConfidence: 0.7 },
  },
  {
    name: 'fresh research request',
    prompt: 'Research latest Salesforce AI competitors with sources',
    expected: { useAgent: true, intelligenceMode: 'research', minConfidence: 0.7 },
  },
  {
    name: 'code review reasoning',
    prompt: 'Review this TypeScript code for bugs',
    expected: { useAgent: false, intelligenceMode: 'deep', minConfidence: 0.55 },
  },
  {
    name: 'repo action task',
    prompt: 'Run the build and fix failures',
    expected: { useAgent: true, intelligenceMode: 'deep', minConfidence: 0.7 },
  },
  {
    name: 'project path review request',
    prompt: 'Review the entire project at C:\\Users\\maym2\\Lumivex AI and find weak spots',
    expected: { useAgent: true, intelligenceMode: 'deep', minConfidence: 0.7 },
  },
  {
    name: 'project builder kickoff',
    prompt: 'Lets build a website',
    expected: { useAgent: true, intelligenceMode: 'deep', minConfidence: 0.7 },
  },
  {
    name: 'quick concise knowledge',
    prompt: 'Quickly summarize Docker in one sentence',
    expected: { useAgent: false, intelligenceMode: 'instant', minConfidence: 0.7 },
  },
  {
    name: 'browser connector action',
    prompt: 'Open my Gmail inbox',
    expected: { useAgent: true, intelligenceMode: 'balanced', minConfidence: 0.7 },
  },
  {
    name: 'production diagnosis',
    prompt: 'Diagnose this production API error',
    expected: { useAgent: false, intelligenceMode: 'deep', minConfidence: 0.55 },
  },
]

const results = cases.map(testCase => {
  const route = routePrompt(
    testCase.prompt,
    Boolean(testCase.hasFiles),
    Boolean(testCase.hasImages),
    settings,
    Boolean(testCase.manualAgentMode),
  )
  const expectedConfidence = testCase.expected.minConfidence ?? 0
  const passed = route.useAgent === testCase.expected.useAgent
    && route.intelligenceMode === testCase.expected.intelligenceMode
    && route.confidence >= expectedConfidence

  return {
    case: testCase.name,
    expected: `${testCase.expected.useAgent ? 'Agent' : 'Chat'} / ${testCase.expected.intelligenceMode}`,
    actual: `${route.useAgent ? 'Agent' : 'Chat'} / ${route.intelligenceMode}`,
    confidence: `${Math.round(route.confidence * 100)}%`,
    signals: route.signals.join(', ') || 'none',
    passed,
  }
})

console.table(results)

const failures = results.filter(result => !result.passed)
if (failures.length > 0) {
  console.error(`Router evaluation failed: ${failures.length}/${results.length} case(s) failed.`)
  process.exit(1)
}

console.log(`Router evaluation passed: ${results.length}/${results.length} cases.`)