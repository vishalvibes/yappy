import pytest
from httpx import ASGITransport, AsyncClient

from app.clients import llm_clients
from app.clients.supabase import get_supabase_client
from app.core.settings import settings
from app.main import app


# --- fakes -------------------------------------------------------------------
class _OkQuery:
    def select(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    async def execute(self):
        return type("Result", (), {"data": []})()


class _OkSupabase:
    def table(self, _name: str):
        return _OkQuery()


class _BrokenSupabase:
    def table(self, _name: str):
        raise ConnectionError("postgrest unreachable")


def _component(body: dict, name: str) -> dict:
    return next(c for c in body["components"] if c["name"] == name)


# --- tests -------------------------------------------------------------------
@pytest.mark.unit
async def test_health():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "healthy"


@pytest.mark.unit
async def test_health_matrix_healthy(client, monkeypatch):
    app.dependency_overrides[get_supabase_client] = _OkSupabase
    # An unconfigured LLM must not degrade the matrix — it reports "disabled".
    monkeypatch.setattr(settings, "OPENAI_ENABLED", False)
    monkeypatch.setattr(settings, "SARVAM_API_KEY", "")

    res = await client.get("/health/matrix")

    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "healthy"
    assert {c["name"] for c in body["components"]} == {
        "api",
        "supabase",
        "llm",
        "sarvam",
        "inngest",
    }
    assert _component(body, "supabase")["status"] == "up"
    assert _component(body, "llm")["status"] == "disabled"
    assert _component(body, "sarvam")["status"] == "disabled"


@pytest.mark.unit
async def test_health_matrix_llm_down_when_enabled_but_unbuilt(client, monkeypatch):
    """Enabled + no client = a real misconfiguration, so the row goes down."""
    app.dependency_overrides[get_supabase_client] = _OkSupabase
    monkeypatch.setattr(settings, "OPENAI_ENABLED", True)
    monkeypatch.setattr(llm_clients, "openai_client", None)

    res = await client.get("/health/matrix")

    body = res.json()
    assert body["status"] == "degraded"
    assert _component(body, "llm")["status"] == "down"


@pytest.mark.unit
async def test_health_matrix_degrades_instead_of_failing(client):
    """A dead dependency becomes a "down" row — the request still returns 200."""
    app.dependency_overrides[get_supabase_client] = _BrokenSupabase

    res = await client.get("/health/matrix")

    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "degraded"
    supabase = _component(body, "supabase")
    assert supabase["status"] == "down"
    assert "ConnectionError" in supabase["detail"]
