# backend/CLAUDE.md

Backend-specific guidance. Root `CLAUDE.md` (repo layout, commands, env/secrets, refactoring rules) still applies.

FastAPI, managed with **uv** (Python 3.12).

Generic code-organization rules (top-down, factories, reuse-first, senior-dev modular code): see `../specs/architecture.md`.

Generic REST rules (GET query-param filtering with `start_time`/`end_time`/`limit`/`cursor`, max limit 1000; single PATCH per entity): see `../specs/api-design.md`.

## Commands

- `make backend` (from repo root) — FastAPI on :8000 (`uv run uvicorn app.main:app --reload`).
- Checks: `cd backend && uv run ruff check . && uv run pytest`.

## Conventions

- `app/main.py` is the single assembly point: `load_dotenv()` first, lifespan-managed clients, one `include_router` per domain (no router prefixes).
- Settings: plain `os.getenv`-backed `Settings` class in `app/core/settings.py` (no pydantic-settings).
- Supabase access via a single factory in `app/clients/supabase.py`, injected as a FastAPI dep (`get_supabase_client` = full-access server client via the new **secret key** `SUPABASE_SECRET_KEY` / `sb_secret_…`, bypasses RLS; falls back to legacy `SUPABASE_SERVICE_ROLE_KEY`). A shared httpx transport is created/closed in the lifespan.
- Auth: the client sends the Supabase access token as `Authorization: Bearer <jwt>`. `app/core/auth.py`'s `get_current_user_id` dep verifies it **asymmetric-first** (ES256/RS256 via the project's JWKS endpoint — the new Supabase standard) and **falls back to HS256** with `SUPABASE_JWT_SECRET` for the legacy shared-secret stack (the default local CLI is still HS256; its JWKS is empty). Returns `sub`. Because the server client bypasses RLS, routes must scope every query by `user_id` themselves — isolation is app-level, not DB-level.
- Routers are "fat": inline Pydantic models, private `_helpers` on top, top-down organization (main functions first).
- Ruff runs on defaults (no custom rule set).
