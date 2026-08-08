"""JSON fence stripping and LLM response parsers."""

from __future__ import annotations

import json
import re

from app.services.yaps.constants import (
    _SCREEN_KIND_OTHER,
    _SCREEN_KIND_SOCIAL,
    _normalize_channel,
    _normalize_screen_kind,
)
from app.services.yaps.models import ImageInsight, PostTemplateDraft

_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)


def _strip_fences(text: str) -> str:
    """Remove markdown code fences from model output."""
    t = text.strip()
    if t.startswith("```"):
        t = _FENCE_RE.sub("", t).strip()
    return t


def _parse_json_blob(raw: str) -> object | None:
    """Parse JSON from model output; tolerate fences and surrounding prose."""
    text = _strip_fences(raw)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    for open_c, close_c in (("[", "]"), ("{", "}")):
        start = text.find(open_c)
        end = text.rfind(close_c)
        if start >= 0 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                continue
    return None


def _parse_int_field(raw: object) -> int | None:
    if raw is None or raw is False:
        return None
    if isinstance(raw, bool):
        return None
    if isinstance(raw, int):
        return raw if raw >= 0 else None
    text = str(raw).strip().lower().replace(",", "")
    if not text or text in {"null", "none", "n/a", "-"}:
        return None
    mult = 1.0
    if text.endswith("k"):
        mult = 1_000.0
        text = text[:-1]
    elif text.endswith("m"):
        mult = 1_000_000.0
        text = text[:-1]
    try:
        return max(0, int(float(text) * mult))
    except ValueError:
        return None


def _parse_float_field(raw: object) -> float | None:
    if raw is None or isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        return float(raw) if raw >= 0 else None
    text = str(raw).strip().lower().replace(",", "")
    if not text or text in {"null", "none", "n/a", "-"}:
        return None
    try:
        value = float(text)
    except ValueError:
        return None
    return value if value >= 0 else None


def _parse_store_flag(raw: str) -> bool:
    """Parse judge JSON; default True (bias store) on ambiguity."""
    data = _parse_json_blob(raw)
    if isinstance(data, dict) and "store" in data:
        return bool(data["store"])
    return True


def _parse_tweets(raw: str) -> list[str]:
    """Parse a JSON string array from the model; tolerate fenced markdown."""
    data = _parse_json_blob(raw)
    if not isinstance(data, list):
        return []

    tweets: list[str] = []
    for item in data:
        if not isinstance(item, str):
            continue
        tweet = item.strip()
        if tweet:
            tweets.append(tweet)
    # Tolerate drift around the target; soft-cap above _TWEET_COUNT.
    return tweets[:12]


def _parse_image_insight(raw: str) -> ImageInsight:
    """Parse vision JSON; fall back to prose-as-description + other."""
    data = _parse_json_blob(raw)

    if isinstance(data, dict):
        description = str(
            data.get("description") or data.get("text") or ""
        ).strip()
        kind = _normalize_screen_kind(
            str(data.get("kind") or data.get("screen_kind") or "")
        )
        channel = None
        likes = replies = reposts = views = None
        age_hours = None
        has_image = False
        image_detail = None
        if kind == _SCREEN_KIND_SOCIAL:
            channel = _normalize_channel(
                str(data.get("channel") or data.get("platform") or "")
            )
            likes = _parse_int_field(data.get("likes"))
            reply_raw = data.get("replies")
            if reply_raw is None:
                reply_raw = data.get("comments")
            replies = _parse_int_field(reply_raw)
            reposts = _parse_int_field(data.get("reposts"))
            views = _parse_int_field(data.get("views"))
            age_hours = _parse_float_field(data.get("age_hours"))
            has_image = bool(data.get("has_image"))
            image_detail = str(data.get("image_detail") or "").strip() or None
        if description:
            return ImageInsight(
                kind=kind,
                description=description,
                channel=channel,
                likes=likes,
                replies=replies,
                reposts=reposts,
                views=views,
                age_hours=age_hours,
                has_image=has_image,
                image_detail=image_detail,
            )

    # Model returned plain prose — keep it usable as "other".
    return ImageInsight(
        kind=_SCREEN_KIND_OTHER, description=_strip_fences(raw), channel=None
    )


def _parse_rank_order(raw: str, n: int) -> list[int] | None:
    """Parse JSON index order; None if invalid."""
    data = _parse_json_blob(raw)
    if not isinstance(data, list) or not data:
        return None

    indices: list[int] = []
    if all(isinstance(x, int) for x in data):
        indices = [int(x) for x in data]
    elif all(isinstance(x, dict) for x in data):
        # [{index, score}, ...] best first or by score.
        rows: list[tuple[float, int]] = []
        for item in data:
            if not isinstance(item, dict):
                return None
            if "index" in item:
                idx = int(item["index"])  # type: ignore[arg-type]
            elif "i" in item:
                idx = int(item["i"])  # type: ignore[arg-type]
            else:
                return None
            sc = item.get("score")
            score = float(sc) if sc is not None else 0.0
            rows.append((score, idx))
        # If scores present and not already ordered, sort by score desc.
        if any(s != 0 for s, _ in rows):
            rows.sort(key=lambda r: r[0], reverse=True)
        indices = [idx for _, idx in rows]
    else:
        return None

    if sorted(indices) != list(range(n)):
        return None
    return indices


def _parse_template_extract(
    raw: str,
    *,
    channel_hint: str | None = None,
    insight: ImageInsight | None = None,
) -> PostTemplateDraft | None:
    """Parse template-extract JSON; None = skip store."""
    data = _parse_json_blob(raw)

    if not isinstance(data, dict):
        return None
    if not bool(data.get("store")):
        return None
    template = str(data.get("template") or "").strip()
    if not template:
        return None
    # Keep templates short — intent, not a dump.
    if len(template) > 400:
        template = template[:397].rstrip() + "…"
    channel = (
        _normalize_channel(str(data.get("channel") or ""))
        or _normalize_channel(channel_hint)
        or "other"
    )
    pattern_raw = str(data.get("pattern") or "").strip().lower() or None
    pattern = pattern_raw[:64] if pattern_raw else None
    likes = _parse_int_field(data.get("likes"))
    replies = _parse_int_field(data.get("replies"))
    reposts = _parse_int_field(data.get("reposts"))
    views = _parse_int_field(data.get("views"))
    age_hours = _parse_float_field(data.get("age_hours"))
    if insight:
        likes = likes if likes is not None else insight.likes
        replies = replies if replies is not None else insight.replies
        reposts = reposts if reposts is not None else insight.reposts
        views = views if views is not None else insight.views
        age_hours = age_hours if age_hours is not None else insight.age_hours
    has_image = bool(data.get("has_image"))
    if insight and insight.has_image:
        has_image = True
    image_detail = str(data.get("image_detail") or "").strip() or None
    if not image_detail and insight and insight.image_detail:
        image_detail = insight.image_detail
    if has_image and image_detail and "IMAGE:" not in template.upper():
        template = f"{template}\nIMAGE: {image_detail}".strip()
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
