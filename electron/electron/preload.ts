import { contextBridge, ipcRenderer } from "electron"

/** Renderer may only listen on these channels (main → renderer). */
const ALLOWED_RECEIVE = new Set([
  "auth:deep-link",
  "yap:escape-end",
  "tweets:set",
])

/** Renderer may only send (fire-and-forget) on these channels. */
const ALLOWED_SEND = new Set(["auth:consume-deep-link"])

/** Renderer may only invoke on these channels. */
const ALLOWED_INVOKE = new Set([
  "open-external",
  "island:resize",
  "island:resize-to",
  "island:get-sizes",
  "island:menu-bar-height",
  "island:set-ignore-mouse-events",
  "media:ask-microphone",
  "auth:get-pending-deep-link",
  "tweets:open",
  "tweets:get",
  "tweets:update",
  "tweets:close",
  "capture:region",
  "yap:set-escape-ends-recording",
])

function assertChannel(kind: string, channel: string, allowed: Set<string>) {
  if (!allowed.has(channel)) {
    throw new Error(`Blocked IPC ${kind}: ${channel}`)
  }
}

contextBridge.exposeInMainWorld("ipcRenderer", {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    assertChannel("on", channel, ALLOWED_RECEIVE)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.off(channel, listener)
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, listener] = args
    assertChannel("off", channel, ALLOWED_RECEIVE)
    return ipcRenderer.off(channel, listener)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    assertChannel("send", channel, ALLOWED_SEND)
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    assertChannel("invoke", channel, ALLOWED_INVOKE)
    return ipcRenderer.invoke(channel, ...omit)
  },
  openExternal: (url: string) => ipcRenderer.invoke("open-external", url),
  resizeIsland: (mode: "collapsed" | "pill" | "expanded") =>
    ipcRenderer.invoke("island:resize", mode),
  resizeIslandTo: (size: { width: number; height: number }) =>
    ipcRenderer.invoke("island:resize-to", size) as Promise<{
      width: number
      height: number
    }>,
  getIslandSizes: () =>
    ipcRenderer.invoke("island:get-sizes") as Promise<{
      collapsed: { width: number; height: number }
      pill: { width: number; height: number }
      expanded: { width: number; height: number }
    }>,
  getMenuBarHeight: () =>
    ipcRenderer.invoke("island:menu-bar-height") as Promise<number>,
  setIgnoreMouseEvents: (ignore: boolean, opts?: { forward?: boolean }) =>
    ipcRenderer.invoke(
      "island:set-ignore-mouse-events",
      ignore,
      opts?.forward,
    ) as Promise<void>,
  askMicrophoneAccess: () =>
    ipcRenderer.invoke("media:ask-microphone") as Promise<boolean>,
  getPendingDeepLink: () =>
    ipcRenderer.invoke("auth:get-pending-deep-link") as Promise<string | null>,
  consumeDeepLink: (url?: string) =>
    ipcRenderer.send("auth:consume-deep-link", url),
  openTweetsWindow: (tweets: string[]) =>
    ipcRenderer.invoke("tweets:open", tweets) as Promise<{ ok: boolean }>,
  getTweets: () => ipcRenderer.invoke("tweets:get") as Promise<string[]>,
  updateTweets: (tweets: string[]) =>
    ipcRenderer.invoke("tweets:update", tweets) as Promise<{ ok: boolean }>,
  closeTweetsWindow: () => ipcRenderer.invoke("tweets:close") as Promise<void>,
  captureRegion: () =>
    ipcRenderer.invoke("capture:region") as Promise<
      | { ok: true; dataUrl: string }
      | { ok: false; cancelled?: boolean; error?: string }
    >,
  setEscapeEndsRecording: (enabled: boolean) =>
    ipcRenderer.invoke("yap:set-escape-ends-recording", enabled) as Promise<void>,
})
