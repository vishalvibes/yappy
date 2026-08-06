import { app, BrowserWindow, ipcMain, screen, shell } from "electron"
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

type IslandSize = { width: number; height: number }
type IslandMode = "collapsed" | "pill" | "expanded"

let win: BrowserWindow | null = null

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
    pill: { width: 340, height: notchH + 56 },
    expanded: { width: 380, height: notchH + 200 },
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

function createIslandWindow() {
  const collapsed = sizesForDisplay().collapsed

  win = new BrowserWindow({
    ...collapsed,
    show: false,
    frame: false,
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

app.whenReady().then(() => {
  if (process.platform === "darwin") {
    // Accessory apps don't take Dock focus and can sit in the menu-bar region.
    app.dock?.hide()
    app.setActivationPolicy?.("accessory")
  }

  ipcMain.handle("open-external", (_event, url: string) => shell.openExternal(url))
  ipcMain.handle("island:resize", (_event, mode: IslandMode) => resizeIsland(mode))
  ipcMain.handle("island:get-sizes", () => sizesForDisplay())
  ipcMain.handle("island:menu-bar-height", () => menuBarHeight())

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
