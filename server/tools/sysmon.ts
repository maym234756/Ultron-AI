/**
 * System monitoring tools — CPU, RAM, disk, processes, kill, run PowerShell.
 */
import { spawn } from 'node:child_process'
import { arch, cpus, freemem, homedir, hostname, platform, tmpdir, totalmem, uptime } from 'node:os'
import { runTerminal } from './terminal.js'
import type { ToolDefinition, ToolHandler } from './types.js'

function isWindows(): boolean {
  return platform() === 'win32'
}

function isMac(): boolean {
  return platform() === 'darwin'
}

function isLinux(): boolean {
  return platform() === 'linux'
}

function cleanOutput(output: string): string {
  return output
    .replace(/\n\[exit code [^\]]+\]/g, '')
    .replace(/\n\[shell [^\]]+\]$/g, '')
    .trim()
}

function toGB(bytes: number): string {
  return `${(bytes / 1073741824).toFixed(1)} GB`
}

async function runLocalShell(command: string): Promise<string> {
  if (isWindows()) return cleanOutput(await runTerminal({ command }))
  const shell = process.env.SHELL || '/bin/bash'
  return new Promise((resolve) => {
    const proc = spawn(shell, ['-lc', command], {
      cwd: process.cwd(),
      stdio: 'pipe',
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      settled = true
      proc.kill('SIGTERM')
      resolve('Error: command timed out after 120 seconds')
    }, 120_000)
    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    proc.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const raw = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n').trim()
      const exitNote = code && code !== 0 ? `\n[exit code ${code}]` : ''
      resolve(cleanOutput((raw || '(no output)') + exitNote))
    })
    proc.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(`Error: ${err.message}`)
    })
  })
}

function normalizeBool(value: string | undefined): boolean {
  return (value ?? '').trim().toLowerCase() === 'true'
}

type UnixProcess = {
  user: string
  pid: string
  cpu: string
  mem: string
  command: string
}

async function listUnixProcesses(sortBy: 'cpu' | 'memory', filter: string, top: number): Promise<string> {
  const sortFlag = sortBy === 'memory' ? '-%mem' : '-%cpu'
  const raw = await runLocalShell(`ps aux --sort=${sortFlag}`)
  if (raw.startsWith('Error:')) return raw
  const lines = cleanOutput(raw).split('\n').filter(Boolean)
  if (lines.length <= 1) return 'No processes found.'

  const rows = lines
    .slice(1)
    .map((line): UnixProcess => {
      const parts = line.trim().split(/\s+/, 11)
      return {
        user: parts[0] ?? '',
        pid: parts[1] ?? '',
        cpu: parts[2] ?? '',
        mem: parts[3] ?? '',
        command: parts[10] ?? '',
      }
    })
    .filter((row) => !filter || row.command.toLowerCase().includes(filter.toLowerCase()) || row.pid === filter)
    .slice(0, top)

  if (!rows.length) return 'No matching processes found.'
  return [
    'USER       PID      CPU%   MEM%   COMMAND',
    ...rows.map((row) => `${row.user.padEnd(10)} ${row.pid.padEnd(8)} ${row.cpu.padEnd(6)} ${row.mem.padEnd(6)} ${row.command}`),
  ].join('\n')
}

async function previewUnixProcess(args: Record<string, string>): Promise<string> {
  const raw = await runLocalShell('ps -axo pid=,comm=,%cpu=,%mem=')
  if (raw.startsWith('Error:')) return raw
  const rows = cleanOutput(raw)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/, 4)
      return {
        pid: parts[0] ?? '',
        name: parts[1] ?? '',
        cpu: parts[2] ?? '',
        mem: parts[3] ?? '',
      }
    })

  const matches = rows.filter((row) => (
    args.pid ? row.pid === args.pid : row.name.toLowerCase().includes((args.name ?? '').toLowerCase())
  ))

  if (!matches.length) return 'No matching process found.'
  return [
    'Preview only (dry_run=true):',
    'NAME                 PID      CPU%   MEM%',
    ...matches.map((row) => `${row.name.padEnd(20)} ${row.pid.padEnd(8)} ${row.cpu.padEnd(6)} ${row.mem}`),
  ].join('\n')
}

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

    if (isWindows()) {
      const diskOut = cleanOutput(await runTerminal({
        command: `Get-PSDrive C | Select-Object @{N='UsedGB';E={[math]::Round($_.Used/1GB,1)}},@{N='FreeGB';E={[math]::Round($_.Free/1GB,1)}} | ConvertTo-Json -Compress`,
      }))
      return [
        `Platform: ${platform()} | Host: ${hostname()}`,
        `CPU: ${cpuInfo[0]?.model ?? 'Unknown'} (${cpuInfo.length} cores)`,
        `RAM: ${toGB(usedMem)} used / ${toGB(totalMem)} total (${((usedMem / totalMem) * 100).toFixed(0)}%)`,
        `Uptime: ${Math.floor(uptime() / 3600)}h ${Math.floor((uptime() % 3600) / 60)}m`,
        `Disk C: ${diskOut}`,
      ].join('\n')
    }

    if (isLinux()) {
      const [memOut, diskOut, uptimeOut, cpuOut] = await Promise.all([
        runLocalShell('free -b'),
        runLocalShell('df -h /'),
        runLocalShell('uptime'),
        runLocalShell(`awk -F: '/model name/{gsub(/^[ \t]+/, "", $2); print $2; exit}' /proc/cpuinfo`),
      ])
      const cpuModel = cleanOutput(cpuOut) || cpuInfo[0]?.model || 'Unknown'
      return [
        `Platform: ${platform()} | Host: ${hostname()}`,
        `CPU: ${cpuModel} (${cpuInfo.length} cores)`,
        `RAM: ${toGB(usedMem)} used / ${toGB(totalMem)} total (${((usedMem / totalMem) * 100).toFixed(0)}%)`,
        `Uptime: ${cleanOutput(uptimeOut)}`,
        `Disk /: ${cleanOutput(diskOut)}`,
        `free -b:\n${cleanOutput(memOut)}`,
      ].join('\n')
    }

    if (isMac()) {
      const [cpuOut, diskOut, vmOut, uptimeOut] = await Promise.all([
        runLocalShell('sysctl -n machdep.cpu.brand_string'),
        runLocalShell('df -h /'),
        runLocalShell('vm_stat'),
        runLocalShell('uptime'),
      ])
      const cpuModel = cleanOutput(cpuOut) || cpuInfo[0]?.model || 'Unknown'
      return [
        `Platform: ${platform()} | Host: ${hostname()}`,
        `CPU: ${cpuModel} (${cpuInfo.length} cores)`,
        `RAM: ${toGB(usedMem)} used / ${toGB(totalMem)} total (${((usedMem / totalMem) * 100).toFixed(0)}%)`,
        `Uptime: ${cleanOutput(uptimeOut)}`,
        `Disk /: ${cleanOutput(diskOut)}`,
        `vm_stat:\n${cleanOutput(vmOut)}`,
      ].join('\n')
    }

    return `Unsupported platform: ${platform()}`
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`
  }
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
        sort_by: { type: 'string', description: 'cpu (default) or memory.', enum: ['cpu', 'memory'] },
        filter: { type: 'string', description: 'Filter by process name (partial match).' },
        top: { type: 'string', description: 'Max results (default 15).' },
      },
    },
  },
}

export const sysProcesses: ToolHandler = async (args) => {
  const top = parseInt(args.top ?? '15', 10) || 15
  const sortBy = args.sort_by === 'memory' ? 'memory' : 'cpu'

  if (isWindows()) {
    const sortProp = sortBy === 'memory' ? 'WS' : 'CPU'
    const filterClause = args.filter
      ? `| Where-Object { $_.Name -like '*${args.filter.replace(/'/g, "''")}*' } `
      : ''
    return runTerminal({
      command: `Get-Process ${filterClause}| Sort-Object ${sortProp} -Descending | Select-Object -First ${top} Name,Id,@{N='CPU_s';E={[math]::Round($_.CPU,1)}},@{N='Mem_MB';E={[math]::Round($_.WS/1MB,1)}} | Format-Table -AutoSize | Out-String`,
    })
  }

  return listUnixProcesses(sortBy, (args.filter ?? '').trim(), top)
}

// ── sys_services ──────────────────────────────────────────────────────────────

export const sysServicesDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'sys_services',
    description: 'List Windows services, optionally filtered by name and status.',
    parameters: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Partial match against service name or display name.' },
        status: { type: 'string', description: 'running, stopped, or all.', enum: ['running', 'stopped', 'all'] },
      },
    },
  },
}

export const sysServices: ToolHandler = async (args) => {
  if (!isWindows()) return 'sys_services is currently supported on Windows only.'
  const filter = (args.filter ?? '').replace(/'/g, "''")
  const status = (args.status ?? 'all').trim().toLowerCase()
  const statusClause = status === 'running'
    ? `| Where-Object { $_.Status -eq 'Running' } `
    : status === 'stopped'
      ? `| Where-Object { $_.Status -eq 'Stopped' } `
      : ''
  const filterClause = filter
    ? `| Where-Object { $_.Name -like '*${filter}*' -or $_.DisplayName -like '*${filter}*' } `
    : ''
  return runTerminal({
    command: `Get-Service ${statusClause}${filterClause}| Select-Object Name,Status,DisplayName | Sort-Object Status,Name | Format-Table -AutoSize | Out-String`,
  })
}

// ── sys_ports ─────────────────────────────────────────────────────────────────

export const sysPortsDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'sys_ports',
    description: 'List open listening network ports.',
    parameters: { type: 'object', properties: {} },
  },
}

export const sysPorts: ToolHandler = async () => {
  if (isWindows()) {
    return runTerminal({ command: 'netstat -ano | findstr LISTENING' })
  }
  return runLocalShell('ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || netstat -anv -p tcp | grep LISTEN')
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
        dry_run: { type: 'string', description: 'When true, preview the process instead of killing it.' },
      },
    },
  },
}

export const sysKill: ToolHandler = async (args) => {
  const dryRun = normalizeBool(args.dry_run)

  if (isWindows()) {
    if (dryRun && args.pid) {
      return runTerminal({
        command: `Get-Process -Id ${args.pid} -ErrorAction SilentlyContinue | Select-Object Name,Id,@{N='CPU_s';E={[math]::Round($_.CPU,1)}},@{N='Mem_MB';E={[math]::Round($_.WS/1MB,1)}} | Format-Table -AutoSize | Out-String`,
      })
    }
    if (dryRun && args.name) {
      const n = args.name.replace(/'/g, "''")
      return runTerminal({
        command: `Get-Process | Where-Object { $_.Name -like '*${n}*' } | Select-Object Name,Id,@{N='CPU_s';E={[math]::Round($_.CPU,1)}},@{N='Mem_MB';E={[math]::Round($_.WS/1MB,1)}} | Format-Table -AutoSize | Out-String`,
      })
    }
    if (args.pid) {
      return runTerminal({ command: `Stop-Process -Id ${args.pid} -Force; Write-Output "Killed PID ${args.pid}"` })
    }
    if (args.name) {
      const n = args.name.replace(/'/g, "''")
      return runTerminal({ command: `Stop-Process -Name '${n}' -Force -ErrorAction SilentlyContinue; Write-Output "Killed: ${n}"` })
    }
    return 'Error: provide name or pid'
  }

  if (dryRun) {
    if (!args.pid && !args.name) return 'Error: provide name or pid'
    return previewUnixProcess(args)
  }

  if (args.pid) {
    return runLocalShell(`kill -9 ${args.pid} && echo "Killed PID ${args.pid}"`)
  }

  if (args.name) {
    const raw = await runLocalShell('ps -axo pid=,comm=')
    if (raw.startsWith('Error:')) return raw
    const matches = cleanOutput(raw)
      .split('\n')
      .map((line) => line.trim().split(/\s+/, 2))
      .filter((parts) => (parts[1] ?? '').toLowerCase().includes(args.name!.toLowerCase()))
      .map((parts) => parts[0])
      .filter(Boolean)

    if (!matches.length) return `No matching process found for name: ${args.name}`
    return runLocalShell(`kill -9 ${matches.join(' ')} && echo "Killed PID(s): ${matches.join(', ')}"`)
  }

  return 'Error: provide name or pid'
}

// ── sys_platform ──────────────────────────────────────────────────────────────

export const sysPlatformDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'sys_platform',
    description: 'Return platform metadata such as OS, architecture, shell, privilege level, temp dir, and home dir.',
    parameters: { type: 'object', properties: {} },
  },
}

export const sysPlatform: ToolHandler = async () => {
  let isAdmin = false
  if (isWindows()) {
    const adminCheck = await runTerminal({ command: 'net session 2>&1' })
    isAdmin = !/access is denied/i.test(adminCheck) && !/\[exit code\s+[1-9]/i.test(adminCheck)
  } else {
    isAdmin = typeof process.getuid === 'function' ? process.getuid() === 0 : false
  }

  return JSON.stringify({
    platform: platform(),
    arch: arch(),
    shell: isWindows() ? (process.env.ComSpec ?? 'powershell.exe') : (process.env.SHELL ?? '/bin/bash'),
    isAdmin,
    tempDir: tmpdir(),
    homeDir: homedir(),
  }, null, 2)
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
  return runTerminal({ command: 'Get-ChildItem Env: | Format-Table -AutoSize | Out-String' })
}
