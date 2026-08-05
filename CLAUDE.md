# CLAUDE.md

Guidance for Claude Code when working in this repo. Keep it terse.

## Keeping this file current

Whenever a change contradicts something written here (new command, moved file, changed convention, replaced tool, altered env/secret handling), flag it and recommend updating this `CLAUDE.md` so the guidance stays accurate. Do not let the doc drift out of sync with the code — surface the conflict as soon as you notice it, and propose the exact edit.

## Explaining things

When explaining a difficult concept or anything complex — data flow, architecture, auth/token flow, request lifecycle, state machines, tricky control flow — draw an **ASCII diagram** alongside the prose. Show the moving parts and how they connect, not just a wall of text.

## Refactoring rules

Applies to the entire monorepo — `backend/`, `electron/`, and `supabase/`.

Before refactoring, find existing tests that cover the behavior. If coverage is missing, propose minimal characterization tests that lock in current behavior.

Using ASCII diagrams, present:
1. Current architecture summary
2. Risky dependencies
3. Refactor plan in small commits
4. Tests that should pass before and after
5. Files likely to change
6. Proposed new architecture and folder structure

Rules:
- Do not make code changes yet.
- At each important step, stop and wait for the user's command before proceeding.
- Do not continue automatically after planning, editing, test creation, or test execution.
- Keep the output focused and structured.

## What this repo is

A **Yappy** starter — Electron desktop + FastAPI + Supabase.

| Route | Demonstrates | Backend |
|-------|--------------|---------|
| `/chat` | SSE streaming chat | `POST /chat/stream` |
| `/inference` | one-shot completion | `POST /inference` |
| `/todos` | auth-scoped CRUD + Inngest event | `/todos` |
| `/health` | health matrix (app + API + Supabase + LLM + Inngest) | `GET /health/matrix` |

Chat/inference need OpenAI (`OPENAI_ENABLED=true` + `OPENAI_API_KEY` in
`backend/.env`); without it they 503 and the matrix marks `llm` as `disabled`.
`OPENAI_BASE_URL` optionally redirects to any OpenAI-compatible gateway.

### Models

Default is **`gpt-5.6-terra`** (`OPENAI_MODEL`). The GPT-5.6 family (released
2026-07-09) is one generation in three tiers — all 1M context, 128k max output,
2026-02-16 knowledge cutoff:

| Model id | Tier | $/1M in | $/1M out | Use for |
|----------|------|---------|----------|---------|
| `gpt-5.6-luna` | fast/cheap | 1 | 6 | high-volume, latency-sensitive |
| `gpt-5.6-terra` | balanced (default) | 2.50 | 15 | everyday app work |
| `gpt-5.6-sol` | flagship | 5 | 30 | hard reasoning, coding, agents |

`gpt-5.6` is an alias for Sol. **Do not downgrade the default to an older
`gpt-5*` model** — pick a tier within this family instead.

Note: the OpenAI Python SDK reads `OPENAI_BASE_URL` from the environment on its
own. Keep it **commented out** in `.env` rather than set to an empty string — a
blank value makes every call fail with `Request URL is missing an 'http://' or
'https://' protocol`. `app/clients/llm_clients.py` passes `base_url` explicitly
to neutralize this.

## Stack & layout

Monorepo:
- `backend/` — FastAPI, managed with **uv** (Python 3.12).
- `electron/` — Electron (Vite + vite-plugin-electron) + React + Tailwind v4 + React Query + shadcn/ui.
- `supabase/` — local Postgres stack (config, migrations, seed) driven by the Supabase CLI.

## Commands

- `make dev` — **one command to spin up everything** (`scripts/dev.sh`): Supabase + backend + Electron + Inngest Dev Server in one attachable tmux session. `make stop` tears it down; `make ps` / `make urls` inspect it. Needs Docker + tmux.
- `make up` / `make down` — start/stop local Supabase (**needs Docker running**). `make up` == `supabase start`.
- `make status` — print local Supabase URLs + keys (copy anon/service keys into `backend/.env`).
- `make reset` — re-run migrations + seed.
- `make backend` — FastAPI on :8000 (`uv run uvicorn app.main:app --reload`).
- `make electron` — Electron desktop app (`pnpm dev`).
- Backend checks: `cd backend && uv run ruff check . && uv run pytest`. (If `uv run <script>` ever fails with `Failed to spawn`, the `.venv` was built at a different absolute path — `rm -rf backend/.venv && uv sync` fixes the stale shebangs.)
- Electron checks: `cd electron && pnpm typecheck`.

## Testing / test user

**Always use the seeded canonical test user — do not sign up throwaway accounts.** Loaded by `supabase/seed.sql` on `make reset` / `supabase start`:

- email: `e2e-test@example.com`
- password: `testpass123`
- id: `11111111-1111-1111-1111-111111111111` (owns the seeded demo todos)

**Never run Playwright / e2e scripts** (`pnpm e2e`, `playwright test`, etc.) — not automatically and not when asked.

If you sign in as this user right after `make reset`, force a todos refetch (reload) — React Query may hold a stale empty list from before auth.

## Local DB access

There is no cloud Supabase MCP configured (removed — it targets remote projects only, can't reach the local stack). Query the **local** Postgres directly through the Supabase DB Docker container:

```bash
docker exec supabase_db_yappy psql -U postgres -d postgres -c "select id, email, last_sign_in_at from auth.users;"
```

- Container name: `supabase_db_yappy` (find it with `docker ps --filter name=supabase_db`).
- `psql` is **not** installed on the host — always go through `docker exec`.
- Direct connection string (if a host `psql`/tool ever exists): `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.
- Signed-in / auth users live in the `auth.users` table; app tables are in `public`.

## Inngest MCP

The `inngest` MCP server (`.mcp.json`, `http://127.0.0.1:8288/mcp`) is available for inspecting the queue / background jobs on the local Inngest Dev Server — list registered functions, check run status, inspect events, and trigger runs. Use it to see what's happening in the queues (e.g. `list_functions`, `get_run_status`, `send_event`). Requires the Dev Server running (`make dev` starts it).

## Git workflow

Commit and push to the **current branch** unless told otherwise — even when that branch is `main`. Do not auto-create a new branch before committing.

## Bug checking

Pick the tool by what you're reviewing:

- **Uncommitted / staged / local changes** — use the `/code-review` skill (reviews the working-tree diff, no commit/push needed). `/security-review` for the security angle. Do **not** use greptile for uncommitted work — it ignores uncommitted files (`warning: … uncommitted file not included`).
- **Committed changes on a branch** — use the **greptile CLI**: `greptile review` diffs the current branch against its base (default `main`) and dispatches to Greptile cloud. Requires an `origin` remote and the repo connected/indexed in the Greptile dashboard. Flow: feature branch → commit → push → `greptile review`.
- **A GitHub PR** — the `/review` skill.

Greptile only reviews committed branch-vs-base diffs (cloud); it is not a local/staged scanner.

## Domain-specific conventions

Each subtree has its own `CLAUDE.md` (auto-loads when Claude works in that folder):
- `backend/CLAUDE.md` — FastAPI conventions (assembly point, settings, Supabase factory, auth, fat routers).
- `electron/CLAUDE.md` — Electron/React/Tailwind/React Query conventions.
- `supabase/CLAUDE.md` — migrations, RLS, schema, Google OAuth config.

## Env / secrets

- **Env files by consumer** (all gitignored; commit only the `.env.example` of each):
  - **Root `.env` — MCP / tooling only** (`LINEAR_API_KEY`, `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`). Claude Code expands `${VAR}` in `.mcp.json` from the **shell env**, not from this file. `LINEAR_API_KEY` is now stored in the **macOS login Keychain** (`security add-generic-password -a "$USER" -s LINEAR_API_KEY -w <key> -U`); a `claude()` wrapper function in `~/.zshrc` calls `load_keychain_secrets` to export it before launching the real `claude`, so the Linear MCP connects automatically with no manual sourcing. For the other vars (or a one-off shell), source manually: `set -a; source .env; set +a`.
  - **`backend/.env` — backend config** (`cp backend/.env.example backend/.env`). `backend/app/main.py` `load_dotenv()`s `backend/.env` (`parents[1]/.env`).
  - **`electron/.env` — Electron renderer config** (Vite `VITE_*` vars), when needed.
- Local Supabase keys come from `make status` (a.k.a. `supabase status`). **New key standard** (CLI now issues these; legacy anon/service_role deprecated end-2026): client apps use `sb_publishable_…`; backend uses `SUPABASE_SECRET_KEY` (`sb_secret_…`, replaces service_role) plus `SUPABASE_JWT_SECRET` (HS256 fallback while the local stack has no asymmetric signing keys). Backend token verification derives its JWKS URL from `SUPABASE_URL` (override with `SUPABASE_JWKS_URL`).
- Google OAuth: `[auth.external.google]` in `config.toml` reads `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`/`_SECRET` from the env — put them in `supabase/.env` (gitignored) and load before `make up`. `skip_nonce_check = true` is required for local Google sign-in.
