import {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  shell,
  systemPreferences,
} from "electron"
import { fileURLToPath } from "node:url"
import path from "node:path"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, "..")

export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"]
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron")
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist")

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST

const preload = path.join(__dirname, "preload.cjs")

/** Match renderer `auth-redirect.ts` — vite sets VITE_DEV_SERVER_URL in dev. */
const APP_PROTOCOL = VITE_DEV_SERVER_URL ? "yappy-dev" : "yappy"
const PROTOCOL_PREFIX = `${APP_PROTOCOL}://`

type IslandSize = { width: number; height: number }
type IslandMode = "collapsed" | "pill" | "expanded"

let win: BrowserWindow | null = null
let pendingDeepLinkUrl: string | null = null
let lastDeepLinkUrl: string | null = null
let lastDeepLinkAt = 0

function isAppProtocolUrl(value: string) {
  try {
    return new URL(value).protocol === `${APP_PROTOCOL}:`
  } catch {
    return false
  }
}

function registerProtocolClient() {
  // Dev (electron as defaultApp): must pass execPath + app entry so macOS
  // re-launches the right binary when yappy-dev:// opens.
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(APP_PROTOCOL, process.execPath, [
        path.resolve(process.argv[1]!),
      ])
    }
  } else {
    app.setAsDefaultProtocolClient(APP_PROTOCOL)
  }
}

function forwardDeepLinkToRenderer(url: string) {
  if (!isAppProtocolUrl(url) && !url.startsWith(PROTOCOL_PREFIX)) return

  // Bridge / OS can deliver the same URL twice (meta+js, open-url+second-instance).
  const now = Date.now()
  if (url === lastDeepLinkUrl && now - lastDeepLinkAt < 2500) return
  lastDeepLinkUrl = url
  lastDeepLinkAt = now

  pendingDeepLinkUrl = url
  const contents = win?.webContents
  if (contents && !contents.isDestroyed() && contents.getURL()) {
    contents.send("auth:deep-link", url)
  }
  // Bring island forward so the user sees auth complete.
  if (win && !win.isDestroyed()) {
    win.show()
    win.focus()
  }
}

function primaryDisplay() {
  return screen.getPrimaryDisplay()
}

/** Menu bar / notch strip height (workArea starts below it). */
function menuBarHeight() {
  const d = primaryDisplay()
  // On notched Macs this is typically ~37–38; fall back if workArea.y is 0.
  return Math.max(Math.round(d.workArea.y), 32)
}

/**
 * Collapsed island fills the notch strip: same height as the menu bar,
 * roughly notch width, so the grey handle sits *in* the black notch zone
 * instead of hanging below it.
 */
function sizesForDisplay(): Record<IslandMode, IslandSize> {
  const notchH = menuBarHeight()
  return {
    collapsed: { width: 184, height: notchH },
    // Signed-in Yap idle usually uses resizeIslandTo; this is the unauth pill fallback.
    pill: { width: 360, height: notchH + 120 },
    expanded: { width: 340, height: notchH + 148 },
  }
}

/** Pin top edge to y=0 (screen top / notch). Grow downward on expand. */
function placeIsland(size: IslandSize) {
  if (!win) return
  const { bounds } = primaryDisplay()
  const x = Math.round(bounds.x + (bounds.width - size.width) / 2)
  const y = bounds.y // absolute top of the display — overlaps the menu bar / notch
  win.setBounds({ x, y, width: size.width, height: size.height }, false)
}

function resizeIsland(mode: IslandMode) {
  const size = sizesForDisplay()[mode]
  placeIsland(size)
  return size
}

/** Content-driven size (auth panel h-fit). Clamped so it never goes tiny/huge. */
function resizeIslandTo(size: IslandSize) {
  const notchH = menuBarHeight()
  const width = Math.max(200, Math.min(Math.round(size.width), 480))
  const height = Math.max(notchH + 80, Math.min(Math.round(size.height), 520))
  const next = { width, height }
  placeIsland(next)
  return next
}

function createIslandWindow() {
  const collapsed = sizesForDisplay().collapsed

  win = new BrowserWindow({
    ...collapsed,
    show: false,
    frame: false,
    // Lets CSS cursors work in the top of a frameless macOS window (otherwise
    // the hidden titlebar steals cursor and cursor-pointer never shows).
    titleBarStyle: "customButtonsOnHover",
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: true,
    roundedCorners: false,
    thickFrame: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  })

  // Highest practical level so we can sit in the notch / menu-bar region.
  win.setAlwaysOnTop(true, "screen-saver", 1)
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  if (process.platform === "darwin") {
    win.setWindowButtonVisibility(false)
    win.setHiddenInMissionControl(true)
  }

  placeIsland(collapsed)

  win.on("ready-to-show", () => {
    placeIsland(sizesForDisplay().collapsed)
    win?.showInactive()
    if (pendingDeepLinkUrl) {
      win?.webContents.send("auth:deep-link", pendingDeepLinkUrl)
    }
  })

  // Keep pinned to the notch if the user switches displays / resolution.
  screen.on("display-metrics-changed", () => {
    if (!win) return
    const bounds = win.getBounds()
    const modes = sizesForDisplay()
    // Re-place using current height to infer mode roughly.
    if (bounds.height <= modes.collapsed.height + 4) placeIsland(modes.collapsed)
    else if (bounds.height <= modes.pill.height + 4) placeIsland(modes.pill)
    else placeIsland(modes.expanded)
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: "deny" }
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"))
  }
}

// --- Protocol / deep link (must register before ready on macOS) ---
registerProtocolClient()

app.on("open-url", (event, url) => {
  event.preventDefault()
  forwardDeepLinkToRenderer(url)
})

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on("second-instance", (_event, argv) => {
    const url = argv.find(
      (arg) => arg.startsWith(PROTOCOL_PREFIX) || isAppProtocolUrl(arg),
    )
    if (url) forwardDeepLinkToRenderer(url)
    if (win && !win.isDestroyed()) {
      win.show()
      win.focus()
    }
  })
}

app.whenReady().then(() => {
  if (process.platform === "darwin") {
    // Accessory apps don't take Dock focus and can sit in the menu-bar region.
    app.dock?.hide()
    app.setActivationPolicy?.("accessory")
  }

  ipcMain.handle("open-external", (_event, url: string) => shell.openExternal(url))
  ipcMain.handle("island:resize", (_event, mode: IslandMode) => resizeIsland(mode))
  ipcMain.handle("island:resize-to", (_event, size: IslandSize) => resizeIslandTo(size))
  ipcMain.handle("island:get-sizes", () => sizesForDisplay())
  ipcMain.handle("island:menu-bar-height", () => menuBarHeight())
  // macOS: prompt once so getUserMedia in the renderer can read levels.
  ipcMain.handle("media:ask-microphone", async () => {
    if (process.platform !== "darwin") return true
    return systemPreferences.askForMediaAccess("microphone")
  })
  ipcMain.handle("auth:get-pending-deep-link", () => pendingDeepLinkUrl)
  ipcMain.on("auth:consume-deep-link", (_event, url?: string) => {
    if (typeof url === "string") {
      if (pendingDeepLinkUrl === url) pendingDeepLinkUrl = null
      return
    }
    pendingDeepLinkUrl = null
  })

  createIslandWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createIslandWindow()
    else {
      placeIsland(sizesForDisplay().collapsed)
      win?.showInactive()
    }
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
    win = null
  }
})
