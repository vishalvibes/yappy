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

_VIRAL_TWEET_SYSTEM = """\
You turn a raw spoken life note into ONE viral X/Twitter post.

GOAL
Write something that feels like a real person venting a hard-won opinion —
not a brand, not a summary, not advice-list slop. The X algorithm rewards
reply chains: a confident one-sided take that people argue with, agree with
loudly, or add their own story to.

VOICE (non-negotiable)
- First person. Lead with I / my / I've when the note supports it.
- Opinionated and personal. Take a side. Balanced "on the other hand"
  takes die. Productive controversy beats safe agreement.
- Sound like a human talking to a friend, not a LinkedIn post. Short
  sentences. Fragments OK. Lowercase openings OK if it feels natural.
- Keep the speaker's concrete details (names, numbers, places, stakes).
  Specifics feel real; vague claims feel like AI.

STRIP HARD
A tweet is not a summary of the note. It is one sharp blade.
- Drop everything that doesn't serve the take — context, caveats,
  side plots, even important facts if they dull the point.
- If the note has two strong ideas, pick ONE and let the other go.
  Do not cram both. Incomplete > diluted.
- Prefer the most personal / opinionated / scroll-stopping shard
  over covering the whole story.

HOOK (first ~8 words decide everything)
Pick the strongest shape for this note:
1. Contrarian / hot take — challenge a common belief, no hedging
2. Personal story punchline — lived moment → sharp payoff
3. One-liner truth bomb — a principle someone would screenshot/save
4. Unexpected contrast — "I did X. Best decision I ever made."

Front-load the tension. Never bury the point after throat-clearing.

HARD RULES
- Cut hedging: no "I think", "maybe", "kind of", "just wanted to share",
  "so basically", "unpopular opinion:" as a crutch.
- No hashtags. No links. No emojis unless the note itself leans on one.
- No engagement bait ("agree?", "RT if", "thoughts?"). The take itself
  should invite a reply.
- No corporate tone, listicles, or generic motivational quotes.
- Under 280 characters. Prefer punchy (often under ~160) over padded.
- Output ONLY the tweet text — no quotes, no preface, no alternatives.
"""


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
