"""Tokenization, similarity, and related-yap retrieval."""

from __future__ import annotations

from supabase import AClient

from app.services.yaps.constants import (
    _RELATED_CANDIDATE_LIMIT,
    _RELATED_MIN_JACCARD,
    _RELATED_MIN_SHARED_TOKENS,
    _RELATED_YAP_LIMIT,
    _STOPWORDS,
    _TABLE,
    _TOKEN_RE,
)

def _tokenize(text: str) -> set[str]:
    return set(_TOKEN_RE.findall(text.lower()))


def _content_tokens(text: str) -> set[str]:
    """Tokens with stopwords removed — used for related-yap topic gating."""
    return {t for t in _tokenize(text) if t not in _STOPWORDS and len(t) > 1}


def _similarity(a: set[str], b: set[str]) -> float:
    """Jaccard overlap; empty sets score 0."""
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _rank_related_transcripts(
    transcript: str,
    candidates: list[dict],
    *,
    limit: int = _RELATED_YAP_LIMIT,
) -> list[str]:
    """Pick up to `limit` candidate transcripts clearly related to `transcript`.

    Scores content-token Jaccard (stopwords stripped). Requires both a
    minimum shared-token count and Jaccard floor. Returns [] when nothing
    clears the gate — never falls back to "newest unrelated" notes.
    """
    query_tokens = _content_tokens(transcript)
    if not query_tokens:
        return []

    scored: list[tuple[float, int, int, str]] = []
    for idx, row in enumerate(candidates):
        text = (row.get("transcript") or "").strip()
        if not text:
            continue
        cand_tokens = _content_tokens(text)
        if not cand_tokens:
            continue
        shared = len(query_tokens & cand_tokens)
        score = _similarity(query_tokens, cand_tokens)
        if (
            shared < _RELATED_MIN_SHARED_TOKENS
            or score < _RELATED_MIN_JACCARD
        ):
            continue
        # -idx keeps newer first on score ties (candidates are newest-first).
        scored.append((score, shared, -idx, text))

    scored.sort(reverse=True)
    return [text for _, _, _, text in scored[:limit]]


async def _fetch_related_yaps(
    supabase: AClient,
    *,
    user_id: str,
    yap_id: str | None,
    transcript: str,
) -> list[str]:
    """Fetch up to 10 past ready viewpoints related to the current transcript."""
    query = (
        supabase.table(_TABLE)
        .select("id, transcript, created_at")
        .eq("user_id", user_id)
        .eq("status", "ready")
        .not_.is_("transcript", "null")
        .order("created_at", desc=True)
        .limit(_RELATED_CANDIDATE_LIMIT)
    )
    if yap_id:
        query = query.neq("id", yap_id)
    res = await query.execute()
    return _rank_related_transcripts(transcript, res.data or [])
