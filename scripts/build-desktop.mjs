import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tempOut = path.join(os.tmpdir(), `lumivex-electron-release-${Date.now()}`)
const finalOut = path.join(root, 'desktop-release')

function run(command, args) {
  const windows = process.platform === 'win32'
  const result = windows ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', [command, ...args.map(quoteCmd)].join(' ')], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
  }) : spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
  })
  if (result.error) console.error(result.error.message)
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function quoteCmd(value) {
  return /[\s"&|<>^]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value
}

await fs.rm(tempOut, { recursive: true, force: true })
await fs.rm(finalOut, { recursive: true, force: true })
await fs.mkdir(finalOut, { recursive: true })

run('npm', ['run', 'desktop:build'])
run('npx', ['electron-builder', '--win', 'nsis', '--x64', '--publish', 'never', `--config.directories.output=${tempOut}`])

const entries = await fs.readdir(tempOut)
for (const entry of entries) {
  if (entry.startsWith('Lumivex AI-Setup-') || entry === 'latest.yml') {
    await fs.copyFile(path.join(tempOut, entry), path.join(finalOut, entry))
  }
}

await fs.rm(tempOut, { recursive: true, force: true })
console.log(`Desktop installer copied to ${finalOut}`)