import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("ipcRenderer", {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.off(channel, listener)
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    return ipcRenderer.off(...args)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
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
})
