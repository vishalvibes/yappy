# Yappy backend

FastAPI backend, managed with [uv](https://docs.astral.sh/uv/).

## Setup

```bash
uv sync                      # create .venv and install deps (incl. dev + test)
cp .env.example .env         # then fill keys from `supabase status`
```

## Run

```bash
uv run uvicorn app.main:app --reload --port 8000
```

Docs at http://localhost:8000/docs

## Test / lint

```bash
uv run pytest
uv run ruff check .
uv run ruff format .
```

## Layout

```
app/
  main.py            # app assembly: load_dotenv → lifespan → include_router
  core/settings.py   # os.getenv-backed Settings
  clients/supabase.py# Supabase async client factories + shared httpx transport
  clients/llm_clients.py # OpenAI client (built only when enabled)
  utils/llm.py       # chat completion helpers (buffered + SSE streaming)
  routers/           # one APIRouter module per domain
    health.py        # /, /health, /health/matrix
    chat.py          # /inference, /chat, /chat/stream
    todos.py         # auth-scoped CRUD
  event_handlers/    # Inngest durable functions, one module per domain
  services/          # business logic (add per-domain packages here)
```
