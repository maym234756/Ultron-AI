import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'

export type ProjectTemplateId = 'vanilla-ts' | 'react-vite' | 'electron-react' | 'fullstack-react-express' | 'express-api' | 'python-cli' | 'python-venv'

export type ProjectTemplate = {
  id: ProjectTemplateId
  label: string
  description: string
  stack: string
  installCommand?: string
  buildCommand?: string
  devCommand?: string
}

export type ProjectBuildRequest = {
  name?: string
  template?: ProjectTemplateId
  basePath?: string
  approved?: boolean
  runInstall?: boolean
  runBuild?: boolean
  openVsCode?: boolean
  openExplorer?: boolean
}

export type ProjectBuildResult = {
  ok: boolean
  projectName: string
  projectPath: string
  template: ProjectTemplate
  filesWritten: string[]
  logs: string[]
  nextCommands: string[]
}

export type ToolchainStatus = {
  checkedAt: number
  ready: boolean
  tools: Array<{
    id: string
    label: string
    ok: boolean
    command: string
    version: string
    installHint: string
  }>
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'vanilla-ts',
    label: 'Zero-dependency TypeScript App',
    description: 'A fast browser app scaffold with TypeScript-style structure and a local validation script. No npm install required.',
    stack: 'HTML + CSS + JavaScript + local validator',
    buildCommand: 'npm run build',
    devCommand: 'npm run dev',
  },
  {
    id: 'react-vite',
    label: 'React + Vite + TypeScript',
    description: 'Modern React starter with Vite scripts, TypeScript config, and a polished app shell.',
    stack: 'React + Vite + TypeScript',
    installCommand: 'npm install',
    buildCommand: 'npm run build',
    devCommand: 'npm run dev',
  },
  {
    id: 'electron-react',
    label: 'Electron + React Desktop App',
    description: 'Desktop-ready Electron shell with React/Vite renderer, typed main process, and local dev/build scripts.',
    stack: 'Electron + React + Vite + TypeScript',
    installCommand: 'npm install',
    buildCommand: 'npm run build',
    devCommand: 'npm run dev',
  },
  {
    id: 'fullstack-react-express',
    label: 'Full-stack React + Express App',
    description: 'Single-repo full-stack starter with Express API, Vite React client, shared scripts, health route, and local validation.',
    stack: 'React + Express + TypeScript',
    installCommand: 'npm install',
    buildCommand: 'npm run build',
    devCommand: 'npm run dev',
  },
  {
    id: 'express-api',
    label: 'Express API Service',
    description: 'Node/Express API scaffold with health route, scripts, and TypeScript server entry.',
    stack: 'Node + Express + TypeScript',
    installCommand: 'npm install',
    buildCommand: 'npm run build',
    devCommand: 'npm run dev',
  },
  {
    id: 'python-cli',
    label: 'Python CLI Tool',
    description: 'Python command-line project with package layout, tests folder, and smoke command.',
    stack: 'Python CLI',
    buildCommand: 'python -m py_compile src/main.py',
    devCommand: 'python src/main.py --help',
  },
  {
    id: 'python-venv',
    label: 'Python App with Virtual Environment',
    description: 'Python project with pyproject.toml, requirements.txt, setup script, tests, and a venv-first workflow.',
    stack: 'Python + venv + pytest-ready layout',
    installCommand: 'python -m venv .venv; .\.venv\Scripts\python.exe -m pip install --upgrade pip; .\.venv\Scripts\python.exe -m pip install -r requirements.txt',
    buildCommand: '.\.venv\Scripts\python.exe -m py_compile src/main.py',
    devCommand: '.\.venv\Scripts\python.exe src/main.py --help',
  },
]

function templateById(id: string | undefined): ProjectTemplate {
  return PROJECT_TEMPLATES.find(template => template.id === id) ?? PROJECT_TEMPLATES[0]
}

function cleanPackageName(value: string | undefined): string {
  const cleaned = (value ?? 'ultron-project').trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned || 'ultron-project'
}

function cleanProjectFolderName(value: string | undefined): string {
  const cleaned = (value ?? 'Ultron Project')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
  return cleaned || 'Ultron-Project'
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

function firstVersionLine(output: string): string {
  return output.split(/\r?\n/).map(line => line.trim()).find(Boolean) ?? '(no version output)'
}

async function checkTool(id: string, label: string, command: string, installHint: string): Promise<ToolchainStatus['tools'][number]> {
  const output = await runCommand(command, process.cwd(), 20)
  const ok = !/\[exit code \d+\]|\bError:|not recognized|not found|CommandNotFoundException/i.test(output)
  return { id, label, ok, command, version: firstVersionLine(output), installHint }
}

export async function getCodingToolchainStatus(): Promise<ToolchainStatus> {
  const tools = await Promise.all([
    checkTool('node', 'Node.js', 'node --version', 'Install Node.js 20+ from https://nodejs.org or winget install OpenJS.NodeJS.LTS'),
    checkTool('npm', 'npm', 'npm --version', 'npm ships with Node.js; reinstall Node.js LTS if missing.'),
    checkTool('git', 'Git', 'git --version', 'Install Git with winget install Git.Git'),
    checkTool('python', 'Python', 'python --version', 'Install Python with winget install Python.Python.3.12'),
    checkTool('pip', 'pip', 'python -m pip --version', 'Install or repair Python and ensure pip is enabled.'),
    checkTool('code', 'VS Code CLI', 'code --version', 'In VS Code, run Shell Command: Install code command in PATH, or reinstall VS Code.'),
    checkTool('winget', 'Windows Package Manager', 'winget --version', 'Install or update App Installer from Microsoft Store.'),
  ])
  return { checkedAt: Date.now(), ready: tools.every(tool => tool.ok), tools }
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

function vanillaFiles(name: string): Record<string, string> {
  const packageName = cleanPackageName(name)
  return {
    'package.json': JSON.stringify({
      name: packageName,
      version: '0.1.0',
      private: true,
      type: 'module',
      scripts: {
        dev: 'node scripts/dev-server.mjs',
        build: 'node scripts/check.mjs',
        check: 'node scripts/check.mjs',
      },
    }, null, 2) + '\n',
    'README.md': `# ${name}\n\nGenerated by Ultron Project Builder.\n\n## Commands\n\n- npm run dev\n- npm run build\n`,
    'index.html': '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>Ultron Project</title>\n    <link rel="stylesheet" href="./src/styles.css" />\n  </head>\n  <body>\n    <main id="app"></main>\n    <script type="module" src="./src/main.js"></script>\n  </body>\n</html>\n',
    'src/main.js': `import { createApp } from './ui.js'\n\ndocument.querySelector('#app').append(createApp())\n`,
    'src/ui.js': `export function createApp() {\n  const root = document.createElement('section')\n  root.className = 'app-shell'\n  root.innerHTML = \`\n    <p class="eyebrow">Generated by Ultron</p>\n    <h1>${name}</h1>\n    <p>Start shaping the product logic, UI states, and workflows here.</p>\n    <div class="actions">\n      <button type="button">Primary action</button>\n      <button type="button" class="secondary">Secondary</button>\n    </div>\n  \`\n  return root\n}\n`,
    'src/styles.css': `:root { color-scheme: light; font-family: Georgia, 'Times New Roman', serif; background: #f5f1e8; color: #1e293b; }\nbody { margin: 0; min-height: 100vh; display: grid; place-items: center; }\n.app-shell { width: min(760px, calc(100vw - 32px)); padding: 48px; border: 1px solid #d4c5aa; background: #fffdf7; box-shadow: 0 20px 60px rgba(30,41,59,.12); }\n.eyebrow { margin: 0 0 12px; text-transform: uppercase; font-size: 12px; letter-spacing: .12em; color: #047857; font-weight: 700; }\nh1 { margin: 0 0 16px; font-size: clamp(40px, 7vw, 82px); line-height: .95; }\np { font-size: 18px; line-height: 1.6; }\n.actions { display: flex; gap: 12px; margin-top: 28px; }\nbutton { border: 1px solid #047857; background: #047857; color: white; padding: 12px 16px; font-weight: 700; cursor: pointer; }\nbutton.secondary { background: transparent; color: #047857; }\n`,
    'scripts/check.mjs': `import fs from 'node:fs'\n\nconst required = ['index.html', 'src/main.js', 'src/ui.js', 'src/styles.css']\nconst missing = required.filter(file => !fs.existsSync(file))\nif (missing.length) {\n  console.error('Missing files:', missing.join(', '))\n  process.exit(1)\n}\nconsole.log('Project structure valid:', required.join(', '))\n`,
    'scripts/dev-server.mjs': `import { createServer } from 'node:http'\nimport { readFile } from 'node:fs/promises'\nimport path from 'node:path'\n\nconst types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }\nconst server = createServer(async (req, res) => {\n  const urlPath = req.url === '/' ? '/index.html' : req.url ?? '/index.html'\n  const file = path.join(process.cwd(), urlPath.replace(/^\\//, ''))\n  try {\n    const body = await readFile(file)\n    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'text/plain' })\n    res.end(body)\n  } catch {\n    res.writeHead(404); res.end('Not found')\n  }\n})\nserver.listen(5174, () => console.log('Dev server: http://localhost:5174'))\n`,
  }
}

function reactFiles(name: string): Record<string, string> {
  const packageName = cleanPackageName(name)
  return {
    'package.json': JSON.stringify({ name: packageName, version: '0.1.0', private: true, type: 'module', scripts: { dev: 'vite', build: 'tsc -b && vite build', preview: 'vite preview' }, dependencies: { '@vitejs/plugin-react': '^6.0.3', vite: '^8.1.1', typescript: '~6.0.2', react: '^19.2.7', 'react-dom': '^19.2.7', 'lucide-react': '^1.22.0' }, devDependencies: { '@types/react': '^19.2.17', '@types/react-dom': '^19.2.3' } }, null, 2) + '\n',
    'index.html': '<div id="root"></div><script type="module" src="/src/main.tsx"></script>\n',
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', useDefineForClassFields: true, lib: ['ES2022', 'DOM', 'DOM.Iterable'], allowJs: false, skipLibCheck: true, esModuleInterop: true, allowSyntheticDefaultImports: true, strict: true, forceConsistentCasingInFileNames: true, module: 'ESNext', moduleResolution: 'Bundler', resolveJsonModule: true, isolatedModules: true, noEmit: true, jsx: 'react-jsx' }, include: ['src'] }, null, 2) + '\n',
    'src/main.tsx': `import React from 'react'\nimport { createRoot } from 'react-dom/client'\nimport { Sparkles } from 'lucide-react'\nimport './styles.css'\n\nfunction App() {\n  return <main className="shell"><Sparkles /><p>Ultron Project</p><h1>${name}</h1><button>Build the first workflow</button></main>\n}\n\ncreateRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)\n`,
    'src/styles.css': `body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #e8f3f0; color: #10231f; font-family: Cambria, Georgia, serif; }\n.shell { width: min(720px, calc(100vw - 32px)); padding: 48px; background: white; border: 1px solid #9ab8af; }\nh1 { font-size: 64px; margin: 8px 0 24px; }\nbutton { padding: 12px 16px; border: 0; background: #0f766e; color: white; font-weight: 800; }\n`,
  }
}

function electronReactFiles(name: string): Record<string, string> {
  const packageName = cleanPackageName(name)
  return {
    'package.json': JSON.stringify({
      name: packageName,
      version: '0.1.0',
      private: true,
      type: 'module',
      main: 'dist-electron/main.js',
      scripts: {
        dev: 'concurrently -k -n renderer,electron -c green,yellow "vite --host 127.0.0.1" "npm:electron:dev"',
        'electron:dev': 'tsx watch electron/main.ts',
        build: 'tsc -b && vite build && tsc -p tsconfig.electron.json',
        preview: 'vite preview',
      },
      dependencies: { '@vitejs/plugin-react': '^6.0.3', vite: '^8.1.1', typescript: '~6.0.2', react: '^19.2.7', 'react-dom': '^19.2.7', electron: '^43.0.0', concurrently: '^10.0.3', tsx: '^4.22.4', 'lucide-react': '^1.22.0' },
      devDependencies: { '@types/node': '^24.13.2', '@types/react': '^19.2.17', '@types/react-dom': '^19.2.3' },
    }, null, 2) + '\n',
    'index.html': '<div id="root"></div><script type="module" src="/src/main.tsx"></script>\n',
    'tsconfig.json': JSON.stringify({ files: [], references: [{ path: './tsconfig.app.json' }, { path: './tsconfig.electron.json' }] }, null, 2) + '\n',
    'tsconfig.app.json': JSON.stringify({ compilerOptions: { target: 'ES2022', useDefineForClassFields: true, lib: ['ES2022', 'DOM', 'DOM.Iterable'], allowJs: false, skipLibCheck: true, esModuleInterop: true, allowSyntheticDefaultImports: true, strict: true, forceConsistentCasingInFileNames: true, module: 'ESNext', moduleResolution: 'Bundler', resolveJsonModule: true, isolatedModules: true, noEmit: true, jsx: 'react-jsx' }, include: ['src'] }, null, 2) + '\n',
    'tsconfig.electron.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, esModuleInterop: true, outDir: 'dist-electron', rootDir: 'electron', skipLibCheck: true, types: ['node'] }, include: ['electron/**/*.ts'] }, null, 2) + '\n',
    'vite.config.ts': `import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\n\nexport default defineConfig({ plugins: [react()] })\n`,
    'electron/main.ts': `import { app, BrowserWindow } from 'electron'\nimport { join } from 'node:path'\n\nconst isDev = !app.isPackaged\n\nfunction createWindow() {\n  const win = new BrowserWindow({ width: 1080, height: 760, minWidth: 760, minHeight: 520, autoHideMenuBar: true })\n  if (isDev) void win.loadURL('http://localhost:5173')\n  else void win.loadFile(join(app.getAppPath(), 'dist/index.html'))\n}\n\napp.whenReady().then(createWindow)\napp.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })\n`,
    'src/main.tsx': `import React from 'react'\nimport { createRoot } from 'react-dom/client'\nimport { MonitorCog } from 'lucide-react'\nimport './styles.css'\n\nfunction App() {\n  return <main className="shell"><MonitorCog size={42} /><p>Desktop starter</p><h1>${name}</h1><button>Wire your first workflow</button></main>\n}\n\ncreateRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)\n`,
    'src/styles.css': `body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4f7f2; color: #17231d; font-family: Cambria, Georgia, serif; }\n.shell { width: min(760px, calc(100vw - 32px)); padding: 48px; border: 1px solid #b8c7ba; background: white; border-radius: 8px; }\nh1 { font-size: 64px; margin: 8px 0 22px; letter-spacing: 0; }\nbutton { min-height: 44px; border: 0; border-radius: 6px; padding: 0 16px; background: #166534; color: white; font-weight: 800; }\n`,
    'README.md': `# ${name}\n\nElectron + React desktop app generated by Ultron.\n\n## Commands\n\n- npm install\n- npm run dev\n- npm run build\n`,
  }
}

function fullstackFiles(name: string): Record<string, string> {
  const packageName = cleanPackageName(name)
  return {
    'package.json': JSON.stringify({ name: packageName, version: '0.1.0', private: true, type: 'module', scripts: { dev: 'concurrently -k -n api,web -c cyan,green "tsx watch server/index.ts" "vite --host 127.0.0.1"', build: 'tsc -b && vite build && tsc -p tsconfig.server.json', start: 'node dist-server/index.js' }, dependencies: { '@vitejs/plugin-react': '^6.0.3', vite: '^8.1.1', typescript: '~6.0.2', react: '^19.2.7', 'react-dom': '^19.2.7', express: '^5.2.1', cors: '^2.8.6', concurrently: '^10.0.3', tsx: '^4.22.4' }, devDependencies: { '@types/node': '^24.13.2', '@types/react': '^19.2.17', '@types/react-dom': '^19.2.3', '@types/express': '^5.0.6', '@types/cors': '^2.8.19' } }, null, 2) + '\n',
    'index.html': '<div id="root"></div><script type="module" src="/src/main.tsx"></script>\n',
    'tsconfig.json': JSON.stringify({ files: [], references: [{ path: './tsconfig.app.json' }, { path: './tsconfig.server.json' }] }, null, 2) + '\n',
    'tsconfig.app.json': JSON.stringify({ compilerOptions: { target: 'ES2022', lib: ['ES2022', 'DOM', 'DOM.Iterable'], module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, skipLibCheck: true, noEmit: true, isolatedModules: true, esModuleInterop: true }, include: ['src'] }, null, 2) + '\n',
    'tsconfig.server.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, esModuleInterop: true, outDir: 'dist-server', rootDir: 'server', skipLibCheck: true, types: ['node'] }, include: ['server/**/*.ts'] }, null, 2) + '\n',
    'vite.config.ts': `import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\n\nexport default defineConfig({ plugins: [react()], server: { proxy: { '/api': 'http://localhost:3001' } } })\n`,
    'server/index.ts': `import cors from 'cors'\nimport express from 'express'\n\nconst app = express()\napp.use(cors())\napp.use(express.json())\napp.get('/api/health', (_req, res) => res.json({ ok: true, service: '${name}', at: new Date().toISOString() }))\napp.listen(3001, () => console.log('${name} API: http://localhost:3001'))\n`,
    'src/main.tsx': `import React, { useEffect, useState } from 'react'\nimport { createRoot } from 'react-dom/client'\nimport './styles.css'\n\nfunction App() {\n  const [health, setHealth] = useState('checking')\n  useEffect(() => { void fetch('/api/health').then(response => response.json()).then(data => setHealth(data.ok ? 'API online' : 'API issue')).catch(() => setHealth('API offline')) }, [])\n  return <main className="shell"><p>Full-stack starter</p><h1>${name}</h1><strong>{health}</strong><button>Build first feature</button></main>\n}\n\ncreateRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)\n`,
    'src/styles.css': `body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #eef5ff; color: #182033; font-family: Georgia, serif; }\n.shell { width: min(820px, calc(100vw - 32px)); padding: 48px; background: white; border: 1px solid #b8c6d9; border-radius: 8px; }\nh1 { font-size: 60px; line-height: 1; margin: 8px 0 20px; letter-spacing: 0; }\nbutton { display: block; margin-top: 24px; min-height: 44px; border: 0; border-radius: 6px; padding: 0 16px; background: #1d4ed8; color: white; font-weight: 800; }\n`,
    'README.md': `# ${name}\n\nFull-stack React + Express starter generated by Ultron.\n\n## Commands\n\n- npm install\n- npm run dev\n- npm run build\n`,
  }
}

function expressFiles(name: string): Record<string, string> {
  const packageName = cleanPackageName(name)
  return {
    'package.json': JSON.stringify({ name: packageName, version: '0.1.0', private: true, type: 'module', scripts: { dev: 'tsx watch src/server.ts', build: 'tsc -p tsconfig.json', start: 'node dist/server.js' }, dependencies: { express: '^5.2.1', cors: '^2.8.6' }, devDependencies: { '@types/express': '^5.0.6', '@types/cors': '^2.8.19', '@types/node': '^24.13.2', tsx: '^4.22.4', typescript: '~6.0.2' } }, null, 2) + '\n',
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, esModuleInterop: true, outDir: 'dist', rootDir: 'src', skipLibCheck: true }, include: ['src/**/*.ts'] }, null, 2) + '\n',
    'src/server.ts': `import express from 'express'\nimport cors from 'cors'\n\nconst app = express()\napp.use(cors())\napp.use(express.json())\napp.get('/health', (_req, res) => res.json({ ok: true, service: '${name}' }))\napp.listen(3000, () => console.log('${name} listening on http://localhost:3000'))\n`,
    'README.md': `# ${name}\n\nExpress API generated by Ultron Project Builder.\n`,
  }
}

function pythonFiles(name: string): Record<string, string> {
  return {
    'README.md': `# ${name}\n\nPython CLI generated by Ultron Project Builder.\n`,
    'src/main.py': `import argparse\n\ndef main():\n    parser = argparse.ArgumentParser(description='${name} CLI')\n    parser.add_argument('--name', default='Ultron')\n    args = parser.parse_args()\n    print(f'Hello, {args.name}.')\n\nif __name__ == '__main__':\n    main()\n`,
    'tests/.gitkeep': '',
  }
}

function pythonVenvFiles(name: string): Record<string, string> {
  const packageName = cleanPackageName(name)
  return {
    'README.md': `# ${name}\n\nPython venv project generated by Ultron.\n\n## Commands\n\n\`\`\`powershell\npython -m venv .venv\n.\\.venv\\Scripts\\python.exe -m pip install -r requirements.txt\n.\\.venv\\Scripts\\python.exe src\\main.py --help\n\`\`\`\n`,
    'pyproject.toml': `[project]\nname = "${packageName}"\nversion = "0.1.0"\ndescription = "Generated by Ultron"\nrequires-python = ">=3.10"\n\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n`,
    'requirements.txt': 'pytest>=8.0.0\nrequests>=2.32.0\n',
    'scripts/setup.ps1': `python -m venv .venv\n.\\.venv\\Scripts\\python.exe -m pip install --upgrade pip\n.\\.venv\\Scripts\\python.exe -m pip install -r requirements.txt\n`,
    'src/main.py': `import argparse\nimport json\n\ndef build_payload(name: str) -> dict:\n    return {"project": "${name}", "message": f"Hello, {name}.", "ok": True}\n\ndef main() -> None:\n    parser = argparse.ArgumentParser(description="${name} app")\n    parser.add_argument("--name", default="Ultron")\n    args = parser.parse_args()\n    print(json.dumps(build_payload(args.name), indent=2))\n\nif __name__ == "__main__":\n    main()\n`,
    'tests/test_main.py': `from src.main import build_payload\n\ndef test_build_payload():\n    payload = build_payload("Tester")\n    assert payload["ok"] is True\n    assert payload["message"] == "Hello, Tester."\n`,
  }
}

function projectPlanFile(name: string, template: ProjectTemplate): string {
  const nextIdeas = template.id === 'express-api'
    ? ['Add typed route modules for the main resources.', 'Add request validation and structured error responses.', 'Add integration tests for health and core API flows.']
    : template.id === 'fullstack-react-express'
      ? ['Define the first API-backed user workflow.', 'Add shared validation between client forms and server routes.', 'Add integration checks for the API and browser preview.']
      : template.id === 'electron-react'
        ? ['Add the first native desktop workflow.', 'Define IPC boundaries before touching local files or OS actions.', 'Add desktop build and renderer preview checks.']
        : template.id === 'python-venv'
          ? ['Add domain modules under src with tests beside each behavior.', 'Keep all package installs inside .venv.', 'Add pytest and CLI smoke checks to the project loop.']
    : template.id === 'python-cli'
      ? ['Add subcommands for the main workflows.', 'Add file/config input support.', 'Add tests for parser behavior and command output.']
      : template.id === 'react-vite'
        ? ['Add real app state and route-level views.', 'Create reusable UI components for the main workflow.', 'Add form validation, loading states, and empty states.']
        : ['Define the first real workflow in src/ui.js.', 'Add persistent data or API integration if needed.', 'Polish responsive states and keyboard accessibility.']

  return `# Ultron Project Plan - ${name}

Generated by Ultron Project Builder.

## Starting Point

- Template: ${template.label}
- Stack: ${template.stack}
- Install: ${template.installCommand ?? 'Not required'}
- Check/build: ${template.buildCommand ?? 'Not configured'}
- Dev server: ${template.devCommand ?? 'Not configured'}

## What Ultron Created

This project is a working scaffold, not a throwaway demo. It includes the minimum source files, commands, and validation path needed for Ultron to keep building, checking, repairing, and previewing the project from Project Memory.

## Next Implementation Ideas

${nextIdeas.map(item => `- ${item}`).join('\n')}

## Coding Mission Control

- Check Coding Readiness before dependency-heavy builds.
- Keep this project in Project Memory so Ultron can run Install, Check, Fix, Dev, Preview, and Stop from one place.
- Use screenshots or reference URLs when visual output needs review.

## Recommended Loop

1. Run the check/build command.
2. Start the dev server or preview route.
3. Ask Ultron to add one workflow at a time.
4. Run Check, then Fix if needed.
5. Keep this plan updated as the project becomes real.
`
}

function filesForTemplate(template: ProjectTemplate, name: string): Record<string, string> {
  const files = { 'ULTRON_PROJECT_PLAN.md': projectPlanFile(name, template) }
  switch (template.id) {
    case 'react-vite': return { ...files, ...reactFiles(name) }
    case 'electron-react': return { ...files, ...electronReactFiles(name) }
    case 'fullstack-react-express': return { ...files, ...fullstackFiles(name) }
    case 'express-api': return { ...files, ...expressFiles(name) }
    case 'python-venv': return { ...files, ...pythonVenvFiles(name) }
    case 'python-cli': return { ...files, ...pythonFiles(name) }
    default: return { ...files, ...vanillaFiles(name) }
  }
}

export async function buildProject(request: ProjectBuildRequest): Promise<ProjectBuildResult> {
  if (!request.approved) throw new Error('Project Builder requires approval before creating files or opening tools.')
  const template = templateById(request.template)
  const projectName = cleanProjectFolderName(request.name)
  const basePath = resolveBasePath(request.basePath)
  const projectPath = path.join(basePath, projectName)
  const logs: string[] = []
  await fs.mkdir(projectPath, { recursive: true })
  logs.push(`Created project folder: ${projectPath}`)
  const filesWritten = await writeFiles(projectPath, filesForTemplate(template, projectName))
  logs.push(`Wrote ${filesWritten.length} file(s).`)

  if (request.runInstall && template.installCommand) {
    logs.push(`Running: ${template.installCommand}`)
    logs.push(await runCommand(template.installCommand, projectPath, 300))
  } else if (template.installCommand) {
    logs.push(`Skipped install. Run later: ${template.installCommand}`)
  }

  if (request.runBuild && template.buildCommand) {
    if (template.installCommand && !request.runInstall) logs.push(`Skipped build until dependencies are installed: ${template.buildCommand}`)
    else {
      logs.push(`Running: ${template.buildCommand}`)
      logs.push(await runCommand(template.buildCommand, projectPath, 180))
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
    projectName,
    projectPath,
    template,
    filesWritten,
    logs,
    nextCommands: [template.installCommand, template.buildCommand, template.devCommand].filter((value): value is string => Boolean(value)),
  }
}