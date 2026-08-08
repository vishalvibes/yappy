"""Generate pipeline orchestration — vision, judge, fetch, run."""

from __future__ import annotations

import asyncio
import base64

from fastapi import HTTPException
from loguru import logger
from supabase import AClient

from app.services.yaps import deps
from app.services.yaps.constants import (
    _SCREEN_KIND_SOCIAL,
    _TABLE,
    _TWEET_MAX_TOKENS,
    _VIEWPOINT_JUDGE_MAX_TOKENS,
    _VISION_MAX_TOKENS,
    _detect_screen_kind,
    _normalize_screen_kind,
)
from app.services.yaps.json_parse import (
    _parse_image_insight,
    _parse_store_flag,
    _parse_tweets,
)
from app.services.yaps.memory import _build_generate_note, _build_generate_prompt
from app.services.yaps.models import ImageInsight
from app.services.yaps.prompts import (
    _TWEET_WRITING_TONE_DEFAULT,
    _VIEWPOINT_JUDGE_SYSTEM,
    _VISION_SYSTEM,
    _build_create_content_system,
    _build_reply_tweet_system,
)
from app.services.yaps.schemas import GenerateIn, GenerateOut


async def _empty_template_list() -> list[dict]:
    return []


async def _run_generate(
    body: GenerateIn,
    *,
    user_id: str,
    supabase: AClient,
) -> GenerateOut:
    yap_id, viewpoint, note, screen_kind = await _resolve_generate_inputs(
        body, user_id=user_id, supabase=supabase
    )
    mode = "reply" if screen_kind == _SCREEN_KIND_SOCIAL else "create"
    tone = _TWEET_WRITING_TONE_DEFAULT
    system = (
        _build_reply_tweet_system(tone)
        if mode == "reply"
        else _build_create_content_system(tone)
    )

    related, post_templates = await asyncio.gather(
        deps.fetch_related_yaps(
            supabase,
            user_id=user_id,
            yap_id=yap_id,
            transcript=note or viewpoint or "",
        ),
        (
            deps.fetch_post_templates(supabase, user_id)
            if mode == "create"
            else _empty_template_list()
        ),
    )
    user_prompt = _build_generate_prompt(
        note, related, mode=mode, post_templates=post_templates
    )

    try:
        completion = await deps.create_chat_completion(
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=_TWEET_MAX_TOKENS,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        logger.error(f"tweet generate failed: {type(e).__name__}: {e}")
        raise HTTPException(status_code=502, detail="tweet generation failed") from e

    raw = (completion.choices[0].message.content or "").strip()
    tweets = await deps.rank_tweets(
        _parse_tweets(raw),
        context=user_prompt,
        mode=mode,
    )
    if not tweets:
        raise HTTPException(status_code=502, detail="empty tweets from model")

    return GenerateOut(
        id=yap_id, tweets=tweets, screen_kind=screen_kind, mode=mode
    )


async def _resolve_generate_inputs(
    body: GenerateIn,
    *,
    user_id: str,
    supabase: AClient,
) -> tuple[str | None, str | None, str, str | None]:
    """Return (yap_id, viewpoint, generate_note, screen_kind)."""
    if body.yap_id:
        yap = await deps.fetch_yap(supabase, body.yap_id, user_id)
        if yap["status"] != "ready":
            raise HTTPException(
                status_code=409,
                detail="yap transcript not ready yet",
            )
        viewpoint = (yap.get("transcript") or "").strip() or None
        reference = (yap.get("reference") or "").strip() or None
        screen_kind = yap.get("screen_kind")
        if screen_kind:
            screen_kind = _normalize_screen_kind(str(screen_kind))
        else:
            screen_kind = _detect_screen_kind(viewpoint or "") or _detect_screen_kind(
                reference or ""
            )
        note = _build_generate_note(viewpoint=viewpoint, reference=reference)
        if not note.strip():
            raise HTTPException(
                status_code=409,
                detail="yap transcript not ready yet",
            )
        return body.yap_id, viewpoint, note, screen_kind

    viewpoint = (body.transcript or "").strip() or None
    reference = (body.reference or "").strip() or None
    screen_kind = body.screen_kind
    if screen_kind:
        screen_kind = _normalize_screen_kind(str(screen_kind))
    else:
        screen_kind = _detect_screen_kind(viewpoint or "") or _detect_screen_kind(
            reference or ""
        )
    note = _build_generate_note(viewpoint=viewpoint, reference=reference)
    if not note.strip():
        raise HTTPException(
            status_code=400,
            detail="transcript or reference required",
        )
    return None, viewpoint, note, screen_kind


async def _judge_viewpoint(speech: str) -> bool:
    """Return True if speech is a viewpoint worth storing. Bias KEEP; fail-open."""
    text = (speech or "").strip()
    if not text:
        return False
    cfg = deps.settings()
    if not cfg.OPENAI_ENABLED or not cfg.OPENAI_API_KEY:
        return True
    try:
        completion = await deps.create_chat_completion(
            messages=[
                {"role": "system", "content": _VIEWPOINT_JUDGE_SYSTEM},
                {
                    "role": "user",
                    "content": f"Transcript:\n{text}",
                },
            ],
            model=cfg.OPENAI_MODEL_FAST,
            max_tokens=_VIEWPOINT_JUDGE_MAX_TOKENS,
        )
        raw = (completion.choices[0].message.content or "").strip()
        return _parse_store_flag(raw)
    except Exception as e:
        logger.warning(f"viewpoint judge failed (store anyway): {type(e).__name__}: {e}")
        return True


async def _describe_image(image_bytes: bytes, mime: str) -> ImageInsight:
    """OpenAI vision — classify screenshot + concrete description."""
    cfg = deps.settings()
    b64 = base64.b64encode(image_bytes).decode("ascii")
    data_url = f"data:{mime};base64,{b64}"
    completion = await deps.create_chat_completion(
        messages=[
            {"role": "system", "content": _VISION_SYSTEM},
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": (
                            "Classify and describe this screenshot. "
                            "Return JSON only."
                        ),
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": data_url},
                    },
                ],
            },
        ],
        model=cfg.OPENAI_MODEL_FAST,
        max_tokens=_VISION_MAX_TOKENS,
    )
    raw = (completion.choices[0].message.content or "").strip()
    insight = _parse_image_insight(raw)
    if not insight.description:
        raise RuntimeError("empty image description from model")
    return insight


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
