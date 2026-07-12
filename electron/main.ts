/**
 * Astra Electron tray app
 * - Lives in the system tray
 * - Global shortcut Ctrl+Shift+U to show/hide
 * - Loads localhost:5173 (dev) or bundled production server (prod)
 * - Auto-starts the backend server
 *
 * Usage:
 *   npm run tray          (dev — requires npm run dev running)
 *   npm run desktop:dist  (build + package Windows installer)
 */
import { app, BrowserWindow, Tray, Menu, globalShortcut, nativeImage, shell, screen as electronScreen } from 'electron'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const isDev = !app.isPackaged
const API_PORT = 8787
const SERVER_URL = `http://127.0.0.1:${API_PORT}`
const WEB_URL = isDev ? 'http://localhost:5173' : SERVER_URL
const HOTKEY = 'Ctrl+Shift+U'
const OVERLAY_HOTKEY = 'Ctrl+Shift+Space'

let tray: Tray | null = null
let win: BrowserWindow | null = null
let isQuitting = false
let isOverlayMode = false

// ── Start backend server (production mode only) ────────────────────────────────

async function startServer(): Promise<void> {
  if (isDev) return // dev mode: user runs npm run dev manually
  const serverEntry = join(__dirname, '../dist-server/index.js')
  if (!existsSync(serverEntry)) {
    console.error('[electron] Server bundle not found:', serverEntry)
    return
  }
  process.env.PORT = process.env.PORT || String(API_PORT)
  await import(pathToFileURL(serverEntry).href)
  await waitForServer()
}

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${SERVER_URL}/api/health`, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) return
    } catch {
      // Server is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  console.warn('[electron] Server did not answer health checks before window load.')
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
    title: 'Astra',
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

function positionOverlayWindow(w: BrowserWindow): void {
  const display = electronScreen.getDisplayNearestPoint(electronScreen.getCursorScreenPoint())
  const { x, y, width, height } = display.workArea
  const [windowWidth, windowHeight] = w.getSize()
  w.setPosition(
    Math.round(x + (width - windowWidth) / 2),
    Math.round(y + height - windowHeight - 24),
  )
}

function applyWindowMode(): void {
  if (!win || win.isDestroyed()) return

  if (isOverlayMode) {
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.setSkipTaskbar(false)
    win.setOpacity(0.96)
    win.setSize(760, 320)
    positionOverlayWindow(win)
    win.show()
    win.focus()
    return
  }

  win.setAlwaysOnTop(false)
  win.setVisibleOnAllWorkspaces(false)
  win.setOpacity(1)
  win.setSize(900, 700)
  win.center()
  win.show()
  win.focus()
}

function toggleOverlayMode(): void {
  if (!win || win.isDestroyed()) win = createWindow()
  isOverlayMode = !isOverlayMode
  applyWindowMode()
}

// ── Tray icon ──────────────────────────────────────────────────────────────────

function createTray(): Tray {
  // Use a simple built-in icon if custom icon not found
  const iconPath = join(__dirname, 'icon.png')
  const icon = existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createFromDataURL(getTrayIconDataURL())

  const t = new Tray(icon.resize({ width: 16, height: 16 }))
  t.setToolTip(`Astra (${HOTKEY} to toggle)`)

  const menu = Menu.buildFromTemplate([
    {
      label: 'Show / Hide',
      click: () => toggleWindow(),
    },
    {
      label: `Shortcut: ${HOTKEY}`,
      enabled: false,
    },
    {
      label: `Overlay Mode: ${OVERLAY_HOTKEY}`,
      click: () => toggleOverlayMode(),
    },
    { type: 'separator' },
    {
      label: 'Open in Browser',
      click: () => shell.openExternal(WEB_URL),
    },
    { type: 'separator' },
    {
      label: 'Quit Astra',
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
    if (isOverlayMode) positionOverlayWindow(win)
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

app.whenReady().then(async () => {
  // Single instance lock
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  await startServer()

  tray = createTray()
  win = createWindow()

  // Register global shortcut
  const ok = globalShortcut.register(HOTKEY, toggleWindow)
  if (!ok) console.warn('[electron] Could not register hotkey:', HOTKEY)
  const overlayOk = globalShortcut.register(OVERLAY_HOTKEY, toggleOverlayMode)
  if (!overlayOk) console.warn('[electron] Could not register overlay hotkey:', OVERLAY_HOTKEY)

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
  tray?.destroy()
  tray = null
})
