import { spawn } from 'node:child_process'
import type { ToolDefinition, ToolHandler } from './types.js'

export const terminalDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'run_terminal',
    description:
      'Execute a PowerShell command on the local machine and return its output. Use for running code, installing packages, managing files, checking system state, or any shell operation.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The PowerShell command to execute.',
        },
        cwd: {
          type: 'string',
          description: 'Optional working directory. Defaults to the project root.',
        },
      },
      required: ['command'],
    },
  },
}

export const runTerminal: ToolHandler = (args) => {
  const command = (args.command ?? '').trim()
  const cwd = args.cwd?.trim() || process.cwd()

  if (!command) return Promise.resolve('Error: no command provided')

  return new Promise((resolve) => {
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
      const out = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n')
      const exitNote = code !== 0 ? `\n[exit code ${code ?? '?'}]` : ''
      resolve((out || '(no output)') + exitNote)
    })

    proc.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(`Error: ${err.message}`)
    })
  })
}
