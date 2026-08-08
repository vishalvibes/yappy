/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    APP_ROOT: string
    VITE_PUBLIC: string
  }
}

type BivariantIpcListener = {
  bivarianceHack(event: unknown, ...args: unknown[]): void
}["bivarianceHack"]

interface YappyIpcRenderer {
  on: (channel: string, listener: BivariantIpcListener) => () => void
  off: (channel: string, listener: BivariantIpcListener) => void
  send: (channel: string, ...args: unknown[]) => void
  invoke: <T = unknown>(channel: string, ...args: unknown[]) => Promise<T>
  openExternal: (url: string) => Promise<void>
  resizeIsland: (
    mode: "collapsed" | "pill" | "expanded",
  ) => Promise<{ width: number; height: number }>
  resizeIslandTo: (size: {
    width: number
    height: number
  }) => Promise<{ width: number; height: number }>
  getIslandSizes: () => Promise<{
    collapsed: { width: number; height: number }
    pill: { width: number; height: number }
    expanded: { width: number; height: number }
  }>
  getMenuBarHeight: () => Promise<number>
  setIgnoreMouseEvents: (
    ignore: boolean,
    opts?: { forward?: boolean },
  ) => Promise<void>
  askMicrophoneAccess: () => Promise<boolean>
  getPendingDeepLink: () => Promise<string | null>
  consumeDeepLink: (url?: string) => void
  openTweetsWindow: (tweets: string[]) => Promise<{ ok: boolean }>
  getTweets: () => Promise<string[]>
  updateTweets: (tweets: string[]) => Promise<{ ok: boolean }>
  closeTweetsWindow: () => Promise<void>
  captureRegion: () => Promise<
    | { ok: true; dataUrl: string }
    | { ok: false; cancelled?: boolean; error?: string }
  >
  setEscapeEndsRecording: (enabled: boolean) => Promise<void>
}

interface Window {
  ipcRenderer: YappyIpcRenderer
}
