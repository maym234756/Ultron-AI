import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export type UpgradeRisk = 'low' | 'medium' | 'high'
export type UpgradeStatus = 'pending' | 'running' | 'previewed' | 'applied' | 'rolled_back' | 'dismissed'

export type UpgradePack = {
  id: string
  label: string
  description: string
  task: string
  risk: UpgradeRisk
  impact: string
  filesAffected: string[]
  requiredValidation: string[]
}

export type SelfUpgradeBacklogItem = {
  id: string
  title: string
  prompt: string
  risk: UpgradeRisk
  impact: string
  filesAffected: string[]
  requiredValidation: string[]
  packId: string | null
  status: UpgradeStatus
  createdAt: number
  updatedAt: number
}

type SelfUpgradeStore = {
  backlog: SelfUpgradeBacklogItem[]
}

const storePath = path.join(os.homedir(), '.lumivex-self-upgrade.json')

export const UPGRADE_PACKS: UpgradePack[] = [
  {
    id: 'router-intelligence',
    label: 'Router Intelligence Pack',
    description: 'Improve Chat/Agent and intelligence-profile decisions, router tests, and decision explanations.',
    task: 'Improve Lumivex AI router intelligence. Review src/lib/promptRouter.ts, server/promptRouter.ts, scripts/router-eval.ts, and the route decision UI. Add one focused improvement with tests or validation, using preview_write for any file changes.',
    risk: 'medium',
    impact: 'Higher route accuracy and more trustworthy automatic mode selection.',
    filesAffected: ['src/lib/promptRouter.ts', 'server/promptRouter.ts', 'scripts/router-eval.ts', 'src/App.tsx'],
    requiredValidation: ['npm run test:router', 'npm run build'],
  },
  {
    id: 'coding-mission-control',
    label: 'Coding Mission Control Pack',
    description: 'Improve project generation, toolchain readiness, build/repair loops, visual previews, and end-to-end coding orchestration.',
    task: 'Improve Lumivex AI as an end-to-end coding AI. Review server/projectBuilder.ts, server/projectMemory.ts, server/tools/coding.ts, server/tools/preview.ts, server/tools/playwright.ts, and src/components/ProjectBuilderPanel.tsx. Add one focused improvement that makes project creation, validation, repair, preview, or toolchain setup stronger. Use preview_write for any file changes and validate with npm run build.',
    risk: 'medium',
    impact: 'More reliable start-to-finish software creation with clearer project status and stronger build loops.',
    filesAffected: ['server/projectBuilder.ts', 'server/projectMemory.ts', 'server/tools/coding.ts', 'server/tools/preview.ts', 'server/tools/playwright.ts', 'src/components/ProjectBuilderPanel.tsx'],
    requiredValidation: ['npm run build', 'project-builder smoke test'],
  },
  {
    id: 'connector-pack',
    label: 'Connector Pack',
    description: 'Improve connector setup, approvals, auditability, and native action reliability.',
    task: 'Improve Lumivex AI connector workflows. Review server/connectors.ts, server/connectorSetup.ts, src/components/ConnectorsPanel.tsx, and connector-related tools. Add one focused reliability or safety improvement using preview_write.',
    risk: 'high',
    impact: 'Safer and more useful external-account automation.',
    filesAffected: ['server/connectors.ts', 'server/connectorSetup.ts', 'src/components/ConnectorsPanel.tsx'],
    requiredValidation: ['npm run build', 'connector status smoke test'],
  },
  {
    id: 'performance-pack',
    label: 'Performance Pack',
    description: 'Reduce local-model latency and unnecessary tool/context overhead.',
    task: 'Improve Lumivex AI performance. Review server/index.ts, server/agent.ts, and src/lib/telemetry.ts. Add one focused latency or diagnostics improvement using preview_write and validate it.',
    risk: 'medium',
    impact: 'Faster first-token time and clearer latency diagnosis.',
    filesAffected: ['server/index.ts', 'server/agent.ts', 'src/lib/telemetry.ts', 'src/components/HealthPanel.tsx'],
    requiredValidation: ['npm run build', 'health check'],
  },
  {
    id: 'ui-polish-pack',
    label: 'UI Polish Pack',
    description: 'Improve the chat workspace, loading states, accessibility, and command surfaces.',
    task: 'Improve Lumivex AI UI polish. Review src/App.tsx, src/App.css, and src/components. Add one focused accessibility, layout, or command-center improvement using preview_write.',
    risk: 'medium',
    impact: 'More professional and controllable workspace experience.',
    filesAffected: ['src/App.tsx', 'src/App.css', 'src/components'],
    requiredValidation: ['npm run build'],
  },
  {
    id: 'memory-pack',
    label: 'Memory Pack',
    description: 'Improve memory quality, promotion, conflict handling, and review workflows.',
    task: 'Improve Lumivex AI Memory 2.0. Review server/tools/longmem.ts, server/index.ts memory APIs, and src/components/MemoryPanel.tsx. Add one focused memory quality improvement using preview_write.',
    risk: 'medium',
    impact: 'Cleaner personalization and less stale context pollution.',
    filesAffected: ['server/tools/longmem.ts', 'server/index.ts', 'src/components/MemoryPanel.tsx'],
    requiredValidation: ['npm run build', 'memory endpoint smoke test'],
  },
]

function readStore(): SelfUpgradeStore {
  try {
    if (!fs.existsSync(storePath)) return { backlog: [] }
    const parsed = JSON.parse(fs.readFileSync(storePath, 'utf-8')) as Partial<SelfUpgradeStore>
    return { backlog: Array.isArray(parsed.backlog) ? parsed.backlog : [] }
  } catch {
    return { backlog: [] }
  }
}

function writeStore(store: SelfUpgradeStore): void {
  fs.writeFileSync(storePath, JSON.stringify({ backlog: store.backlog.slice(0, 200) }, null, 2), 'utf-8')
}

function packToBacklogItem(pack: UpgradePack): SelfUpgradeBacklogItem {
  return {
    id: `pack-${pack.id}`,
    title: pack.label,
    prompt: pack.task,
    risk: pack.risk,
    impact: pack.impact,
    filesAffected: pack.filesAffected,
    requiredValidation: pack.requiredValidation,
    packId: pack.id,
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

function ensureSeedBacklog(store: SelfUpgradeStore): SelfUpgradeStore {
  const missingPacks = UPGRADE_PACKS.filter(pack => !store.backlog.some(item => item.packId === pack.id))
  if (store.backlog.length > 0 && missingPacks.length === 0) return store
  const seeded = [...missingPacks.map(packToBacklogItem), ...store.backlog]
  const next = { backlog: seeded }
  writeStore(next)
  return next
}

export function getSelfUpgradeSnapshot(): { packs: UpgradePack[]; backlog: SelfUpgradeBacklogItem[] } {
  const store = ensureSeedBacklog(readStore())
  return { packs: UPGRADE_PACKS, backlog: store.backlog }
}

export function getUpgradePack(packId: string | undefined): UpgradePack | null {
  if (!packId) return null
  return UPGRADE_PACKS.find(pack => pack.id === packId) ?? null
}

export function inferUpgradeMeta(task: string, pack: UpgradePack | null): Pick<SelfUpgradeBacklogItem, 'risk' | 'impact' | 'filesAffected' | 'requiredValidation'> {
  if (pack) return {
    risk: pack.risk,
    impact: pack.impact,
    filesAffected: pack.filesAffected,
    requiredValidation: pack.requiredValidation,
  }
  const lower = task.toLowerCase()
  const risk: UpgradeRisk = /security|connector|auth|delete|write|apply|server|api/.test(lower) ? 'high' : /performance|agent|router|memory/.test(lower) ? 'medium' : 'low'
  const filesAffected = [
    /ui|css|panel|button|chat|frontend/.test(lower) ? 'src/App.tsx / src/App.css / src/components' : null,
    /server|api|endpoint|agent|performance|latency/.test(lower) ? 'server/index.ts / server/agent.ts' : null,
    /memory/.test(lower) ? 'server/tools/longmem.ts / src/components/MemoryPanel.tsx' : null,
    /connector|salesforce|gmail|sheets/.test(lower) ? 'server/connectors.ts / src/components/ConnectorsPanel.tsx' : null,
  ].filter((item): item is string => Boolean(item))
  return {
    risk,
    impact: 'Custom improvement requested by the user.',
    filesAffected: filesAffected.length ? filesAffected : ['src/ or server/'],
    requiredValidation: ['npm run build'],
  }
}

export function recordSelfUpgradeRun(task: string, packId?: string): SelfUpgradeBacklogItem {
  const store = ensureSeedBacklog(readStore())
  const pack = getUpgradePack(packId)
  const meta = inferUpgradeMeta(task, pack)
  const existingIdx = pack ? store.backlog.findIndex(item => item.packId === pack.id) : -1
  const now = Date.now()
  const item: SelfUpgradeBacklogItem = {
    id: existingIdx >= 0 ? store.backlog[existingIdx].id : randomUUID(),
    title: pack?.label ?? task.trim().slice(0, 80),
    prompt: task.trim(),
    packId: pack?.id ?? null,
    status: 'running',
    createdAt: existingIdx >= 0 ? store.backlog[existingIdx].createdAt : now,
    updatedAt: now,
    ...meta,
  }
  if (existingIdx >= 0) store.backlog[existingIdx] = item
  else store.backlog.unshift(item)
  writeStore(store)
  return item
}

export function updateSelfUpgradeBacklogItem(id: string, patch: Partial<Pick<SelfUpgradeBacklogItem, 'status' | 'impact' | 'filesAffected' | 'requiredValidation'>>): SelfUpgradeBacklogItem | null {
  const store = ensureSeedBacklog(readStore())
  const idx = store.backlog.findIndex(item => item.id === id)
  if (idx < 0) return null
  store.backlog[idx] = { ...store.backlog[idx], ...patch, updatedAt: Date.now() }
  writeStore(store)
  return store.backlog[idx]
}

export function buildSelfUpgradePrompt(task: string, item: SelfUpgradeBacklogItem, pack: UpgradePack | null): string {
  return [
    pack ? `UPGRADE PACK: ${pack.label}` : 'CUSTOM SELF-UPGRADE TASK',
    `REQUEST: ${task.trim()}`,
    '',
    'BACKLOG METADATA:',
    `- Risk level: ${item.risk}`,
    `- Impact estimate: ${item.impact}`,
    `- Files likely affected: ${item.filesAffected.join(', ')}`,
    `- Required validation: ${item.requiredValidation.join(', ')}`,
    '',
    'Before proposing changes, inspect the likely affected files. If you propose file edits, queue them with preview_write only. Include rollback notes in your final answer: what old behavior/content can be restored if the preview is applied and later rolled back.',
  ].join('\n')
}