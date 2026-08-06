"""Yaps routes — smoke tests with mocked Sarvam / LLM."""

from __future__ import annotations

import io
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_yap_requires_sarvam_key(
    client: AsyncClient, auth_headers: dict[str, str]
):
    with patch("app.routers.yaps.settings") as s:
        s.SARVAM_API_KEY = ""
        res = await client.post(
            "/yaps",
            headers=auth_headers,
            files={"file": ("yap.webm", io.BytesIO(b"fake"), "audio/webm")},
        )
    assert res.status_code == 503


@pytest.mark.asyncio
async def test_create_yap_empty_audio(
    client: AsyncClient, auth_headers: dict[str, str]
):
    with patch("app.routers.yaps.settings") as s:
        s.SARVAM_API_KEY = "test-key"
        res = await client.post(
            "/yaps",
            headers=auth_headers,
            files={"file": ("yap.webm", io.BytesIO(b""), "audio/webm")},
        )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_generate_requires_ready_transcript(
    client: AsyncClient, auth_headers: dict[str, str]
):
    fake_yap = {
        "id": "11111111-1111-1111-1111-111111111111",
        "status": "processing",
        "transcript": None,
    }
    with patch(
        "app.routers.yaps._fetch_yap",
        new=AsyncMock(return_value=fake_yap),
    ):
        res = await client.post(
            f"/yaps/{fake_yap['id']}/generate",
            headers=auth_headers,
        )
    assert res.status_code == 409
