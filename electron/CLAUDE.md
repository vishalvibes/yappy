Yappy desktop — Electron (Vite + vite-plugin-electron) + React + Tailwind v4 + React Query + shadcn/ui + Supabase auth.

Same surfaces as the old web template: auth gate, chat (SSE), inference, todos, health.

Generic UI rules: see `../specs/frontend.md`. Root `../CLAUDE.md` still applies.

## Commands

- `make electron` — `pnpm dev`
- Checks: `cd electron && pnpm typecheck`
- Env: `cp electron/.env.example electron/.env` (keys from `make status`)

## Layout

```
electron/
  electron/          # main + preload
  src/               # React renderer (@/*)
    components/      # app-shell, auth, chat, todos, ui/...
    hooks/           # React Query hooks by verb
    lib/             # api, supabase, chat-stream, query-client
  index.html
  vite.config.ts
```

## Conventions

- HashRouter: `/` auth gate → `/chat` | `/inference` | `/todos` | `/health`
- shadcn in `components/ui`; reuse before create
- React Query: singleton `queryClient` in `src/core/query-client.ts` (persisted localStorage), wrapped by `Providers`
- Auth: client-only Supabase (`lib/supabase.ts` + `AuthProvider`); `apiFetch` / `apiClient` attach Bearer
- Chat streaming: `streamChat` in `lib/chat-stream.ts` (raw fetch + SSE)
- Env: `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
