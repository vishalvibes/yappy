Yappy desktop — Electron notch / Dynamic Island shell (Clicky-inspired).

Vite + vite-plugin-electron + React + Tailwind + React Query + Supabase auth.

## Island UX

- Collapsed: thin bar tucked under the macOS notch (`island:resize` → `collapsed`)
- Hover: expands to pill (prompts) or expanded panel (auth / drop zone)
- Dock icon hidden; always-on-top panel window

## Commands

- `make electron` — `pnpm dev`
- Env: `cp electron/.env.example electron/.env` (keys from `make status`)

## Layout

```
electron/
  electron/main.ts      # notch BrowserWindow + resize IPC
  electron/preload.ts
  src/components/island/dynamic-island.tsx
  src/App.tsx           # island is the root UI
```
