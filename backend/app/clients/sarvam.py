"""Sarvam Speech-to-Text client.

REST sync transcription for short clips (<30s): POST /speech-to-text with
multipart audio + Api-Subscription-Key. Docs:
https://docs.sarvam.ai/api-reference/speech-to-text/transcribe
"""

from __future__ import annotations

import httpx
from loguru import logger

from app.core.settings import settings

_SARVAM_STT_URL = "https://api.sarvam.ai/speech-to-text"
_DEFAULT_MODEL = "saaras:v3"
_DEFAULT_MODE = "transcribe"
_TIMEOUT_S = 60.0


class SarvamError(RuntimeError):
    """Raised when Sarvam STT fails or is misconfigured."""


def _normalize_content_type(content_type: str) -> str:
    """Sarvam rejects parameterized MIME types like audio/webm;codecs=opus."""
    base = (content_type or "audio/webm").split(";", 1)[0].strip().lower()
    return base or "audio/webm"


async def transcribe_audio(
    audio: bytes,
    *,
    filename: str = "yap.webm",
    content_type: str = "audio/webm",
) -> tuple[str, str | None]:
    """Transcribe audio via Sarvam. Returns (transcript, language_code)."""
    key = settings.SARVAM_API_KEY
    if not key:
        raise SarvamError("SARVAM_API_KEY is not configured")

    mime = _normalize_content_type(content_type)
    files = {"file": (filename, audio, mime)}
    data = {
        "model": _DEFAULT_MODEL,
        "mode": _DEFAULT_MODE,
        "language_code": "unknown",
    }

    async with httpx.AsyncClient(timeout=_TIMEOUT_S) as client:
        res = await client.post(
            _SARVAM_STT_URL,
            headers={"api-subscription-key": key},
            files=files,
            data=data,
        )

    if res.status_code != 200:
        logger.error(f"Sarvam STT {res.status_code}: {res.text[:500]}")
        raise SarvamError(f"Sarvam STT failed ({res.status_code})")

    body = res.json()
    transcript = (body.get("transcript") or "").strip()
    language_code = body.get("language_code")
    if not transcript:
        raise SarvamError("Sarvam returned an empty transcript")
    return transcript, language_code
