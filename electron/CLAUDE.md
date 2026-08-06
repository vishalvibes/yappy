Yappy desktop — Electron notch / Dynamic Island shell (Clicky-inspired).

Vite + vite-plugin-electron + React + Tailwind + React Query + Supabase auth.

## Island UX

- Collapsed: thin bar tucked under the macOS notch (`island:resize` → `collapsed`)
- Hover: expands to pill (prompts) or expanded panel (auth / drop zone)
- Dock icon hidden; always-on-top panel window

## Motion / transitions

**Default: no transition animations.** Do not add `transition-*`, `animate-*`,
`duration-*`, or layout fades/slides on island mode changes, auth content, or
window resize. Instant state swaps only. Motion is opt-in and needs an explicit
product reason — never the default when building UI.

## Google OAuth (desktop)

Browser + HTTP bridge + custom protocol (harmony pattern):

1. `signInWithOAuth({ skipBrowserRedirect: true, redirectTo: http://127.0.0.1:8000/oauth/google/desktop/callback?app_protocol=yappy-dev })`
2. `openExternal` → Google → Supabase → **backend bridge** HTML
3. Bridge opens `yappy-dev://auth/callback?code=…`
4. Main `open-url` / `second-instance` → renderer `auth:deep-link` → `exchangeCodeForSession`

Requires **backend running** (`make backend` / `make dev`). Custom schemes alone are
rejected by local Supabase (falls back to `site_url` → `http://127.0.0.1:5173/?code=…`).

Needs Google client id/secret in `supabase/.env`, then restart Supabase so
`additional_redirect_urls` includes the bridge + `yappy://` URLs.

## Commands

- `make electron` — `pnpm dev`
- Env: `cp electron/.env.example electron/.env` (keys from `make status`)

## Layout

```
electron/
  electron/main.ts      # notch BrowserWindow + protocol + resize IPC
  electron/preload.ts
  src/core/auth-redirect.ts
  src/core/auth-callback.ts
  src/components/island/dynamic-island.tsx
  src/App.tsx           # island is the root UI
```
