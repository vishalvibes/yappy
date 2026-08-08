"""Shared constants and small normalizers for yaps services."""

from __future__ import annotations

import re

_TABLE = "yaps"
_TEMPLATES_TABLE = "post_templates"
_MAX_AUDIO_BYTES = 8 * 1024 * 1024  # 8 MiB — short yaps
_MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MiB screenshots
_TWEET_COUNT = 10
_TWEET_MAX_TOKENS = 2200
_REWRITE_MAX_TOKENS = 2200
_VISION_MAX_TOKENS = 900
_VIEWPOINT_JUDGE_MAX_TOKENS = 80
_TEMPLATE_EXTRACT_MAX_TOKENS = 500
_TWEET_RANK_MAX_TOKENS = 400
_RELATED_YAP_LIMIT = 10
_RELATED_CANDIDATE_LIMIT = 100
# Related-note gate: need real content overlap, not stopword noise / recency.
_RELATED_MIN_SHARED_TOKENS = 2
_RELATED_MIN_JACCARD = 0.12
_TOKEN_RE = re.compile(r"[a-z0-9']+")
_STOPWORDS = frozenset(
    {
        "a",
        "an",
        "the",
        "and",
        "or",
        "but",
        "if",
        "then",
        "so",
        "to",
        "of",
        "in",
        "on",
        "at",
        "for",
        "from",
        "with",
        "by",
        "as",
        "is",
        "are",
        "was",
        "were",
        "be",
        "been",
        "being",
        "am",
        "i",
        "me",
        "my",
        "mine",
        "we",
        "our",
        "you",
        "your",
        "yours",
        "it",
        "its",
        "this",
        "that",
        "these",
        "those",
        "they",
        "them",
        "their",
        "he",
        "she",
        "his",
        "her",
        "hers",
        "not",
        "no",
        "yes",
        "do",
        "does",
        "did",
        "doing",
        "done",
        "have",
        "has",
        "had",
        "having",
        "will",
        "would",
        "can",
        "could",
        "should",
        "may",
        "might",
        "must",
        "just",
        "like",
        "really",
        "very",
        "also",
        "than",
        "too",
        "into",
        "about",
        "up",
        "out",
        "off",
        "over",
        "under",
        "again",
        "once",
        "here",
        "there",
        "when",
        "where",
        "why",
        "how",
        "what",
        "who",
        "which",
        "all",
        "any",
        "some",
        "more",
        "most",
        "other",
        "own",
        "same",
        "such",
        "only",
        "own",
        "after",
        "before",
        "during",
        "through",
        "because",
        "while",
        "now",
        "still",
        "even",
        "get",
        "got",
        "getting",
        "im",
        "i'm",
        "ive",
        "i've",
        "id",
        "i'd",
        "ill",
        "i'll",
        "dont",
        "don't",
        "didnt",
        "didn't",
        "cant",
        "can't",
        "wont",
        "won't",
        "its",
        "it's",
        "thats",
        "that's",
        "theres",
        "there's",
        "yeah",
        "ok",
        "okay",
        "oh",
        "uh",
        "um",
    }
)
_DIGIT_RE = re.compile(r"\d")
_TRUST_SIGNAL_RE = re.compile(
    r"[$€£%]|"
    r"\b\d+(\.\d+)?\s*(%|k|m|weeks?|days?|months?|years?|hrs?|hours?|mins?)\b|"
    r"(?:^|\n)\s*\d+[.)]\s|"
    r"\b(first|then|once|after|because|if|when)\b",
    re.IGNORECASE | re.MULTILINE,
)
_IMAGE_MIME_OK = frozenset({"image/png", "image/jpeg", "image/jpg", "image/webp"})

# Marker embedded in stored transcripts so /generate can pick reply vs create.
_SCREEN_KIND_SOCIAL = "social_post"
_SCREEN_KIND_OTHER = "other"
_TEMPLATE_CHANNELS = frozenset(
    {
        "twitter",
        "linkedin",
        "threads",
        "bluesky",
        "reddit",
        "instagram",
        "facebook",
        "other",
    }
)
_SCREEN_KIND_RE = re.compile(
    r"^ON SCREEN \[(" + _SCREEN_KIND_SOCIAL + "|" + _SCREEN_KIND_OTHER + r")\]",
    re.MULTILINE,
)

_AGE_LINE_RE = re.compile(
    r"(?m)^\s*\d+\s*yo\s*[-–—:]\s*.+$",
)
_DAY_LINE_RE = re.compile(
    r"(?mi)^\s*(?:[-*•]\s*)?(?:days?\s*)?\d+\s*[-–—]\s*\d+\s*:.+$",
)
_BULLET_LINE_RE = re.compile(r"(?m)^\s*[-*•]\s+\S.+$")
_RANK_CHAIN_RE = re.compile(
    r"\b[\w][\w\s.+-]{0,40}\s*(?:>|→|->)\s*[\w][\w\s.+-]{0,40}"
    r"(?:\s*(?:>|→|->)\s*[\w][\w\s.+-]{0,40})+"
)
_ENGAGEMENT_LIKES_RE = re.compile(
    r"(?i)(\d[\d,]*(?:\.\d+)?\s*[km]?)\s*likes?\b"
)
_ENGAGEMENT_REPLIES_RE = re.compile(
    r"(?i)(\d[\d,]*(?:\.\d+)?\s*[km]?)\s*(?:replies|comments)\b"
)
_ENGAGEMENT_VIEWS_RE = re.compile(
    r"(?i)(\d[\d,]*(?:\.\d+)?\s*[km]?)\s*views?\b"
)
_AGE_RELATIVE_RE = re.compile(
    r"(?i)\b(?:posted\s+)?(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|week|weeks)\s*ago\b"
    r"|\b(\d+(?:\.\d+)?)\s*(m|min|mins|h|hr|hrs|d|w)\b(?=\s*(?:·|,|$))"
)


def _normalize_screen_kind(raw: str | None) -> str:
    if (raw or "").strip().lower() == _SCREEN_KIND_SOCIAL:
        return _SCREEN_KIND_SOCIAL
    return _SCREEN_KIND_OTHER


def _detect_screen_kind(transcript: str) -> str | None:
    """Parse embedded ON SCREEN [kind] marker; None if no screenshot context."""
    match = _SCREEN_KIND_RE.search(transcript or "")
    if not match:
        # Legacy transcripts without [kind] still had ON SCREEN → treat as reply.
        if "ON SCREEN" in (transcript or ""):
            return _SCREEN_KIND_SOCIAL
        return None
    return _normalize_screen_kind(match.group(1))

def _normalize_channel(raw: str | None) -> str | None:
    if not raw:
        return None
    key = str(raw).strip().lower()
    aliases = {
        "x": "twitter",
        "x.com": "twitter",
        "twitter/x": "twitter",
        "x/twitter": "twitter",
    }
    key = aliases.get(key, key)
    return key if key in _TEMPLATE_CHANNELS else "other"
