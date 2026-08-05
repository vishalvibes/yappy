.DEFAULT_GOAL := help
.PHONY: help dev stop ps urls up down reset status install backend electron inngest test test-be check-electron

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

# --- Full stack (one command: Supabase + backend + electron + Inngest in tmux) ---
dev: ## ⭐ Spin up the ENTIRE stack in one attachable tmux session
	./scripts/dev.sh dev

stop: ## Stop the full dev stack (tmux processes + Supabase)
	./scripts/dev.sh stop

ps: ## Show status of all dev services
	./scripts/dev.sh status

urls: ## Print all local service URLs
	./scripts/dev.sh urls

# --- Supabase (requires Docker running) ---
up: ## Start the local Supabase stack  (alias for `supabase start`)
	supabase start

down: ## Stop the local Supabase stack
	supabase stop

reset: ## Reset the local DB: re-run migrations + seed
	supabase db reset

status: ## Show local Supabase URLs and keys
	supabase status

# --- App ---
install: ## Install backend + electron deps
	cd backend && uv sync
	cd electron && pnpm install

backend: ## Run the FastAPI backend on :8000
	cd backend && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

electron: ## Run the Electron desktop app
	cd electron && pnpm dev

inngest: ## Run the Inngest Dev Server on :8288 (also serves the MCP endpoint)
	npx inngest-cli@latest dev -l warn -u http://localhost:8000/api/inngest

# --- Tests ---
test: test-be ## Run backend tests

test-be: ## Run backend tests (ruff + pytest)
	cd backend && uv run ruff check . && uv run pytest

check-electron: ## Typecheck the Electron app
	cd electron && pnpm typecheck
