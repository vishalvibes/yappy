# ruff: noqa: E402
"""FastAPI application assembly.

Load .env first (before importing anything that reads settings), then build the
single FastAPI instance: lifespan-managed clients + one include_router per
domain, matching the harmony house style.
"""

from pathlib import Path

from dotenv import load_dotenv

# Backend config lives in backend/.env (the repo-root .env is MCP/tooling only).
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

import sys
from contextlib import asynccontextmanager

import inngest.fast_api
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from app.clients.inngest import inngest_client
from app.clients.llm_clients import init_llm_clients
from app.clients.supabase import (
    close_shared_supabase_transport,
    init_shared_supabase_transport,
)
from app.core.settings import settings
from app.event_handlers.todos_event_handlers import handle_todo_created
from app.routers import chat, health, oauth, todos, yaps

logger.remove()
logger.add(sys.stderr, level=settings.LOG_LEVEL)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # startup
    init_shared_supabase_transport()
    init_llm_clients(app)
    logger.info(f"{settings.APP_NAME} starting (env={settings.ENVIRONMENT})")
    yield
    # shutdown
    await close_shared_supabase_transport()
    logger.info(f"{settings.APP_NAME} shutting down")


app = FastAPI(title=settings.APP_NAME, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(chat.router)
app.include_router(todos.router)
app.include_router(oauth.router)
app.include_router(yaps.router)

# Inngest: expose durable functions at /api/inngest (discovered/synced by the
# Dev Server in local dev). Register one handler per domain here.
inngest.fast_api.serve(
    app,
    inngest_client,
    [
        handle_todo_created,
    ],
)
