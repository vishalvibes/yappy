# Yappy

FastAPI + Electron + Supabase monorepo for **Yappy**.

| Part | Stack | Dir |
|------|-------|-----|
| Backend | FastAPI, [uv](https://docs.astral.sh/uv/), Python 3.12 | `backend/` |
| Desktop | Electron (Vite + vite-plugin-electron), React, Tailwind v4, React Query, shadcn/ui | `electron/` |
| Database | Supabase (local Postgres via the Supabase CLI) | `supabase/` |

## Prerequisites

- [Docker](https://www.docker.com/) **running** (required for the local Supabase stack)
- `uv`, `pnpm`, and the `supabase` CLI on your PATH

## Quick start

```bash
# 1. Install dependencies
make install                 # uv sync (backend) + pnpm install (electron)

# 2. Start the database  (Docker must be running)
make up                      # == supabase start
make status                  # copy keys into backend/.env

# 3. Configure env
cp backend/.env.example backend/.env

# 4. Run (two terminals)
make backend                 # FastAPI  -> http://localhost:8000  (docs at /docs)
make electron                # Electron desktop app
```

Or, in one shot: `make dev` (Supabase + backend + Electron + Inngest in one tmux
session).

## Common commands

| Command | What |
|---------|------|
| `make up` / `make down` | Start / stop local Supabase |
| `make status` | Print local Supabase URLs + keys |
| `make reset` | Re-run migrations + reseed the DB |
| `make backend` | Run FastAPI (`:8000`) |
| `make electron` | Run Electron desktop app |

## Database changes

```bash
supabase migration new <name>   # create a timestamped migration in supabase/migrations/
# edit the generated .sql, then:
make reset                      # apply migrations + seed to the local DB
```

See `CLAUDE.md` for conventions.
