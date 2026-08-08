"""Post template extraction, virality heuristics, and storage."""

from __future__ import annotations

import re

from loguru import logger
from supabase import AClient

from app.services.yaps import deps
from app.services.yaps.constants import (
    _AGE_LINE_RE,
    _AGE_RELATIVE_RE,
    _BULLET_LINE_RE,
    _DAY_LINE_RE,
    _ENGAGEMENT_LIKES_RE,
    _ENGAGEMENT_REPLIES_RE,
    _ENGAGEMENT_VIEWS_RE,
    _RANK_CHAIN_RE,
    _TEMPLATES_TABLE,
    _TEMPLATE_EXTRACT_MAX_TOKENS,
    _normalize_channel,
)
from app.services.yaps.json_parse import (
    _parse_int_field,
    _parse_template_extract,
)
from app.services.yaps.models import ImageInsight, PostTemplateDraft
from app.services.yaps.prompts import _TEMPLATE_EXTRACT_SYSTEM

def _comments_to_likes_ratio(likes: int | None, replies: int | None) -> float | None:
    if likes is None or replies is None or likes <= 0:
        return None
    return replies / likes


def _likes_to_views_rate(likes: int | None, views: int | None) -> float | None:
    """Like conversion: likes/views. Higher = denser approval (good for small accounts)."""
    if likes is None or views is None or views <= 0:
        return None
    return likes / views


def _replies_to_views_rate(replies: int | None, views: int | None) -> float | None:
    """Comment conversion: replies/views. Higher = denser discussion."""
    if replies is None or views is None or views <= 0:
        return None
    return replies / views


def _is_viral_engagement(
    *,
    likes: int | None,
    replies: int | None,
    views: int | None,
    age_hours: float | None = None,
) -> bool:
    """Time- and reach-aware virality (absolute + conversion rates)."""
    like_n = likes or 0
    reply_n = replies or 0
    view_n = views or 0
    age = age_hours if age_hours is not None and age_hours > 0 else None

    ratio = _comments_to_likes_ratio(likes, replies)
    if ratio is not None and like_n >= 15 and ratio >= 0.15:
        return True

    # View conversion — strong signal for low-follower / low-reach posts.
    like_rate = _likes_to_views_rate(likes, views)
    reply_rate = _replies_to_views_rate(replies, views)
    if like_rate is not None and view_n >= 200 and like_n >= 10 and like_rate >= 0.025:
        return True
    if reply_rate is not None and view_n >= 200 and reply_n >= 5 and reply_rate >= 0.005:
        return True
    # Extremely dense approval even on tiny reach.
    if like_rate is not None and view_n >= 100 and like_n >= 8 and like_rate >= 0.05:
        return True

    if age is not None:
        likes_per_hour = like_n / age
        replies_per_hour = reply_n / age
        if age <= 6:
            if like_n >= 15 or reply_n >= 5 or view_n >= 500:
                return True
            if likes_per_hour >= 5 or replies_per_hour >= 1:
                return True
        elif age <= 24:
            if like_n >= 30 or reply_n >= 10 or view_n >= 1500:
                return True
            if likes_per_hour >= 3:
                return True
        elif age <= 168:  # week
            if like_n >= 50 or reply_n >= 15:
                return True
            if view_n >= 5000 and like_n >= 40 and (
                like_rate is not None and like_rate >= 0.01
            ):
                return True
        else:
            # Older posts need bigger absolute traction OR strong conversion.
            if like_n >= 100 or reply_n >= 25:
                return True
            if like_rate is not None and like_n >= 20 and like_rate >= 0.03:
                return True
        return False

    # No age known — fall back to absolute bars + conversion.
    if like_n >= 50 or reply_n >= 15:
        return True
    if view_n >= 2000 and like_n >= 20 and (
        like_rate is not None and like_rate >= 0.015
    ):
        return True
    return False


def _parse_age_hours_from_text(text: str) -> float | None:
    m = _AGE_RELATIVE_RE.search(text or "")
    if not m:
        if re.search(r"(?i)\b(just now|now)\b", text or ""):
            return 0.1
        return None
    amount = float(m.group(1) or m.group(3) or 0)
    unit = (m.group(2) or m.group(4) or "h").lower()
    if unit.startswith("m"):
        return max(0.05, amount / 60.0)
    if unit.startswith("h"):
        return amount
    if unit.startswith("d"):
        return amount * 24.0
    if unit.startswith("w"):
        return amount * 168.0
    return amount


def _parse_engagement_from_text(
    text: str,
) -> tuple[int | None, int | None, int | None]:
    likes = None
    replies = None
    views = None
    m = _ENGAGEMENT_LIKES_RE.search(text)
    if m:
        likes = _parse_int_field(m.group(1))
    m = _ENGAGEMENT_REPLIES_RE.search(text)
    if m:
        replies = _parse_int_field(m.group(1))
    m = _ENGAGEMENT_VIEWS_RE.search(text)
    if m:
        views = _parse_int_field(m.group(1))
    return likes, replies, views


def _heuristic_post_template(
    description: str,
    *,
    channel_hint: str | None = None,
    insight: ImageInsight | None = None,
    user_engaged: bool = True,
) -> PostTemplateDraft | None:
    """Virality, pattern, or user-interest without an LLM. None if skip."""
    text = (description or "").strip()
    if not text:
        return None
    channel = (
        _normalize_channel(channel_hint)
        or (insight.channel if insight else None)
        or "twitter"
    )
    likes = insight.likes if insight else None
    replies = insight.replies if insight else None
    reposts = insight.reposts if insight else None
    views = insight.views if insight else None
    age_hours = insight.age_hours if insight else None
    if likes is None and replies is None and views is None:
        likes, replies, views = _parse_engagement_from_text(text)
    if age_hours is None:
        age_hours = _parse_age_hours_from_text(text)
    has_image = bool(insight.has_image) if insight else False
    image_detail = insight.image_detail if insight else None

    pattern: str | None = None
    template: str | None = None
    age_lines = _AGE_LINE_RE.findall(text)
    if len(age_lines) >= 3:
        pattern = "age_timeline"
        template = "INTENT: age-milestone career/life ladder\nSHAPE: {age}yo - {milestone}"
    elif len(_DAY_LINE_RE.findall(text)) >= 2:
        pattern = "day_plan"
        template = "INTENT: day-by-day grind plan\nSHAPE: Days {start}-{end}: {step}"
    elif len(_BULLET_LINE_RE.findall(text)) >= 4:
        pattern = "bullet_list"
        template = "INTENT: checklist / how-to list\nSHAPE: - {step}"
    elif _RANK_CHAIN_RE.search(text):
        pattern = "hot_take_ranking"
        template = "INTENT: hot-take ranking\nSHAPE: {a} > {b} > {c}"
    elif _is_viral_engagement(
        likes=likes, replies=replies, views=views, age_hours=age_hours
    ):
        pattern = "viral_short"
        snippet = re.sub(r"\s+", " ", text)[:120].strip()
        template = f"INTENT: viral short take\nSHAPE: {snippet}"
    elif user_engaged and len(re.sub(r"\s+", " ", text)) >= 40:
        # They yap'd on it — short interest template if there's real text.
        pattern = "user_interest"
        snippet = re.sub(r"\s+", " ", text)[:120].strip()
        template = f"INTENT: user found this interesting\nSHAPE: {snippet}"

    if template is None:
        return None
    if has_image and image_detail:
        template = f"{template}\nIMAGE: {image_detail}"
    elif has_image:
        template = f"{template}\nIMAGE: {{media}}"
    return PostTemplateDraft(
        channel=channel,
        template=template,
        pattern=pattern,
        likes=likes,
        replies=replies,
        reposts=reposts,
        views=views,
        age_hours=age_hours,
        has_image=has_image,
        image_detail=image_detail,
    )


async def _maybe_store_post_template(
    supabase: AClient,
    *,
    user_id: str,
    description: str,
    channel_hint: str | None,
    insight: ImageInsight | None = None,
) -> None:
    """Extract + insert a short post template. Fail-open."""
    text = (description or "").strip()
    if not text:
        logger.info("post template skip: empty description")
        return

    draft: PostTemplateDraft | None = None
    cfg = deps.settings()
    if cfg.OPENAI_ENABLED and cfg.OPENAI_API_KEY:
        try:
            draft = await deps.extract_post_template(
                text, channel_hint=channel_hint, insight=insight
            )
        except Exception as e:
            logger.warning(
                f"post template extract failed: {type(e).__name__}: {e}"
            )
    else:
        logger.info("post template: OpenAI disabled — trying heuristic")

    if draft is None:
        draft = _heuristic_post_template(
            text, channel_hint=channel_hint, insight=insight
        )
        if draft is None:
            logger.info("post template skip: not viral / no reusable intent")
            return
        logger.info("post template: heuristic accepted")

    try:
        res = await (
            supabase.table(_TEMPLATES_TABLE)
            .insert(
                {
                    "user_id": user_id,
                    "channel": draft.channel,
                    "template": draft.template,
                    "pattern": draft.pattern,
                    "likes": draft.likes,
                    "replies": draft.replies,
                    "reposts": draft.reposts,
                    "views": draft.views,
                    "age_hours": draft.age_hours,
                    "has_image": draft.has_image,
                    "image_detail": draft.image_detail,
                    "lifecycle": "active",
                }
            )
            .execute()
        )
        row_id = (res.data or [{}])[0].get("id") if res.data else None
        logger.info(
            f"post template stored id={row_id} channel={draft.channel} "
            f"pattern={draft.pattern} likes={draft.likes} replies={draft.replies}"
        )
    except Exception as e:
        logger.warning(f"post template insert failed: {type(e).__name__}: {e}")


async def _extract_post_template(
    description: str,
    *,
    channel_hint: str | None = None,
    insight: ImageInsight | None = None,
) -> PostTemplateDraft | None:
    """Return a short template draft or None if not worth storing."""
    hint = _normalize_channel(channel_hint) or "unknown"
    likes = insight.likes if insight else None
    replies = insight.replies if insight else None
    reposts = insight.reposts if insight else None
    views = insight.views if insight else None
    age_hours = insight.age_hours if insight else None
    has_image = bool(insight.has_image) if insight else False
    image_detail = insight.image_detail if insight else None
    completion = await deps.create_chat_completion(
        messages=[
            {"role": "system", "content": _TEMPLATE_EXTRACT_SYSTEM},
            {
                "role": "user",
                "content": (
                    f"Channel hint: {hint}\n"
                    f"USER_ENGAGED: true (they yap'd on this post)\n"
                    f"likes={likes} replies={replies} reposts={reposts} "
                    f"views={views} age_hours={age_hours}\n"
                    f"has_image={has_image}\n"
                    f"image_detail={image_detail!r}\n\n"
                    f"ON SCREEN description:\n{description.strip()}"
                ),
            },
        ],
        model=deps.settings().OPENAI_MODEL_FAST,
        max_tokens=_TEMPLATE_EXTRACT_MAX_TOKENS,
    )
    raw = (completion.choices[0].message.content or "").strip()
    return _parse_template_extract(
        raw, channel_hint=channel_hint, insight=insight
    )


async def _fetch_post_templates(
    supabase: AClient,
    user_id: str,
    *,
    limit: int = 5,
) -> list[dict]:
    """Fetch active post templates for create-mode prompts. Fail-open."""
    try:
        res = (
            await supabase.table(_TEMPLATES_TABLE)
            .select("channel, template, pattern")
            .eq("user_id", user_id)
            .eq("lifecycle", "active")
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return res.data or []
    except Exception as e:
        logger.warning(f"post template fetch failed: {type(e).__name__}: {e}")
        return []
