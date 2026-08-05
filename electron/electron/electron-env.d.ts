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
}

interface Window {
  ipcRenderer: YappyIpcRenderer
}
