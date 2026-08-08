"""Tweet ranking — heuristic and LLM-assisted."""

from __future__ import annotations

from loguru import logger

from app.services.yaps import deps
from app.services.yaps.constants import (
    _DIGIT_RE,
    _TRUST_SIGNAL_RE,
    _TWEET_RANK_MAX_TOKENS,
)
from app.services.yaps.json_parse import _parse_rank_order
from app.services.yaps.prompts import _TWEET_RANK_SYSTEM
from app.services.yaps.related import _similarity, _tokenize

def _meat_score(tweet: str) -> float:
    """Light trust-asset / density bonus (not the primary rank signal)."""
    t = tweet.strip()
    if not t:
        return 0.0

    score = 0.0
    score += min(len(t), 280) * 0.05
    score += t.count("\n") * 4
    score += len(_DIGIT_RE.findall(t)) * 8
    score += len(_TRUST_SIGNAL_RE.findall(t)) * 5

    words = len(t.split())
    if words <= 3:
        score -= 12
    elif words <= 8:
        score -= 3

    return score


def _heuristic_tweet_value_score(
    tweet: str,
    *,
    context: str,
    peers: list[str],
) -> float:
    """Relevance + originality + value heuristic (fail-open ranker)."""
    t = tweet.strip()
    if not t:
        return -1e9

    ctx_tokens = _tokenize(context)
    tweet_tokens = _tokenize(t)
    score = 0.0

    # Relevance to yap / feedback / note.
    overlap = _similarity(tweet_tokens, ctx_tokens)
    score += overlap * 100

    # Soft length — not dominant.
    score += min(len(t), 220) * 0.08

    # Trust assets / mechanism (de-weighted vs old meat sort).
    score += _meat_score(t) * 0.35

    # Originality proxy: less overlap with ON SCREEN blob inside context.
    on_screen = ""
    if "ON SCREEN" in context:
        parts = context.split("ON SCREEN", 1)
        if len(parts) > 1:
            on_screen = parts[1]
    if on_screen:
        screen_overlap = _similarity(tweet_tokens, _tokenize(on_screen))
        score -= screen_overlap * 55

    # Anti-clone: penalize near-duplicates vs other peers.
    max_peer = 0.0
    for peer in peers:
        if peer is tweet or peer.strip() == t:
            continue
        max_peer = max(max_peer, _similarity(tweet_tokens, _tokenize(peer)))
    if max_peer >= 0.85:
        score -= 40
    elif max_peer >= 0.65:
        score -= 18

    # Ultra-short vibes without context overlap.
    if len(t.split()) <= 3 and overlap < 0.05:
        score -= 20

    return score


def _sort_tweets_by_value(drafts: list[str], *, context: str) -> list[str]:
    """Heuristic value rank — best first."""
    if len(drafts) <= 1:
        return list(drafts)
    scored = [
        (
            _heuristic_tweet_value_score(t, context=context, peers=drafts),
            idx,
            t,
        )
        for idx, t in enumerate(drafts)
    ]
    scored.sort(key=lambda row: (row[0], -row[1]), reverse=True)
    return [t for _, _, t in scored]


async def _llm_rank_tweets(
    drafts: list[str],
    *,
    context: str,
    mode: str,
) -> list[str] | None:
    """Ask the model for best→worst index order. None on failure."""
    cfg = deps.settings()
    numbered = "\n\n".join(
        f"[{i}]\n{text}" for i, text in enumerate(drafts)
    )
    completion = await deps.create_chat_completion(
        messages=[
            {"role": "system", "content": _TWEET_RANK_SYSTEM},
            {
                "role": "user",
                "content": (
                    f"Mode: {mode}\n\n"
                    f"CONTEXT:\n{context.strip()}\n\n"
                    f"DRAFTS ({len(drafts)}):\n{numbered}\n\n"
                    "Return JSON array of indices best→worst."
                ),
            },
        ],
        model=cfg.OPENAI_MODEL_FAST,
        max_tokens=_TWEET_RANK_MAX_TOKENS,
    )
    raw = (completion.choices[0].message.content or "").strip()
    order = _parse_rank_order(raw, len(drafts))
    if order is None:
        return None
    return [drafts[i] for i in order]


async def _rank_tweets(
    drafts: list[str],
    *,
    context: str,
    mode: str,
) -> list[str]:
    """Rank drafts by relevance / originality / value.

    Default: heuristic only (YAPS_LLM_RANK=false) to skip an extra RTT.
    When YAPS_LLM_RANK=true, try LLM then fail-open to heuristic.
    """
    if len(drafts) <= 1:
        return list(drafts)
    cfg = deps.settings()
    if cfg.YAPS_LLM_RANK and cfg.OPENAI_ENABLED and cfg.OPENAI_API_KEY:
        try:
            ordered = await deps.llm_rank_tweets(
                drafts, context=context, mode=mode
            )
            if ordered:
                return ordered
            logger.info("tweet rank: LLM order invalid — heuristic fallback")
        except Exception as e:
            logger.warning(f"tweet rank failed: {type(e).__name__}: {e}")
    return _sort_tweets_by_value(drafts, context=context)
