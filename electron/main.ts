/**
 * Ultron Electron tray app
 * - Lives in the system tray
 * - Global shortcut Ctrl+Shift+U to show/hide
 * - Loads localhost:5173 (dev) or built files (prod)
 * - Auto-starts the backend server
 *
 * Usage:
 *   npm run tray          (dev — requires npm run dev running)
 *   npm run tray:build    (build + package — see package.json scripts)
 */
import { app, BrowserWindow, Tray, Menu, globalShortcut, nativeImage, shell, ipcMain } from 'electron'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const isDev = !app.isPackaged
const WEB_URL = isDev ? 'http://localhost:5173' : `file://${join(__dirname, '../dist/index.html')}`
const API_PORT = 8787
const HOTKEY = 'Ctrl+Shift+U'

let tray: Tray | null = null
let win: BrowserWindow | null = null
let serverProc: ChildProcess | null = null
let isQuitting = false

// ── Start backend server (production mode only) ────────────────────────────────

function startServer(): void {
  if (isDev) return // dev mode: user runs npm run dev manually
  const serverEntry = join(__dirname, '../dist-server/index.js')
  if (!existsSync(serverEntry)) {
    console.error('[electron] Server bundle not found:', serverEntry)
    return
  }
  serverProc = spawn(process.execPath, [serverEntry], {
    stdio: 'inherit',
    env: { ...process.env, PORT: String(API_PORT) },
  })
  serverProc.on('exit', (code) => {
    if (!isQuitting) console.error('[electron] Server exited with code', code)
  })
}

// ── Create main window ─────────────────────────────────────────────────────────

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 600,
    minHeight: 450,
    frame: true,
    transparent: false,
    show: false,
    icon: join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: 'Ultron',
    skipTaskbar: false,
    autoHideMenuBar: true,
  })

  w.loadURL(WEB_URL)

  // Open links in default browser instead of Electron
  w.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Hide to tray instead of closing
  w.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      w.hide()
    }
  })

  w.once('ready-to-show', () => {
    w.show()
    w.focus()
  })

  return w
}

// ── Tray icon ──────────────────────────────────────────────────────────────────

function createTray(): Tray {
  // Use a simple built-in icon if custom icon not found
  const iconPath = join(__dirname, 'icon.png')
  const icon = existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createFromDataURL(getTrayIconDataURL())

  const t = new Tray(icon.resize({ width: 16, height: 16 }))
  t.setToolTip(`Ultron (${HOTKEY} to toggle)`)

  const menu = Menu.buildFromTemplate([
    {
      label: 'Show / Hide',
      click: () => toggleWindow(),
    },
    {
      label: `Shortcut: ${HOTKEY}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Open in Browser',
      click: () => shell.openExternal(WEB_URL),
    },
    { type: 'separator' },
    {
      label: 'Quit Ultron',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])

  t.setContextMenu(menu)
  t.on('click', () => toggleWindow())

  return t
}

function toggleWindow(): void {
  if (!win) { win = createWindow(); return }
  if (win.isVisible() && win.isFocused()) {
    win.hide()
  } else {
    win.show()
    win.focus()
  }
}

// ── Minimal SVG tray icon (fallback) ──────────────────────────────────────────

function getTrayIconDataURL(): string {
  // A simple "U" letter icon as PNG data URL (16x16 white-on-dark)
  return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABmJLR0QA/wD/AP+gvaeTAAAAW0lEQVQ4y2NgGAWkgf///xkYiAQMxGoejgYGBgZGYjUPRwMDA5GahwMDAwMjsZqHAwMDA5GahwMDAwMjsZqHAwMDAxFNw9GAgYGBiKbhaGBgYCCiaTgaAADwYBBrLuXM7wAAAABJRU5ErkJggg=='
}

// ── App lifecycle ──────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // Single instance lock
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  startServer()

  tray = createTray()
  win = createWindow()

  // Register global shortcut
  const ok = globalShortcut.register(HOTKEY, toggleWindow)
  if (!ok) console.warn('[electron] Could not register hotkey:', HOTKEY)

  app.on('activate', () => {
    if (!win || win.isDestroyed()) win = createWindow()
    else { win.show(); win.focus() }
  })
})

app.on('second-instance', () => {
  if (win) { win.show(); win.focus() }
})

app.on('window-all-closed', () => {
  // Keep running in tray — don't quit
})

app.on('before-quit', () => {
  isQuitting = true
  globalShortcut.unregisterAll()
  if (serverProc) serverProc.kill()
})
