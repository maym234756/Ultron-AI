import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import type { ProjectBuildResult } from './projectBuilder.js'

export type ProjectAction = 'openExplorer' | 'openVsCode' | 'openTerminal' | 'openProjectPlan' | 'runInstall' | 'runBuild' | 'runDevServer' | 'stopDevServer' | 'runRepair'

export type ProjectRecord = {
  id: string
  projectName: string
  projectPath: string
  templateId: string
  templateLabel: string
  stack: string
  installCommand?: string
  buildCommand?: string
  devCommand?: string
  previewUrl?: string
  createdAt: number
  updatedAt: number
  lastBuildStatus?: string
  lastAction?: string
  lastLog?: string
}

type ProjectStore = {
  projects: ProjectRecord[]
}

const memoryDir = path.join(os.homedir(), '.ultron')
const memoryFile = path.join(memoryDir, 'project-memory.json')
const devServers = new Map<string, ReturnType<typeof spawn>>()
const repairFileExtensions = new Set(['.css', '.html', '.js', '.jsx', '.json', '.mjs', '.py', '.ts', '.tsx'])
const repairSkipDirs = new Set(['.git', 'dist', 'build', 'node_modules', '.vite', '.next', '__pycache__'])

function projectId(projectPath: string): string {
  return Buffer.from(path.resolve(projectPath).toLowerCase()).toString('base64url')
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function commandFailed(output: string): boolean {
  return /\[exit code \d+\]|\bError:/i.test(output)
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n...[truncated]` : value
}

function safeProjectFile(projectPath: string, relativePath: string): string {
  const normalized = path.normalize(relativePath).replace(/^([/\\])+/, '')
  const fullPath = path.resolve(projectPath, normalized)
  const root = path.resolve(projectPath)
  if (fullPath !== root && !fullPath.startsWith(root + path.sep)) throw new Error(`Repair path escapes the project: ${relativePath}`)
  return fullPath
}

function previewUrlFor(record: ProjectRecord, output = ''): string | undefined {
  const match = output.match(/https?:\/\/localhost:\d+(?:\/[^\s]*)?/i)
  if (match) return match[0]
  if (record.templateId === 'vanilla-ts') return 'http://localhost:5174'
  if (record.templateId === 'express-api') return 'http://localhost:3000/health'
  return record.previewUrl
}

async function ensureProjectPlan(record: ProjectRecord): Promise<string> {
  const planPath = safeProjectFile(record.projectPath, 'ULTRON_PROJECT_PLAN.md')
  try {
    await fs.access(planPath)
  } catch {
    await fs.writeFile(planPath, `# Ultron Project Plan - ${record.projectName}

Recovered from Ultron Project Memory.

## Starting Point

- Template: ${record.templateLabel}
- Stack: ${record.stack}
- Install: ${record.installCommand ?? 'Not required'}
- Check/build: ${record.buildCommand ?? 'Not configured'}
- Dev server: ${record.devCommand ?? 'Not configured'}

## Recommended Loop

1. Open the project in VS Code.
2. Run Install if dependencies are missing.
3. Run Check, then Fix if needed.
4. Start Dev, inspect Preview, and stop the dev server when done.
5. Keep this plan updated as the project becomes real.
`, 'utf-8')
  }
  return planPath
}

async function readStore(): Promise<ProjectStore> {
  try {
    const raw = await fs.readFile(memoryFile, 'utf-8')
    const parsed = JSON.parse(raw) as ProjectStore
    return { projects: Array.isArray(parsed.projects) ? parsed.projects : [] }
  } catch {
    return { projects: [] }
  }
}

async function writeStore(store: ProjectStore): Promise<void> {
  await fs.mkdir(memoryDir, { recursive: true })
  await fs.writeFile(memoryFile, JSON.stringify(store, null, 2) + '\n', 'utf-8')
}

async function patchProject(id: string, patch: Partial<ProjectRecord>): Promise<ProjectRecord> {
  const store = await readStore()
  const index = store.projects.findIndex(project => project.id === id)
  if (index < 0) throw new Error('Project is not in Ultron memory.')
  const next = { ...store.projects[index], ...patch, updatedAt: Date.now() }
  store.projects[index] = next
  await writeStore(store)
  return next
}

async function runCommand(command: string, cwd: string, timeoutSec = 240): Promise<string> {
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

function startDevServer(record: ProjectRecord): Promise<string> {
  if (!record.devCommand) throw new Error('This project does not have a dev command.')
  const devCommand = record.devCommand
  const existing = devServers.get(record.id)
  if (existing && !existing.killed) return Promise.resolve('Dev server is already running.')

  return new Promise(resolve => {
    const proc = spawn('powershell.exe', ['-NoProfile', '-Command', devCommand], {
      cwd: record.projectPath,
      windowsHide: true,
      stdio: 'pipe',
    })
    devServers.set(record.id, proc)
    let output = ''
    let settled = false
    const collect = (chunk: Buffer) => {
      output += chunk.toString()
      if (output.length > 6000) output = output.slice(-6000)
    }
    const settle = (message: string) => {
      if (settled) return
      settled = true
      resolve(message.trim() || 'Dev server is starting.')
    }

    proc.stdout?.on('data', collect)
    proc.stderr?.on('data', collect)
    proc.on('error', (err: Error) => {
      devServers.delete(record.id)
      settle(`Error: ${err.message}`)
    })
    proc.on('close', (code: number | null) => {
      devServers.delete(record.id)
      void patchProject(record.id, {
        lastAction: `Dev server stopped${typeof code === 'number' ? ` with exit code ${code}` : ''}.`,
        lastLog: output.trim(),
      }).catch(() => {})
      settle(output || `Dev server stopped${typeof code === 'number' ? ` with exit code ${code}` : ''}.`)
    })
    setTimeout(() => settle(output || 'Dev server is starting.'), 2500)
  })
}

function stopDevServer(record: ProjectRecord): Promise<string> {
  const existing = devServers.get(record.id)
  if (!existing || existing.killed) return Promise.resolve('No tracked dev server is running for this project.')
  if (process.platform !== 'win32' || !existing.pid) {
    existing.kill('SIGTERM')
    devServers.delete(record.id)
    return Promise.resolve('Dev server stop requested.')
  }
  return new Promise(resolve => {
    const killer = spawn('taskkill.exe', ['/PID', String(existing.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'pipe',
    })
    let output = ''
    killer.stdout?.on('data', chunk => { output += chunk.toString() })
    killer.stderr?.on('data', chunk => { output += chunk.toString() })
    killer.on('close', code => {
      devServers.delete(record.id)
      resolve(code === 0 ? 'Dev server stop requested.' : (output.trim() || `Dev server stop returned exit code ${code ?? '?'}.`))
    })
    killer.on('error', err => {
      existing.kill('SIGTERM')
      devServers.delete(record.id)
      resolve(`Dev server stop fallback used: ${err.message}`)
    })
  })
}

async function collectRepairFiles(projectPath: string, dir = projectPath, collected: string[] = []): Promise<string[]> {
  if (collected.length >= 40) return collected
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (collected.length >= 40) break
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!repairSkipDirs.has(entry.name)) await collectRepairFiles(projectPath, fullPath, collected)
      continue
    }
    if (!entry.isFile()) continue
    if (!repairFileExtensions.has(path.extname(entry.name).toLowerCase())) continue
    const stat = await fs.stat(fullPath)
    if (stat.size > 24_000) continue
    collected.push(path.relative(projectPath, fullPath).replace(/\\/g, '/'))
  }
  return collected
}

async function buildRepairContext(record: ProjectRecord, buildOutput: string): Promise<string> {
  const files = await collectRepairFiles(record.projectPath)
  const parts = [
    `Project: ${record.projectName}`,
    `Template: ${record.templateLabel}`,
    `Stack: ${record.stack}`,
    `Build command: ${record.buildCommand}`,
    `Build output:\n${truncate(buildOutput, 9000)}`,
    'Editable files:',
  ]
  for (const file of files) {
    const fullPath = safeProjectFile(record.projectPath, file)
    const content = await fs.readFile(fullPath, 'utf-8')
    parts.push(`\n--- FILE: ${file} ---\n${truncate(content, 12000)}`)
  }
  return truncate(parts.join('\n'), 45_000)
}

function extractJsonArray(value: string): unknown {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const source = fenced?.[1] ?? value
  const start = source.indexOf('[')
  const end = source.lastIndexOf(']')
  if (start < 0 || end < start) throw new Error('Repair model did not return a JSON array.')
  return JSON.parse(source.slice(start, end + 1))
}

type RepairEdit = {
  path: string
  content: string
  reason?: string
}

function parseRepairEdits(raw: unknown): RepairEdit[] {
  if (!Array.isArray(raw)) throw new Error('Repair response must be a JSON array.')
  return raw.slice(0, 6).map((item) => {
    if (!item || typeof item !== 'object') throw new Error('Repair edit must be an object.')
    const edit = item as Partial<RepairEdit>
    if (typeof edit.path !== 'string' || typeof edit.content !== 'string') throw new Error('Repair edit needs path and content.')
    return { path: edit.path, content: edit.content, reason: typeof edit.reason === 'string' ? edit.reason : undefined }
  })
}

async function proposeRepairEdits(record: ProjectRecord, buildOutput: string): Promise<RepairEdit[]> {
  const context = await buildRepairContext(record, buildOutput)
  const response = await fetch(`${process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL ?? 'qwen2.5:14b',
      stream: false,
      messages: [
        {
          role: 'system',
          content: 'You repair small programming project build errors. Return only JSON. Use full-file replacements, not diffs. Edit the fewest files possible. Never include markdown outside JSON.',
        },
        {
          role: 'user',
          content: `${context}\n\nReturn a JSON array of edits like [{"path":"src/main.js","reason":"fixed import","content":"full file content"}]. If no safe fix is possible, return [].`,
        },
      ],
      options: { temperature: 0.12, num_ctx: 16384, num_predict: 4096 },
    }),
    signal: AbortSignal.timeout(180_000),
  })
  if (!response.ok) throw new Error(`Repair model returned HTTP ${response.status}`)
  const data = await response.json() as { message?: { content?: string } }
  return parseRepairEdits(extractJsonArray(data.message?.content ?? ''))
}

async function applyRepairEdits(record: ProjectRecord, edits: RepairEdit[]): Promise<string[]> {
  const applied: string[] = []
  for (const edit of edits) {
    const fullPath = safeProjectFile(record.projectPath, edit.path)
    const relativePath = path.relative(record.projectPath, fullPath).replace(/\\/g, '/')
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, edit.content, 'utf-8')
    applied.push(`${relativePath}${edit.reason ? `: ${edit.reason}` : ''}`)
  }
  return applied
}

async function runRepair(record: ProjectRecord): Promise<string> {
  if (!record.buildCommand) throw new Error('This project does not have a build or check command.')
  const firstCheck = await runCommand(record.buildCommand, record.projectPath, 240)
  if (!commandFailed(firstCheck)) return `Check already passes.\n\n${firstCheck}`

  const edits = await proposeRepairEdits(record, firstCheck)
  if (edits.length === 0) return `Check failed, but Ultron could not find a safe automatic repair.\n\n${firstCheck}`
  const applied = await applyRepairEdits(record, edits)
  const secondCheck = await runCommand(record.buildCommand, record.projectPath, 240)
  return [
    `First check failed. Applied ${applied.length} repair edit(s):`,
    ...applied.map(item => `- ${item}`),
    '',
    commandFailed(secondCheck) ? 'Second check still needs attention:' : 'Second check passed:',
    secondCheck,
  ].join('\n')
}

export async function rememberProject(result: ProjectBuildResult): Promise<ProjectRecord> {
  const store = await readStore()
  const id = projectId(result.projectPath)
  const existing = store.projects.find(project => project.id === id)
  const now = Date.now()
  const record: ProjectRecord = {
    id,
    projectName: result.projectName,
    projectPath: result.projectPath,
    templateId: result.template.id,
    templateLabel: result.template.label,
    stack: result.template.stack,
    installCommand: result.template.installCommand,
    buildCommand: result.template.buildCommand,
    devCommand: result.template.devCommand,
    previewUrl: existing?.previewUrl,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastBuildStatus: result.logs.some(commandFailed) ? 'Check needs attention' : 'Ready',
    lastAction: 'Project created by Ultron.',
    lastLog: result.logs.join('\n\n').slice(-6000),
  }
  store.projects = [record, ...store.projects.filter(project => project.id !== id)].slice(0, 50)
  await writeStore(store)
  return record
}

export async function listProjectRecords(): Promise<ProjectRecord[]> {
  const store = await readStore()
  return store.projects.slice().sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function runProjectAction(id: string, action: ProjectAction): Promise<{ record: ProjectRecord; output: string }> {
  const record = (await listProjectRecords()).find(project => project.id === id)
  if (!record) throw new Error('Project is not in Ultron memory.')

  let output = ''
  if (action === 'openExplorer') {
    output = await runCommand(`Start-Process explorer.exe -ArgumentList ${quotePowerShell(record.projectPath)}`, record.projectPath, 20)
    return { record: await patchProject(id, { lastAction: 'Opened project folder.', lastLog: output }), output }
  }
  if (action === 'openVsCode') {
    output = await runCommand(`Start-Process code -ArgumentList ${quotePowerShell(record.projectPath)}`, record.projectPath, 20)
    return { record: await patchProject(id, { lastAction: 'Opened project in VS Code.', lastLog: output }), output }
  }
  if (action === 'openTerminal') {
    output = await runCommand(`Start-Process powershell.exe -WorkingDirectory ${quotePowerShell(record.projectPath)}`, record.projectPath, 20)
    return { record: await patchProject(id, { lastAction: 'Opened project terminal.', lastLog: output }), output }
  }
  if (action === 'openProjectPlan') {
    const planPath = await ensureProjectPlan(record)
    output = await runCommand(`Start-Process code -ArgumentList ${quotePowerShell(planPath)}`, record.projectPath, 20)
    return { record: await patchProject(id, { lastAction: 'Opened project plan.', lastLog: output }), output }
  }
  if (action === 'runInstall') {
    if (!record.installCommand) throw new Error('This project does not have an install command.')
    output = await runCommand(record.installCommand, record.projectPath, 300)
    return {
      record: await patchProject(id, {
        lastAction: `Ran ${record.installCommand}.`,
        lastLog: output.slice(-6000),
      }),
      output,
    }
  }
  if (action === 'runBuild') {
    if (!record.buildCommand) throw new Error('This project does not have a build or check command.')
    output = await runCommand(record.buildCommand, record.projectPath, 240)
    return {
      record: await patchProject(id, {
        lastBuildStatus: commandFailed(output) ? 'Check failed' : 'Check passed',
        lastAction: `Ran ${record.buildCommand}.`,
        lastLog: output.slice(-6000),
      }),
      output,
    }
  }
  if (action === 'runRepair') {
    output = await runRepair(record)
    return {
      record: await patchProject(id, {
        lastBuildStatus: commandFailed(output) ? 'Repair needs attention' : 'Repaired',
        lastAction: 'Ran automatic repair loop.',
        lastLog: output.slice(-6000),
      }),
      output,
    }
  }
  if (action === 'runDevServer') {
    output = await startDevServer(record)
    const nextPreviewUrl = previewUrlFor(record, output)
    return {
      record: await patchProject(id, {
        previewUrl: nextPreviewUrl,
        lastAction: 'Started dev server.',
        lastLog: output.slice(-6000),
      }),
      output,
    }
  }
  if (action === 'stopDevServer') {
    output = await stopDevServer(record)
    return {
      record: await patchProject(id, {
        lastAction: 'Stopped dev server.',
        lastLog: output,
      }),
      output,
    }
  }

  throw new Error('Unsupported project action.')
}