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
        timeout_sec: {
          type: 'string',
          description: 'Optional timeout in seconds, from 1 to 600. Defaults to 120.',
        },
        max_output_chars: {
          type: 'string',
          description: 'Optional maximum returned output characters, from 1000 to 200000. Defaults to 50000.',
        },
      },
      required: ['command'],
    },
  },
}

export const runTerminal: ToolHandler = (args) => {
  const command = (args.command ?? '').trim()
  const cwd = args.cwd?.trim() || process.cwd()
  const timeoutSec = Math.min(600, Math.max(1, parseInt(args.timeout_sec ?? '120', 10) || 120))
  const maxOutputChars = Math.min(200_000, Math.max(1000, parseInt(args.max_output_chars ?? '50000', 10) || 50_000))

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
      resolve(`Error: command timed out after ${timeoutSec} seconds`)
    }, timeoutSec * 1000)

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
      const rawOut = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n')
      const truncated = rawOut.length > maxOutputChars
      const out = truncated ? `${rawOut.slice(0, maxOutputChars)}\n[output truncated to ${maxOutputChars.toLocaleString()} chars from ${rawOut.length.toLocaleString()}]` : rawOut
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
