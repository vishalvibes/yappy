import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  shell,
  systemPreferences,
} from "electron"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

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
const IS_DEV = Boolean(VITE_DEV_SERVER_URL)
const APP_PROTOCOL = IS_DEV ? "yappy-dev" : "yappy"
const PROTOCOL_PREFIX = `${APP_PROTOCOL}://`

// Distinct name in dev so stores / Activity Monitor don't collide with packaged app.
if (IS_DEV) {
  app.setName("yappy-desktop-dev")
}

// Dev: override Electron’s default icon. Prod uses the packaged app icon
// (electron-builder `mac.icon` → yappy-mac-icon.png when packaging is added).
const devIcon = IS_DEV
  ? nativeImage.createFromPath(
      path.join(process.env.APP_ROOT, "yappy-mac-dev-icon.png"),
    )
  : null

if (devIcon && !devIcon.isEmpty() && process.platform === "darwin") {
  app.dock?.setIcon(devIcon)
}

type IslandSize = { width: number; height: number }
type IslandMode = "collapsed" | "pill" | "expanded"

let win: BrowserWindow | null = null
let tweetsWin: BrowserWindow | null = null
let pendingTweets: string[] = []
let pendingDeepLinkUrl: string | null = null
let lastDeepLinkUrl: string | null = null
let lastDeepLinkAt = 0
let escapeEndsRecording = false

/** While listening, Escape cancels recording — even if another app is focused. */
function setEscapeEndsRecording(enabled: boolean) {
  const next = Boolean(enabled)
  if (next === escapeEndsRecording) return
  escapeEndsRecording = next
  if (next) {
    const ok = globalShortcut.register("Escape", () => {
      if (win && !win.isDestroyed()) {
        win.webContents.send("yap:escape-end")
      }
      if (tweetsWin && !tweetsWin.isDestroyed()) {
        tweetsWin.webContents.send("yap:escape-end")
      }
    })
    if (!ok) {
      console.error("Failed to register Escape shortcut for canceling recording")
      escapeEndsRecording = false
    }
    return
  }
  globalShortcut.unregister("Escape")
}

function showAppDock() {
  if (process.platform !== "darwin") return
  // Regular policy so Dock / Spotlight can surface the tweets window.
  app.setActivationPolicy?.("regular")
  app.dock?.show()
}

function hideAppDockIfIdle() {
  if (process.platform !== "darwin") return
  if (tweetsWin && !tweetsWin.isDestroyed() && tweetsWin.isVisible()) return
  app.dock?.hide()
  // Back to notch accessory when no document window is open.
  app.setActivationPolicy?.("accessory")
}

function tweetsPageUrl() {
  if (VITE_DEV_SERVER_URL) return `${VITE_DEV_SERVER_URL}#/tweets`
  return `file://${path.join(RENDERER_DIST, "index.html")}#/tweets`
}

function pushTweetsToWindow(tweets: string[]) {
  pendingTweets = tweets
  if (!tweetsWin || tweetsWin.isDestroyed()) return
  tweetsWin.webContents.send("tweets:set", tweets)
}

/** True during region capture — hide/show of the island must not reveal tweets. */
let screenCaptureInProgress = false

function revealTweetsWindow() {
  if (!tweetsWin || tweetsWin.isDestroyed()) return
  showAppDock()
  if (tweetsWin.isMinimized()) tweetsWin.restore()
  tweetsWin.show()
  tweetsWin.focus()
}

/** Activate must not un-hide tweets during region capture. */
function shouldAutoRevealTweets() {
  return !screenCaptureInProgress
}

function presentTweetsWindow(tweets: string[]) {
  pendingTweets = tweets

  if (tweetsWin && !tweetsWin.isDestroyed()) {
    pushTweetsToWindow(tweets)
    const [currentWidth, currentHeight] = tweetsWin.getSize()
    if (currentWidth < 780) {
      tweetsWin.setSize(960, Math.max(currentHeight, 720))
    }
    revealTweetsWindow()
    return
  }

  tweetsWin = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 780,
    minHeight: 480,
    show: false,
    title: "Yappy — Tweets",
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 14 },
    ...(devIcon && !devIcon.isEmpty() ? { icon: devIcon } : {}),
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // Do not show on ready-to-show — wait until load + tweets payload are ready.
  tweetsWin.webContents.on("did-finish-load", () => {
    if (!tweetsWin || tweetsWin.isDestroyed()) return
    if (pendingTweets.length) {
      tweetsWin.webContents.send("tweets:set", pendingTweets)
    }
    revealTweetsWindow()
  })

  tweetsWin.on("closed", () => {
    tweetsWin = null
    hideAppDockIfIdle()
  })

  tweetsWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: "deny" }
  })

  void tweetsWin.loadURL(tweetsPageUrl())
}

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
 * Collapsed island: menu-bar height. Width may stay at last expanded size
 * (avoids left ghost); renderer limits hover via setIgnoreMouseEvents.
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
  win.invalidateShadow()
}

function resizeIsland(mode: IslandMode) {
  const size = { ...sizesForDisplay()[mode] }
  // Height-only collapse — keep width/x to avoid a one-frame left ghost handle.
  // Renderer limits the hot zone to the notch band (setIgnoreMouseEvents).
  if (mode === "collapsed" && win && !win.isDestroyed()) {
    size.width = win.getBounds().width
  }
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

type CaptureRegionResult =
  | { ok: true; dataUrl: string }
  | { ok: false; cancelled?: boolean; error?: string }

/** Interactive region screenshot (macOS screencapture). Hides Yappy windows first. */
async function captureRegion(): Promise<CaptureRegionResult> {
  if (process.platform !== "darwin") {
    return { ok: false, error: "Screen capture is only on macOS for now" }
  }

  const dir = await mkdtemp(path.join(tmpdir(), "yappy-cap-"))
  const file = path.join(dir, "region.png")
  const islandWasVisible = Boolean(win && !win.isDestroyed() && win.isVisible())
  // Hide tweets before the island. Otherwise island.hide() activates the
  // next same-app window and the tweets doc jumps over the screen to capture.
  const tweetsWasVisible = Boolean(
    tweetsWin &&
      !tweetsWin.isDestroyed() &&
      tweetsWin.isVisible() &&
      !tweetsWin.isMinimized(),
  )

  // Block activate-driven reveal for the whole capture + island restore.
  screenCaptureInProgress = true
  try {
    if (tweetsWasVisible && tweetsWin && !tweetsWin.isDestroyed()) {
      tweetsWin.hide()
    }
    if (win && !win.isDestroyed()) win.hide()
    // Let hides paint so neither window is in the shot / selection UI.
    await new Promise((resolve) => setTimeout(resolve, 100))

    try {
      await execFileAsync("screencapture", ["-i", "-x", "-t", "png", file])
    } catch {
      return { ok: false, cancelled: true }
    }

    const buf = await readFile(file)
    if (!buf.length) return { ok: false, cancelled: true }

    return {
      ok: true,
      dataUrl: `data:image/png;base64,${buf.toString("base64")}`,
    }
  } catch {
    return { ok: false, error: "capture failed" }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
    // Never re-show tweets here — only generate-finish should bring it forward.
    // Restoring with showInactive was popping a background/hidden tweets window.
    if (tweetsWasVisible) hideAppDockIfIdle()
    // showInactive — restore island without stealing focus from the captured app.
    if (islandWasVisible && win && !win.isDestroyed()) {
      win.showInactive()
    }
    // Defer clear so activate from showInactive still sees the suppress flag.
    setImmediate(() => {
      screenCaptureInProgress = false
    })
  }
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
    ...(devIcon && !devIcon.isEmpty() ? { icon: devIcon } : {}),
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
  ipcMain.handle(
    "island:set-ignore-mouse-events",
    (_event, ignore: boolean, forward?: boolean) => {
      if (!win || win.isDestroyed()) return
      if (ignore) win.setIgnoreMouseEvents(true, { forward: forward ?? true })
      else win.setIgnoreMouseEvents(false)
    },
  )
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

  ipcMain.handle("tweets:open", (_event, tweets: unknown) => {
    const list = Array.isArray(tweets)
      ? tweets.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      : []
    if (!list.length) return { ok: false as const }
    presentTweetsWindow(list)
    return { ok: true as const }
  })
  ipcMain.handle("tweets:get", () => pendingTweets)
  ipcMain.handle("tweets:update", (_event, tweets: unknown) => {
    const list = Array.isArray(tweets)
      ? tweets.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      : []
    if (!list.length) return { ok: false as const }
    pendingTweets = list
    return { ok: true as const }
  })
  ipcMain.handle("tweets:close", () => {
    if (tweetsWin && !tweetsWin.isDestroyed()) tweetsWin.close()
  })
  ipcMain.handle("capture:region", () => captureRegion())
  ipcMain.handle("yap:set-escape-ends-recording", (_event, enabled: unknown) => {
    setEscapeEndsRecording(Boolean(enabled))
  })

  createIslandWindow()

  app.on("will-quit", () => {
    setEscapeEndsRecording(false)
    globalShortcut.unregisterAll()
  })

  app.on("activate", () => {
    // Capture in flight: never surface tweets; keep island only.
    if (!shouldAutoRevealTweets()) {
      if (!win || win.isDestroyed()) createIslandWindow()
      else {
        placeIsland(sizesForDisplay().collapsed)
        win.showInactive()
      }
      return
    }
    // Dock click while tweets already on screen — focus it. Do not un-hide.
    if (tweetsWin && !tweetsWin.isDestroyed() && tweetsWin.isVisible()) {
      showAppDock()
      if (tweetsWin.isMinimized()) tweetsWin.restore()
      tweetsWin.focus()
      return
    }
    if (!win || win.isDestroyed()) createIslandWindow()
    else {
      placeIsland(sizesForDisplay().collapsed)
      win.showInactive()
    }
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
    win = null
    tweetsWin = null
  }
})
