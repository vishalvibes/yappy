"""Health, liveness and the health matrix.

Three levels, cheapest first:

    GET /          service banner (is the process up)
    GET /health    liveness probe — no I/O, safe for k8s / load balancers
    GET /health/matrix   readiness matrix — one row per dependency, checked
                         concurrently. Never 500s: a broken dependency shows up
                         as a "down" row, not as a failed request.
"""

import asyncio
import time
from typing import Awaitable, Callable

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from supabase import AClient

from app.clients import llm_clients
from app.clients.supabase import get_supabase_client
from app.core.settings import settings

router = APIRouter(tags=["health"])


# --- models ------------------------------------------------------------------
class ComponentHealth(BaseModel):
    name: str
    status: str  # "up" | "down" | "disabled"
    detail: str
    latency_ms: float | None = None


class HealthMatrix(BaseModel):
    status: str  # "healthy" | "degraded"
    service: str
    environment: str
    components: list[ComponentHealth]


# --- routes ------------------------------------------------------------------
@router.get("/")
async def root() -> dict[str, str]:
    return {"service": settings.APP_NAME, "status": "ok"}


@router.get("/health")
async def health() -> dict[str, str]:
    """Liveness probe — does not touch the database."""
    return {"status": "healthy", "environment": settings.ENVIRONMENT}


@router.get("/health/matrix")
async def health_matrix(
    supabase: AClient = Depends(get_supabase_client),
) -> HealthMatrix:
    """Readiness matrix — every dependency probed in parallel."""
    components = list(
        await asyncio.gather(
            _timed("api", _check_api),
            _timed("supabase", lambda: _check_supabase(supabase)),
            _timed("llm", _check_llm),
            _timed("sarvam", _check_sarvam),
            _timed("inngest", _check_inngest),
        )
    )

    degraded = any(c.status == "down" for c in components)
    return HealthMatrix(
        status="degraded" if degraded else "healthy",
        service=settings.APP_NAME,
        environment=settings.ENVIRONMENT,
        components=components,
    )


# --- checks ------------------------------------------------------------------
async def _check_api() -> tuple[str, str]:
    return "up", f"FastAPI serving on port {settings.PORT}"


async def _check_supabase(supabase: AClient) -> tuple[str, str]:
    # Cheapest possible round-trip that still proves PostgREST + auth work.
    await supabase.table("todos").select("id").limit(1).execute()
    return "up", settings.SUPABASE_URL


async def _check_llm() -> tuple[str, str]:
    # Read through the module so the check sees the client built at startup
    # (importing the name directly would bind None at import time).
    if not settings.OPENAI_ENABLED:
        return "disabled", "OPENAI_ENABLED is false"
    if llm_clients.openai_client is None:
        return "down", "enabled but client not initialized (missing OPENAI_API_KEY)"
    return "up", f"OpenAI model {settings.OPENAI_MODEL}"


async def _check_sarvam() -> tuple[str, str]:
    # Yap STT depends on Sarvam; no live probe — key presence only (like llm disabled).
    if not settings.SARVAM_API_KEY:
        return "disabled", "SARVAM_API_KEY is not set"
    return "up", "SARVAM_API_KEY configured"


async def _check_inngest() -> tuple[str, str]:
    # The SDK is served in-process at /api/inngest; the Dev Server discovers it.
    # We only assert the local wiring, not that the Dev Server is reachable.
    return "up", "functions served at /api/inngest"


# --- helpers -----------------------------------------------------------------
async def _timed(
    name: str, check: Callable[[], Awaitable[tuple[str, str]]]
) -> ComponentHealth:
    """Run one check, timing it and turning any exception into a down row."""
    started = time.perf_counter()
    try:
        status, detail = await check()
    except Exception as e:
        status, detail = "down", f"{type(e).__name__}: {e}"
    return ComponentHealth(
        name=name,
        status=status,
        detail=detail,
        latency_ms=round((time.perf_counter() - started) * 1000, 1),
    )
