/**
 * System monitoring tools — CPU, RAM, disk, processes, kill, run PowerShell.
 */
import { cpus, freemem, totalmem, uptime, platform, hostname } from 'node:os'
import { runTerminal } from './terminal.js'
import type { ToolDefinition, ToolHandler } from './types.js'

// ── sys_stats ─────────────────────────────────────────────────────────────────

export const sysStatsDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'sys_stats',
    description: 'Get real-time system stats: CPU model/count, RAM usage, disk space, uptime.',
    parameters: { type: 'object', properties: {} },
  },
}

export const sysStats: ToolHandler = async () => {
  try {
    const totalMem = totalmem()
    const freeMem = freemem()
    const usedMem = totalMem - freeMem
    const cpuInfo = cpus()
    const diskOut = await runTerminal({
      command: `Get-PSDrive C | Select-Object @{N='UsedGB';E={[math]::Round($_.Used/1GB,1)}},@{N='FreeGB';E={[math]::Round($_.Free/1GB,1)}} | ConvertTo-Json -Compress`,
    })
    return [
      `Platform: ${platform()} | Host: ${hostname()}`,
      `CPU: ${cpuInfo[0]?.model ?? 'Unknown'} (${cpuInfo.length} cores)`,
      `RAM: ${(usedMem / 1073741824).toFixed(1)} GB used / ${(totalMem / 1073741824).toFixed(1)} GB total (${((usedMem / totalMem) * 100).toFixed(0)}%)`,
      `Uptime: ${Math.floor(uptime() / 3600)}h ${Math.floor((uptime() % 3600) / 60)}m`,
      `Disk C: ${diskOut.trim()}`,
    ].join('\n')
  } catch (err) { return `Error: ${err instanceof Error ? err.message : String(err)}` }
}

// ── sys_processes ─────────────────────────────────────────────────────────────

export const sysProcessesDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'sys_processes',
    description: 'List running processes, sorted by CPU or memory usage.',
    parameters: {
      type: 'object',
      properties: {
        sort_by: { type: 'string', description: 'cpu (default) or memory.' },
        filter: { type: 'string', description: 'Filter by process name (partial match).' },
        top: { type: 'string', description: 'Max results (default 15).' },
      },
    },
  },
}

export const sysProcesses: ToolHandler = (args) => {
  const top = parseInt(args.top ?? '15', 10) || 15
  const sortProp = args.sort_by === 'memory' ? 'WS' : 'CPU'
  const filterClause = args.filter
    ? `| Where-Object { $_.Name -like '*${args.filter.replace(/'/g, "''")}*' } `
    : ''
  return runTerminal({
    command: `Get-Process ${filterClause}| Sort-Object ${sortProp} -Descending | Select-Object -First ${top} Name,Id,@{N='CPU_s';E={[math]::Round($_.CPU,1)}},@{N='Mem_MB';E={[math]::Round($_.WS/1MB,1)}} | Format-Table -AutoSize | Out-String`,
  })
}

// ── sys_kill ──────────────────────────────────────────────────────────────────

export const sysKillDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'sys_kill',
    description: 'Kill a running process by name or PID.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Process name (e.g. "notepad", "chrome").' },
        pid: { type: 'string', description: 'Process ID.' },
      },
    },
  },
}

export const sysKill: ToolHandler = (args) => {
  if (args.pid) {
    return runTerminal({ command: `Stop-Process -Id ${args.pid} -Force; Write-Output "Killed PID ${args.pid}"` })
  }
  if (args.name) {
    const n = args.name.replace(/'/g, "''")
    return runTerminal({ command: `Stop-Process -Name '${n}' -Force -ErrorAction SilentlyContinue; Write-Output "Killed: ${n}"` })
  }
  return Promise.resolve('Error: provide name or pid')
}

// ── sys_run ───────────────────────────────────────────────────────────────────

export const sysRunDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'sys_run',
    description: 'Run a PowerShell command and return its output. For system tasks: registry, services, networking, disk, etc.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'PowerShell command or script.' },
      },
      required: ['command'],
    },
  },
}

export const sysRun: ToolHandler = (args) => {
  if (!args.command) return Promise.resolve('Error: command required')
  return runTerminal({ command: args.command })
}

// ── sys_env ───────────────────────────────────────────────────────────────────

export const sysEnvDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'sys_env',
    description: 'Get or set Windows environment variables.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Variable name. Omit to list all.' },
        value: { type: 'string', description: 'If provided, set this variable to value.' },
      },
    },
  },
}

export const sysEnv: ToolHandler = (args) => {
  if (args.name && args.value !== undefined) {
    const n = args.name.replace(/'/g, "''")
    const v = args.value.replace(/'/g, "''")
    return runTerminal({ command: `[System.Environment]::SetEnvironmentVariable('${n}', '${v}', 'User'); Write-Output "Set ${n}=${v}"` })
  }
  if (args.name) {
    const n = args.name.replace(/'/g, "''")
    return runTerminal({ command: `[System.Environment]::GetEnvironmentVariable('${n}', 'User') ?? $env:${n}` })
  }
  return runTerminal({ command: `Get-ChildItem Env: | Format-Table -AutoSize | Out-String` })
}
