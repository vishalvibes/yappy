"""Yaps — voice memory → Sarvam STT (sync) → optional ephemeral viral tweet.

Flow:
  POST /yaps          upload audio → Sarvam STT → store memory → return ready
  GET  /yaps/{id}     fetch one yap
  POST /yaps/{id}/generate   transcript → one viral tweet (display only — not stored)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from loguru import logger
from pydantic import BaseModel
from supabase import AClient

from app.clients.sarvam import SarvamError, transcribe_audio
from app.clients.supabase import get_supabase_client
from app.core.auth import get_current_user_id
from app.core.settings import settings
from app.utils.llm import create_chat_completion

router = APIRouter(tags=["yaps"])

_TABLE = "yaps"
_MAX_AUDIO_BYTES = 8 * 1024 * 1024  # 8 MiB — short yaps
_TWEET_MAX_TOKENS = 400

_VIRAL_TWEET_SYSTEM = (
    "You turn a raw spoken life note into one viral tweet. "
    "Output ONLY the tweet text — no quotes, no hashtags unless essential, "
    "no preface, no alternatives. Punchy, first-person, paste-ready. "
    "Aim under 280 characters."
)


# --- models ------------------------------------------------------------------
class YapOut(BaseModel):
    id: str
    status: str
    transcript: str | None = None
    language_code: str | None = None
    error: str | None = None


class GenerateOut(BaseModel):
    id: str
    tweet: str


# --- routes ------------------------------------------------------------------
@router.post("/yaps", status_code=201)
async def create_yap(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
    supabase: AClient = Depends(get_supabase_client),
) -> YapOut:
    """Accept audio, transcribe with Sarvam, store memory, return ready yap."""
    if not settings.SARVAM_API_KEY:
        raise HTTPException(status_code=503, detail="Sarvam STT is not configured")

    audio = await file.read()
    if not audio:
        raise HTTPException(status_code=400, detail="empty audio")
    if len(audio) > _MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="audio too large")

    filename = file.filename or "yap.webm"
    content_type = file.content_type or "audio/webm"

    try:
        transcript, language_code = await transcribe_audio(
            audio, filename=filename, content_type=content_type
        )
    except SarvamError as e:
        logger.warning(f"Sarvam STT failed: {e}")
        raise HTTPException(status_code=502, detail="transcription failed") from e
    except Exception as e:
        logger.error(f"Sarvam STT unexpected: {type(e).__name__}: {e}")
        raise HTTPException(status_code=502, detail="transcription failed") from e

    res = (
        await supabase.table(_TABLE)
        .insert(
            {
                "user_id": user_id,
                "status": "ready",
                "transcript": transcript,
                "language_code": language_code,
            }
        )
        .execute()
    )
    return _to_out(res.data[0])


@router.get("/yaps/{yap_id}")
async def get_yap(
    yap_id: str,
    user_id: str = Depends(get_current_user_id),
    supabase: AClient = Depends(get_supabase_client),
) -> YapOut:
    yap = await _fetch_yap(supabase, yap_id, user_id)
    return _to_out(yap)


@router.post("/yaps/{yap_id}/generate")
async def generate_tweet(
    yap_id: str,
    user_id: str = Depends(get_current_user_id),
    supabase: AClient = Depends(get_supabase_client),
) -> GenerateOut:
    """Turn the yap transcript into one viral tweet. Display-only — not persisted."""
    yap = await _fetch_yap(supabase, yap_id, user_id)
    if yap["status"] != "ready" or not (yap.get("transcript") or "").strip():
        raise HTTPException(
            status_code=409,
            detail="yap transcript not ready yet",
        )

    transcript = yap["transcript"].strip()
    try:
        completion = await create_chat_completion(
            messages=[
                {"role": "system", "content": _VIRAL_TWEET_SYSTEM},
                {"role": "user", "content": transcript},
            ],
            max_tokens=_TWEET_MAX_TOKENS,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        logger.error(f"tweet generate failed: {type(e).__name__}: {e}")
        raise HTTPException(status_code=502, detail="tweet generation failed") from e

    tweet = (completion.choices[0].message.content or "").strip()
    if not tweet:
        raise HTTPException(status_code=502, detail="empty tweet from model")

    return GenerateOut(id=yap_id, tweet=tweet)


# --- helpers -----------------------------------------------------------------
async def _fetch_yap(supabase: AClient, yap_id: str, user_id: str) -> dict:
    res = (
        await supabase.table(_TABLE)
        .select("*")
        .eq("id", yap_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="yap not found")
    return res.data[0]


def _to_out(row: dict) -> YapOut:
    return YapOut(
        id=row["id"],
        status=row["status"],
        transcript=row.get("transcript"),
        language_code=row.get("language_code"),
        error=row.get("error"),
    )
