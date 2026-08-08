"""Memory assembly and generate/rewrite prompt builders."""

from __future__ import annotations

from app.services.yaps.constants import (
    _SCREEN_KIND_OTHER,
    _SCREEN_KIND_SOCIAL,
    _normalize_screen_kind,
)
from app.services.yaps.json_parse import _parse_tweets


def _build_reference(
    *,
    shown: str | None = None,
    screen_kind: str | None = None,
    reference_speech: str | None = None,
) -> str | None:
    """Screen vision + other-speaker audio for the reference column."""
    screen = (shown or "").strip() if shown else ""
    heard = (reference_speech or "").strip() if reference_speech else ""
    kind = _normalize_screen_kind(screen_kind) if screen else None

    parts: list[str] = []
    if screen and kind == _SCREEN_KIND_SOCIAL:
        parts.append(
            f"ON SCREEN [{_SCREEN_KIND_SOCIAL}] (social post — reply target; "
            "silent context; do NOT paraphrase or rediscover this as the tweet):\n"
            f"{screen}"
        )
    elif screen:
        parts.append(
            f"ON SCREEN [{_SCREEN_KIND_OTHER}] (source material — create "
            "standalone posts from this + USER COMMENT; not a reply thread):\n"
            f"{screen}"
        )
    if heard:
        parts.append(
            "AUDIO REFERENCE (other voices — referent only; not the user's "
            "opinion):\n"
            f"{heard}"
        )
    if not parts:
        return None
    return "\n\n".join(parts)


def _combine_memory(
    *,
    user_speech: str,
    shown: str | None = None,
    screen_kind: str | None = None,
    reference_speech: str | None = None,
) -> str:
    """Assemble labeled memory for generation prompts (not for DB storage)."""
    return _build_generate_note(
        viewpoint=(user_speech or "").strip() or None,
        reference=_build_reference(
            shown=shown,
            screen_kind=screen_kind,
            reference_speech=reference_speech,
        ),
    )


def _build_generate_note(
    *,
    viewpoint: str | None,
    reference: str | None,
) -> str:
    """Labeled CURRENT NOTE for tweet generation.

    New rows: plain viewpoint + labeled reference.
    Legacy rows: combined blob in viewpoint with empty reference — pass through.
    """
    user = (viewpoint or "").strip()
    ref = (reference or "").strip()
    if not user and not ref:
        return ""
    if user and not ref and (
        "USER COMMENT" in user or "ON SCREEN" in user or "AUDIO REFERENCE" in user
    ):
        return user

    parts: list[str] = []
    if user:
        if user.startswith("USER COMMENT"):
            parts.append(user)
        else:
            parts.append(
                f"USER COMMENT (the yap — the ONLY opinion to write):\n{user}"
            )
    if ref:
        parts.append(ref)
    return "\n\n".join(parts)


def _format_post_templates_section(templates: list[dict]) -> str:
    """Format stored post templates for create-mode prompts."""
    if not templates:
        return ""
    lines: list[str] = []
    for i, row in enumerate(templates, start=1):
        channel = (row.get("channel") or "other").strip()
        pattern = (row.get("pattern") or "").strip()
        template = (row.get("template") or "").strip()
        if not template:
            continue
        header = f"{i}. [{channel}]"
        if pattern:
            header += f" ({pattern})"
        lines.append(f"{header}\n{template}")
    if not lines:
        return ""
    numbered = "\n\n".join(lines)
    return (
        f"POST TEMPLATES ({len(lines)}) — reusable patterns the user saved "
        f"from posts they engaged with. Use as optional shape/inspiration for "
        f"standalone create-mode drafts — do not copy verbatim; adapt to "
        f"CURRENT NOTE:\n{numbered}"
    )


def _build_generate_prompt(
    transcript: str,
    related: list[str],
    *,
    mode: str = "create",
    post_templates: list[dict] | None = None,
) -> str:
    if mode == "reply":
        lead = (
            "Write reply-style posts under the social post. Primary opinion "
            "is USER COMMENT. PAST-NOTE LIFT only when CURRENT is thin AND a "
            "listed note clearly shares this topic/referent — otherwise "
            "ignore RELATED PAST NOTES entirely (presence ≠ permission). "
            "Never densify with off-topic archive takes. ON SCREEN / AUDIO "
            "REFERENCE are silent context — never paraphrase them, never "
            "'discover' their thesis, never invent a take that isn't in the "
            "yap or an on-topic past note. "
            "ENTITY GROUNDING: if USER COMMENT mangles a name that ON SCREEN "
            "prints clearly (e.g. STT 'clot'/'clod' for 'Claude Code'), use "
            "the ON SCREEN spelling — keep the user's ranking/opinion. "
            "EXCEPTION — FORMAT MIRROR: if ON SCREEN uses a distinctive "
            "template (age timelines, milestone lists, arrow chains) and "
            "USER COMMENT corrects/updates that path, include some drafts "
            "that mirror the scaffold with the user's version — and still "
            "vary other drafts across alternate formats (arrow chain, "
            "conversational, compressed)."
        )
    else:
        lead = (
            "Write ORIGINAL standalone posts (not replies). Use ON SCREEN as "
            "source/inspiration and USER COMMENT as the voice and opinion. "
            "PAST-NOTE LIFT only for clearly on-topic notes when USER COMMENT "
            "is thin — otherwise ignore the related list. Do not write "
            "reply-fragment tone."
        )
    parts = [f"{lead}\n\nCURRENT NOTE:\n{transcript}"]
    if related:
        numbered = "\n\n".join(
            f"{i}. {text}" for i, text in enumerate(related, start=1)
        )
        parts.append(
            f"RELATED PAST NOTES ({len(related)}) — candidates only. "
            f"Use a note ONLY if it clearly matches CURRENT / ON SCREEN "
            f"topic (PAST-NOTE LIFT when CURRENT is thin). If none match, "
            f"behave as RELATED PAST NOTES: none. When CURRENT is rich, "
            f"ignore this list. Do not hijack the topic with an unrelated "
            f"old take:\n{numbered}"
        )
    else:
        parts.append("RELATED PAST NOTES: none")
    if mode == "create" and post_templates:
        section = _format_post_templates_section(post_templates)
        if section:
            parts.append(section)
    return "\n\n".join(parts)


def _parse_tweets_input(raw: str) -> list[str]:
    """Parse client-supplied draft tweets (JSON array string)."""
    return _parse_tweets(raw)


def _build_rewrite_prompt(drafts: list[str], feedback: str) -> str:
    numbered = "\n\n".join(
        f"{i}. {text}" for i, text in enumerate(drafts, start=1)
    )
    return (
        f"CURRENT DRAFTS ({len(drafts)}):\n{numbered}\n\n"
        f"USER FEEDBACK:\n{feedback}"
    )
