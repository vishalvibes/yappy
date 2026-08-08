"""Yaps — voice memory → Sarvam STT (sync) → optional ephemeral viral tweets.

Flow:
  POST /yaps          upload audio (+ optional screenshot) → Sarvam STT
                      (+ OpenAI vision: describe + classify social_post|other)
                      → judge viewpoint (bias store) → insert only if
                      viewpoint worth remembering → return session payload
                      → if social_post + engagement, maybe store a SHORT
                        post_template (viral/intent/pattern + image note)
  GET  /yaps/{id}     fetch one yap
  POST /yaps/generate session memory (+ optional yap_id) + related past
                      viewpoints + post_templates (create mode) → ~10 tweet
                      variants (display only)
  POST /yaps/{id}/generate  thin wrapper → same as /yaps/generate
  POST /yaps/rewrite-tweets  voice feedback + current drafts → rewritten
                             variants (display only — not stored)
"""

from __future__ import annotations

import asyncio

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Response,
    UploadFile,
)
from loguru import logger
from pydantic import BaseModel
from supabase import AClient

from app.clients.sarvam import SarvamError, TranscriptionResult, transcribe_audio
from app.clients.supabase import get_supabase_client
from app.core.auth import get_current_user_id
from app.core.settings import settings
from app.services.yaps.constants import (
    _IMAGE_MIME_OK,
    _MAX_AUDIO_BYTES,
    _MAX_IMAGE_BYTES,
    _REWRITE_MAX_TOKENS,
    _SCREEN_KIND_SOCIAL,
    _TABLE,
    _detect_screen_kind,
    _normalize_screen_kind,
)
from app.services.yaps.memory import (
    _build_reference,
    _build_rewrite_prompt,
    _parse_tweets_input,
)
from app.services.yaps.models import ImageInsight
from app.services.yaps.pipeline import (
    _describe_image,
    _fetch_yap,
    _judge_viewpoint,
    _run_generate,
)
from app.services.yaps.prompts import (
    _TWEET_WRITING_TONE_DEFAULT,
    _build_rewrite_tweet_system,
)
from app.services.yaps.ranking import _rank_tweets
from app.services.yaps.schemas import GenerateIn, GenerateOut
from app.services.yaps.templates import _maybe_store_post_template
from app.services.yaps.json_parse import _parse_tweets
from app.utils.llm import create_chat_completion

# Re-exports for test `from app.routers.yaps import …` and patch targets.
from app.services.yaps.constants import _normalize_channel  # noqa: F401
from app.services.yaps.json_parse import (  # noqa: F401
    _parse_image_insight,
    _parse_rank_order,
    _parse_store_flag,
    _parse_template_extract,
)
from app.services.yaps.memory import (  # noqa: F401
    _build_generate_prompt,
    _combine_memory,
)
from app.services.yaps.models import PostTemplateDraft  # noqa: F401
from app.services.yaps.prompts import (  # noqa: F401
    _CREATE_CONTENT_SYSTEM,
    _REPLY_TWEET_SYSTEM,
    _REWRITE_TWEET_SYSTEM,
    _TEMPLATE_EXTRACT_SYSTEM,
    _TWEET_DENSITY_RUBRIC,
    _TWEET_RANK_SYSTEM,
    _VISION_SYSTEM,
    _build_create_content_system,
    _build_reply_tweet_system,
    _tweet_voice_block,
)
from app.services.yaps.ranking import (  # noqa: F401
    _llm_rank_tweets,
    _sort_tweets_by_value,
)
from app.services.yaps.related import (  # noqa: F401
    _fetch_related_yaps,
    _rank_related_transcripts,
)
from app.services.yaps.templates import (  # noqa: F401
    _extract_post_template,
    _fetch_post_templates,
    _heuristic_post_template,
    _is_viral_engagement,
    _parse_age_hours_from_text,
)

router = APIRouter(tags=["yaps"])


# --- models ------------------------------------------------------------------
class YapOut(BaseModel):
    id: str | None = None
    stored: bool = True
    status: str
    transcript: str | None = None  # user viewpoint only
    reference: str | None = None  # screen + audio context
    language_code: str | None = None
    error: str | None = None
    # From screenshot vision: social_post → reply; other → create content.
    screen_kind: str | None = None


class RewriteOut(BaseModel):
    tweets: list[str]
    feedback: str


# --- routes ------------------------------------------------------------------
@router.post("/yaps")
async def create_yap(
    response: Response,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    image: UploadFile | None = File(None),
    user_id: str = Depends(get_current_user_id),
    supabase: AClient = Depends(get_supabase_client),
) -> YapOut:
    """Accept audio (+ optional screenshot), transcribe / describe, store viewpoint."""
    if not settings.SARVAM_API_KEY:
        raise HTTPException(status_code=503, detail="Sarvam STT is not configured")

    audio = await file.read()
    if not audio:
        raise HTTPException(status_code=400, detail="empty audio")
    if len(audio) > _MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="audio too large")

    image_bytes: bytes | None = None
    image_mime: str | None = None
    if image is not None:
        image_bytes = await image.read()
        if not image_bytes:
            raise HTTPException(status_code=400, detail="empty image")
        if len(image_bytes) > _MAX_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail="image too large")
        image_mime = (image.content_type or "image/png").split(";")[0].strip().lower()
        if image_mime == "image/jpg":
            image_mime = "image/jpeg"
        if image_mime not in _IMAGE_MIME_OK:
            raise HTTPException(status_code=415, detail="unsupported image type")
        if not settings.OPENAI_ENABLED or not settings.OPENAI_API_KEY:
            raise HTTPException(
                status_code=503,
                detail="image description requires OpenAI",
            )

    filename = file.filename or "yap.webm"
    content_type = file.content_type or "audio/webm"

    shown: str | None = None
    screen_kind: str | None = None
    screen_channel: str | None = None
    screen_insight: ImageInsight | None = None

    async def _run_stt() -> TranscriptionResult:
        try:
            return await transcribe_audio(
                audio, filename=filename, content_type=content_type
            )
        except SarvamError as e:
            logger.warning(f"Sarvam STT failed: {e}")
            raise HTTPException(status_code=502, detail="transcription failed") from e
        except Exception as e:
            logger.error(f"Sarvam STT unexpected: {type(e).__name__}: {e}")
            raise HTTPException(status_code=502, detail="transcription failed") from e

    async def _run_vision() -> ImageInsight:
        assert image_bytes is not None and image_mime is not None
        try:
            return await _describe_image(image_bytes, image_mime)
        except RuntimeError as e:
            raise HTTPException(status_code=503, detail=str(e)) from e
        except Exception as e:
            logger.error(f"image describe failed: {type(e).__name__}: {e}")
            raise HTTPException(
                status_code=502, detail="image description failed"
            ) from e

    if image_bytes is not None and image_mime is not None:
        stt, insight = await asyncio.gather(_run_stt(), _run_vision())
        shown = insight.description
        screen_kind = insight.kind
        screen_channel = insight.channel
        screen_insight = insight
    else:
        stt = await _run_stt()

    viewpoint = (stt.user_speech or stt.transcript or "").strip()
    reference = _build_reference(
        shown=shown,
        screen_kind=screen_kind,
        reference_speech=stt.reference_speech,
    )
    language_code = stt.language_code

    should_store = await _judge_viewpoint(viewpoint)
    if screen_kind == _SCREEN_KIND_SOCIAL and shown and viewpoint:
        # Fail-open side effect — not needed for the create response.
        background_tasks.add_task(
            _maybe_store_post_template,
            supabase,
            user_id=user_id,
            description=shown,
            channel_hint=screen_channel,
            insight=screen_insight,
        )

    if should_store:
        res = (
            await supabase.table(_TABLE)
            .insert(
                {
                    "user_id": user_id,
                    "status": "ready",
                    "transcript": viewpoint or None,
                    "reference": reference,
                    "screen_kind": screen_kind,
                    "language_code": language_code,
                }
            )
            .execute()
        )
        response.status_code = 201
        if not res.data:
            raise HTTPException(status_code=502, detail="yap insert returned no row")
        return _to_out(res.data[0], stored=True)

    response.status_code = 200
    return YapOut(
        id=None,
        stored=False,
        status="ready",
        transcript=viewpoint or None,
        reference=reference,
        language_code=language_code,
        screen_kind=screen_kind,
    )


@router.get("/yaps/{yap_id}")
async def get_yap(
    yap_id: str,
    user_id: str = Depends(get_current_user_id),
    supabase: AClient = Depends(get_supabase_client),
) -> YapOut:
    yap = await _fetch_yap(supabase, yap_id, user_id)
    return _to_out(yap, stored=True)


@router.post("/yaps/generate")
async def generate_tweets(
    body: GenerateIn,
    user_id: str = Depends(get_current_user_id),
    supabase: AClient = Depends(get_supabase_client),
) -> GenerateOut:
    """Turn session memory into viral tweet variants. Display-only — not persisted."""
    return await _run_generate(body, user_id=user_id, supabase=supabase)


@router.post("/yaps/{yap_id}/generate")
async def generate_tweets_by_id(
    yap_id: str,
    user_id: str = Depends(get_current_user_id),
    supabase: AClient = Depends(get_supabase_client),
) -> GenerateOut:
    """Thin wrapper — load row then generate (same as POST /yaps/generate)."""
    return await _run_generate(
        GenerateIn(yap_id=yap_id),
        user_id=user_id,
        supabase=supabase,
    )


@router.post("/yaps/rewrite-tweets")
async def rewrite_tweets(
    file: UploadFile = File(...),
    tweets: str = Form(...),
    user_id: str = Depends(get_current_user_id),
) -> RewriteOut:
    """Voice feedback + current drafts → rewritten tweet variants (ephemeral)."""
    del user_id  # auth-gated; feedback is not persisted
    if not settings.SARVAM_API_KEY:
        raise HTTPException(status_code=503, detail="Sarvam STT is not configured")
    if not settings.OPENAI_ENABLED or not settings.OPENAI_API_KEY:
        raise HTTPException(status_code=503, detail="OpenAI is not configured")

    drafts = _parse_tweets_input(tweets)
    if not drafts:
        raise HTTPException(status_code=400, detail="tweets required")

    audio = await file.read()
    if not audio:
        raise HTTPException(status_code=400, detail="empty audio")
    if len(audio) > _MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="audio too large")

    filename = file.filename or "feedback.webm"
    content_type = file.content_type or "audio/webm"

    try:
        stt: TranscriptionResult = await transcribe_audio(
            audio,
            filename=filename,
            content_type=content_type,
            diarize=False,
        )
    except SarvamError as e:
        logger.warning(f"Sarvam STT failed (rewrite): {e}")
        raise HTTPException(status_code=502, detail="transcription failed") from e
    except Exception as e:
        logger.error(f"Sarvam STT unexpected (rewrite): {type(e).__name__}: {e}")
        raise HTTPException(status_code=502, detail="transcription failed") from e

    feedback = (stt.user_speech or stt.transcript or "").strip()
    if not feedback:
        raise HTTPException(status_code=400, detail="empty feedback transcript")

    user_prompt = _build_rewrite_prompt(drafts, feedback)
    tone = _TWEET_WRITING_TONE_DEFAULT

    try:
        completion = await create_chat_completion(
            messages=[
                {"role": "system", "content": _build_rewrite_tweet_system(tone)},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=_REWRITE_MAX_TOKENS,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        logger.error(f"tweet rewrite failed: {type(e).__name__}: {e}")
        raise HTTPException(status_code=502, detail="tweet rewrite failed") from e

    raw = (completion.choices[0].message.content or "").strip()
    rewritten = await _rank_tweets(
        _parse_tweets(raw),
        context=user_prompt,
        mode="rewrite",
    )
    if not rewritten:
        raise HTTPException(status_code=502, detail="empty tweets from model")

    return RewriteOut(tweets=rewritten, feedback=feedback)


def _to_out(row: dict, *, stored: bool = True) -> YapOut:
    transcript = row.get("transcript")
    reference = row.get("reference")
    screen_kind = row.get("screen_kind")
    if screen_kind:
        screen_kind = _normalize_screen_kind(str(screen_kind))
    elif transcript:
        screen_kind = _detect_screen_kind(transcript)
    return YapOut(
        id=row.get("id"),
        stored=stored,
        status=row["status"],
        transcript=transcript,
        reference=reference,
        language_code=row.get("language_code"),
        error=row.get("error"),
        screen_kind=screen_kind,
    )
