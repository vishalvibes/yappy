"""Yaps routes — smoke tests with mocked Sarvam / LLM."""

from __future__ import annotations

import io
import json
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_yap_requires_sarvam_key(
    client: AsyncClient, auth_headers: dict[str, str]
):
    with patch("app.routers.yaps.settings") as s:
        s.SARVAM_API_KEY = ""
        res = await client.post(
            "/yaps",
            headers=auth_headers,
            files={"file": ("yap.webm", io.BytesIO(b"fake"), "audio/webm")},
        )
    assert res.status_code == 503


@pytest.mark.asyncio
async def test_create_yap_empty_audio(
    client: AsyncClient, auth_headers: dict[str, str]
):
    with patch("app.routers.yaps.settings") as s:
        s.SARVAM_API_KEY = "test-key"
        res = await client.post(
            "/yaps",
            headers=auth_headers,
            files={"file": ("yap.webm", io.BytesIO(b""), "audio/webm")},
        )
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_generate_requires_ready_transcript(
    client: AsyncClient, auth_headers: dict[str, str]
):
    fake_yap = {
        "id": "11111111-1111-1111-1111-111111111111",
        "status": "processing",
        "transcript": None,
        "reference": None,
    }
    with patch(
        "app.routers.yaps._fetch_yap",
        new=AsyncMock(return_value=fake_yap),
    ):
        res = await client.post(
            f"/yaps/{fake_yap['id']}/generate",
            headers=auth_headers,
        )
    assert res.status_code == 409


@pytest.mark.asyncio
async def test_generate_returns_tweet_variants(
    client: AsyncClient, auth_headers: dict[str, str]
):
    fake_yap = {
        "id": "11111111-1111-1111-1111-111111111111",
        "status": "ready",
        "transcript": "I quit my job and finally slept.",
        "reference": None,
        "screen_kind": None,
    }
    variants = [
        "quit my job. slept eight hours. never going back.",
        "the bravest thing I did this year was leave.",
        "corporate said loyalty. my body said leave.",
    ]
    related = [
        "I hate corporate loyalty theater.",
        "sleep is the only KPI that matters now.",
    ]
    mock_completion = AsyncMock()
    mock_completion.choices = [
        AsyncMock(message=AsyncMock(content=json.dumps(variants)))
    ]
    mock_llm = AsyncMock(return_value=mock_completion)

    with (
        patch(
            "app.routers.yaps._fetch_yap",
            new=AsyncMock(return_value=fake_yap),
        ),
        patch(
            "app.routers.yaps._fetch_related_yaps",
            new=AsyncMock(return_value=related),
        ),
        patch(
            "app.routers.yaps.create_chat_completion",
            new=mock_llm,
        ),
        patch(
            "app.routers.yaps._rank_tweets",
            new=AsyncMock(side_effect=lambda drafts, **_: list(drafts)),
        ),
    ):
        res = await client.post(
            f"/yaps/{fake_yap['id']}/generate",
            headers=auth_headers,
        )

    assert res.status_code == 200
    body = res.json()
    assert body["id"] == fake_yap["id"]
    assert body["tweets"] == variants

    messages = mock_llm.await_args.kwargs["messages"]
    user_prompt = messages[1]["content"]
    assert "CURRENT NOTE" in user_prompt
    assert fake_yap["transcript"] in user_prompt
    assert "RELATED PAST NOTES (2)" in user_prompt
    assert "ORIGINAL standalone" in user_prompt
    assert related[0] in user_prompt
    assert related[1] in user_prompt
    assert res.json()["mode"] == "create"
    assert res.json()["screen_kind"] is None


@pytest.mark.asyncio
async def test_generate_from_body_without_yap_id(
    client: AsyncClient, auth_headers: dict[str, str]
):
    variants = ["this chart is wild.", "numbers don't sleep."]
    mock_completion = AsyncMock()
    mock_completion.choices = [
        AsyncMock(message=AsyncMock(content=json.dumps(variants)))
    ]
    mock_llm = AsyncMock(return_value=mock_completion)

    with (
        patch(
            "app.routers.yaps._fetch_related_yaps",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "app.routers.yaps.create_chat_completion",
            new=mock_llm,
        ),
    ):
        res = await client.post(
            "/yaps/generate",
            headers=auth_headers,
            json={
                "transcript": "this chart is insane",
                "reference": (
                    "ON SCREEN [other] (source material):\n"
                    "A revenue dashboard trending up."
                ),
                "screen_kind": "other",
            },
        )

    assert res.status_code == 200
    body = res.json()
    assert body["id"] is None
    assert body["mode"] == "create"
    assert body["screen_kind"] == "other"
    user_prompt = mock_llm.await_args.kwargs["messages"][1]["content"]
    assert "this chart is insane" in user_prompt
    assert "revenue dashboard" in user_prompt
    assert "USER COMMENT" in user_prompt
    assert "ON SCREEN [other]" in user_prompt


@pytest.mark.asyncio
async def test_generate_legacy_combined_transcript(
    client: AsyncClient, auth_headers: dict[str, str]
):
    """Old rows: combined blob in transcript, null reference/screen_kind."""
    fake_yap = {
        "id": "11111111-1111-1111-1111-111111111111",
        "status": "ready",
        "transcript": (
            "USER COMMENT (the yap — the ONLY opinion to write):\noof\n\n"
            "ON SCREEN [social_post] (social post — reply target):\n"
            "A tweet claiming sleep is optional."
        ),
        "reference": None,
        "screen_kind": None,
    }
    variants = ["oof."]
    mock_completion = AsyncMock()
    mock_completion.choices = [
        AsyncMock(message=AsyncMock(content=json.dumps(variants)))
    ]

    with (
        patch(
            "app.routers.yaps._fetch_yap",
            new=AsyncMock(return_value=fake_yap),
        ),
        patch(
            "app.routers.yaps._fetch_related_yaps",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "app.routers.yaps.create_chat_completion",
            new=AsyncMock(return_value=mock_completion),
        ),
    ):
        res = await client.post(
            "/yaps/generate",
            headers=auth_headers,
            json={"yap_id": fake_yap["id"]},
        )

    assert res.status_code == 200
    body = res.json()
    assert body["mode"] == "reply"
    assert body["screen_kind"] == "social_post"

def test_parse_tweets_strips_fences_and_empties():
    from app.routers.yaps import _parse_tweets

    raw = '```json\n["one", "", "two", 3]\n```'
    assert _parse_tweets(raw) == ["one", "two"]


def test_parse_tweets_preserves_internal_newlines():
    from app.routers.yaps import _parse_tweets

    raw = '["two unknowns:\\n1. product\\n2. pricing\\n\\nmake it free."]'
    parsed = _parse_tweets(raw)
    assert len(parsed) == 1
    assert "\n" in parsed[0]
    assert "1. product" in parsed[0]
    assert "make it free." in parsed[0]


def test_sort_tweets_by_value_prefers_relevance_over_length():
    from app.routers.yaps import _sort_tweets_by_value

    context = (
        "USER COMMENT:\nI quit my job and finally slept eight hours\n\n"
        "ON SCREEN [social_post]:\nA tweet about hustle culture and grinding 24/7."
    )
    relevant = "I quit. Slept eight hours. Never going back to that grind."
    long_offtopic = (
        "The macroeconomic outlook for Q3 involves several interlocking "
        "factors including rate paths, labor participation, and commodity "
        "volatility that investors should carefully monitor this quarter."
    )
    paraphrase = (
        "Hustle culture says grind 24/7 and never stop working hard every day."
    )
    clone_a = "quit job. slept. done."
    clone_b = "quit job. slept. finished."

    ordered = _sort_tweets_by_value(
        [long_offtopic, paraphrase, relevant, clone_a, clone_b],
        context=context,
    )
    assert ordered[0] == relevant
    assert ordered.index(relevant) < ordered.index(long_offtopic)
    assert ordered.index(relevant) < ordered.index(paraphrase)


def test_parse_rank_order_accepts_indices_and_scored_objects():
    from app.routers.yaps import _parse_rank_order

    assert _parse_rank_order("[2,0,1]", 3) == [2, 0, 1]
    assert _parse_rank_order("[0,1]", 3) is None
    scored = _parse_rank_order(
        '[{"index":1,"score":9},{"index":0,"score":3},{"index":2,"score":1}]',
        3,
    )
    assert scored == [1, 0, 2]


@pytest.mark.asyncio
async def test_rank_tweets_default_skips_llm():
    """YAPS_LLM_RANK off → heuristic only (no LLM RTT)."""
    from app.routers.yaps import _rank_tweets, _sort_tweets_by_value

    drafts = [
        "macroeconomic outlook for Q3 involves interlocking factors.",
        "I quit my job and finally slept.",
    ]
    context = "USER COMMENT:\nI quit my job and finally slept."
    llm = AsyncMock(return_value=["a"])

    with (
        patch("app.routers.yaps.settings") as s,
        patch("app.routers.yaps._llm_rank_tweets", new=llm),
    ):
        s.YAPS_LLM_RANK = False
        s.OPENAI_ENABLED = True
        s.OPENAI_API_KEY = "sk-test"
        ordered = await _rank_tweets(drafts, context=context, mode="reply")

    assert ordered == _sort_tweets_by_value(drafts, context=context)
    llm.assert_not_awaited()


@pytest.mark.asyncio
async def test_rank_tweets_fail_open_uses_heuristic():
    from app.routers.yaps import _rank_tweets, _sort_tweets_by_value

    drafts = [
        "macroeconomic outlook for Q3 involves interlocking factors.",
        "I quit my job and finally slept.",
    ]
    context = "USER COMMENT:\nI quit my job and finally slept."

    with (
        patch("app.routers.yaps.settings") as s,
        patch(
            "app.routers.yaps._llm_rank_tweets",
            new=AsyncMock(side_effect=RuntimeError("down")),
        ),
    ):
        s.YAPS_LLM_RANK = True
        s.OPENAI_ENABLED = True
        s.OPENAI_API_KEY = "sk-test"
        ordered = await _rank_tweets(drafts, context=context, mode="reply")

    assert ordered == _sort_tweets_by_value(drafts, context=context)
    assert ordered[0] == drafts[1]


@pytest.mark.asyncio
async def test_rank_tweets_uses_llm_order_when_valid():
    from app.routers.yaps import _rank_tweets

    drafts = ["a", "b", "c"]
    with (
        patch("app.routers.yaps.settings") as s,
        patch(
            "app.routers.yaps._llm_rank_tweets",
            new=AsyncMock(return_value=["c", "a", "b"]),
        ),
    ):
        s.YAPS_LLM_RANK = True
        s.OPENAI_ENABLED = True
        s.OPENAI_API_KEY = "sk-test"
        ordered = await _rank_tweets(drafts, context="x", mode="create")
    assert ordered == ["c", "a", "b"]


def test_tweet_prompts_include_density_rubric():
    from app.routers.yaps import (
        _CREATE_CONTENT_SYSTEM,
        _REPLY_TWEET_SYSTEM,
        _REWRITE_TWEET_SYSTEM,
        _TEMPLATE_EXTRACT_SYSTEM,
        _TWEET_DENSITY_RUBRIC,
        _VISION_SYSTEM,
        _build_reply_tweet_system,
        _tweet_voice_block,
    )

    assert "TIER C — TACTICAL" in _TWEET_DENSITY_RUBRIC
    assert "TRUST ASSET HIERARCHY" in _TWEET_DENSITY_RUBRIC
    assert "DISTINCTIVE VOCAB" in _TWEET_DENSITY_RUBRIC
    assert "VOCABULARY LOCK" in _TWEET_DENSITY_RUBRIC
    assert "insane" in _TWEET_DENSITY_RUBRIC
    assert "MULTILINE" in _TWEET_DENSITY_RUBRIC
    assert "PAST-NOTE LIFT" in _TWEET_DENSITY_RUBRIC
    assert "ten synonym twins" in _TWEET_DENSITY_RUBRIC
    assert "PRESERVE that scaffold" in _VISION_SYSTEM
    assert "age/year timelines" in _VISION_SYSTEM
    assert '"channel"' in _VISION_SYSTEM
    assert "likes" in _VISION_SYSTEM
    assert "has_image" in _VISION_SYSTEM
    assert "age_hours" in _VISION_SYSTEM
    assert "TIME MATTERS" in _VISION_SYSTEM
    assert "VIRAL" in _TEMPLATE_EXTRACT_SYSTEM or "viral" in _TEMPLATE_EXTRACT_SYSTEM
    assert "comments-to-likes" in _TEMPLATE_EXTRACT_SYSTEM
    assert "IMAGE:" in _TEMPLATE_EXTRACT_SYSTEM
    assert "SHORT" in _TEMPLATE_EXTRACT_SYSTEM
    assert "USER INTEREST" in _TEMPLATE_EXTRACT_SYSTEM
    assert "TIME-ADJUSTED" in _TEMPLATE_EXTRACT_SYSTEM
    assert "likes-per-hour" in _TEMPLATE_EXTRACT_SYSTEM
    assert "VIEW CONVERSION" in _TEMPLATE_EXTRACT_SYSTEM
    assert "likes/views" in _TEMPLATE_EXTRACT_SYSTEM
    assert "replies/views" in _TEMPLATE_EXTRACT_SYSTEM
    for prompt in (
        _REPLY_TWEET_SYSTEM,
        _CREATE_CONTENT_SYSTEM,
        _REWRITE_TWEET_SYSTEM,
    ):
        assert "TIER C — TACTICAL" in prompt
        assert "TRUST ASSET HIERARCHY" in prompt
        assert "VOCABULARY LOCK" in prompt
        assert "NEVER invent" in prompt or "never invent" in prompt.lower()
        assert "VOICE / FORMATTING — formal" in prompt
        assert "all-lowercase" in prompt
        assert "PAST-NOTE LIFT" in prompt

    assert "REPLY = CONVERSATION" in _REPLY_TWEET_SYSTEM
    assert "The real question is" in _REPLY_TWEET_SYSTEM
    assert "NO FILLER OPENERS" in _REPLY_TWEET_SYSTEM
    assert "FORMAT MIRROR (one shape in a mixed set)" in _REPLY_TWEET_SYSTEM
    assert "Age / year timelines" in _REPLY_TWEET_SYSTEM
    assert "alternate structures" in _REPLY_TWEET_SYSTEM
    assert "Never let the whole set collapse into one genre" in _REPLY_TWEET_SYSTEM
    assert "LEAD-IN + list" in _REPLY_TWEET_SYSTEM
    assert "Near-duplicates FAIL" in _REPLY_TWEET_SYSTEM
    assert "sibling jargon" in _REPLY_TWEET_SYSTEM
    assert "ENTITY GROUNDING" in _REPLY_TWEET_SYSTEM
    assert "Claude Code" in _REPLY_TWEET_SYSTEM
    assert "clot" in _REPLY_TWEET_SYSTEM.lower()
    assert "RELATED PAST NOTES — optional + gated" in _REPLY_TWEET_SYSTEM
    assert "listed in the prompt" in _REPLY_TWEET_SYSTEM
    assert "HARD GATE" in _TWEET_DENSITY_RUBRIC
    assert "Presence in the prompt ≠ permission" in _TWEET_DENSITY_RUBRIC or (
        "presence in the prompt is NOT permission" in _TWEET_DENSITY_RUBRIC
    )
    assert "FORMAT MIRROR:" in _REWRITE_TWEET_SYSTEM
    assert "ENTITY GROUNDING" in _REWRITE_TWEET_SYSTEM
    assert "VOCABULARY LOCK" in _REWRITE_TWEET_SYSTEM
    assert 'plant "insane"' in _REWRITE_TWEET_SYSTEM
    assert "ENTITY GROUNDING" in _CREATE_CONTENT_SYSTEM
    assert "REPLY = CONVERSATION" not in _CREATE_CONTENT_SYSTEM
    assert "FORMAT MIRROR (one shape" not in _CREATE_CONTENT_SYSTEM
    assert "FORMAT MIRROR (overrides" not in _CREATE_CONTENT_SYSTEM
    assert "sibling jargon" in _TWEET_DENSITY_RUBRIC
    assert "paragraph break" in _TWEET_DENSITY_RUBRIC.lower() or "PARAGRAPH" in _TWEET_DENSITY_RUBRIC
    assert "FORBIDDEN (tight line-stack" in _TWEET_DENSITY_RUBRIC
    assert "ORDER (generation)" in _TWEET_DENSITY_RUBRIC
    assert "densest → lightest" not in _TWEET_DENSITY_RUBRIC
    from app.routers.yaps import _TWEET_RANK_SYSTEM

    assert "RELEVANCE" in _TWEET_RANK_SYSTEM
    assert "ORIGINALITY" in _TWEET_RANK_SYSTEM
    assert "VALUE-ADD" in _TWEET_RANK_SYSTEM
    assert "ANTI-CLONE" in _TWEET_RANK_SYSTEM

    casual = _tweet_voice_block("casual")
    assert "VOICE / FORMATTING — casual" in casual
    assert "Lowercase and fragments OK" in casual
    assert "Lowercase and fragments OK" in _build_reply_tweet_system("casual")
    assert "FORMAT MIRROR scaffold" in casual
    assert "FORMAT MIRROR scaffold" in _tweet_voice_block("formal")


def test_build_generate_prompt_reply_mentions_format_mirror():
    from app.routers.yaps import _build_generate_prompt

    reply = _build_generate_prompt("hello world", [], mode="reply")
    assert "FORMAT MIRROR" in reply
    assert "ENTITY GROUNDING" in reply
    assert "PAST-NOTE LIFT" in reply
    assert "age timelines" in reply.lower() or "milestone" in reply.lower()
    create = _build_generate_prompt("hello world", [], mode="create")
    assert "FORMAT MIRROR" not in create
    assert "ENTITY GROUNDING" not in create
    assert "PAST-NOTE LIFT" in create


def test_build_generate_prompt_related_notes_are_gated():
    from app.routers.yaps import _build_generate_prompt

    prompt = _build_generate_prompt(
        "that's dark",
        ["doomscrolling trains a dopamine loop I keep quitting"],
        mode="reply",
    )
    assert "PAST-NOTE LIFT" in prompt
    assert "candidates only" in prompt
    assert "presence ≠ permission" in prompt
    assert "opinion fuel" not in prompt
    assert "voice/worldview" not in prompt
    assert "doomscrolling trains a dopamine loop" in prompt


def test_rank_related_transcripts_prefers_overlap():
    from app.routers.yaps import _rank_related_transcripts

    current = "I quit my job and finally slept eight hours"
    candidates = [
        {"transcript": "grocery list: milk eggs bread"},
        {
            "transcript": (
                "I quit my job last year and slept eight hours every night"
            )
        },
        {"transcript": "after I quit work, I slept better within weeks"},
        {"transcript": "building a voice bot for content creation"},
        {"transcript": ""},
    ]
    ranked = _rank_related_transcripts(current, candidates, limit=2)
    assert len(ranked) == 2
    assert all("grocery" not in t for t in ranked)
    assert all("voice bot" not in t for t in ranked)
    assert any("quit" in t and "slept" in t for t in ranked)


def test_rank_related_transcripts_returns_empty_when_nothing_matches():
    from app.routers.yaps import _rank_related_transcripts

    ranked = _rank_related_transcripts(
        "voice bot results are insane",
        [
            {"transcript": "grocery list: milk eggs bread"},
            {"transcript": "I quit corporate and finally slept eight hours"},
            {"transcript": "the JEE to YC career ladder is cosplay"},
        ],
        limit=5,
    )
    assert ranked == []


def test_rank_related_transcripts_ignores_weak_single_token_overlap():
    from app.routers.yaps import _rank_related_transcripts

    # Only shared content token is "bot" — below the 2-token gate.
    ranked = _rank_related_transcripts(
        "this voice bot is insane",
        [{"transcript": "I shipped a chat bot last summer"}],
        limit=5,
    )
    assert ranked == []


def test_build_generate_prompt_handles_empty_related():
    from app.routers.yaps import _build_generate_prompt

    prompt = _build_generate_prompt("hello world", [])
    assert "CURRENT NOTE" in prompt
    assert "hello world" in prompt
    assert "RELATED PAST NOTES: none" in prompt


def test_split_user_and_reference_last_speaker_is_user():
    from app.clients.sarvam import DiarizedSegment, _split_user_and_reference

    segments = [
        DiarizedSegment("0", "Welcome back to the show."),
        DiarizedSegment("1", "This take is nonsense."),
        DiarizedSegment("0", "More host chatter."),
    ]
    user, ref = _split_user_and_reference(segments, "full")
    assert user == "This take is nonsense."
    assert ref == "Welcome back to the show. More host chatter."

    alone = [DiarizedSegment("0", "Just me talking.")]
    user2, ref2 = _split_user_and_reference(alone, "Just me talking.")
    assert user2 == "Just me talking."
    assert ref2 is None


def test_build_rewrite_prompt_includes_drafts_and_feedback():
    from app.routers.yaps import _build_rewrite_prompt

    prompt = _build_rewrite_prompt(
        ["draft one", "draft two"],
        "make them shorter and angrier",
    )
    assert "CURRENT DRAFTS (2):" in prompt
    assert "draft one" in prompt
    assert "draft two" in prompt
    assert "USER FEEDBACK:" in prompt
    assert "make them shorter and angrier" in prompt


@pytest.mark.asyncio
async def test_rewrite_tweets_returns_rewritten_variants(
    client: AsyncClient, auth_headers: dict[str, str]
):
    drafts = [
        "quit my job. slept eight hours.",
        "corporate said loyalty. my body said leave.",
    ]
    rewritten = [
        "left. slept. never apologizing.",
        "loyalty was a trap. sleep was the exit.",
        "I quit. that was the whole plan.",
    ]
    mock_completion = AsyncMock()
    mock_completion.choices = [
        AsyncMock(message=AsyncMock(content=json.dumps(rewritten)))
    ]
    mock_llm = AsyncMock(return_value=mock_completion)

    with (
        patch("app.routers.yaps.settings") as s,
        patch(
            "app.routers.yaps.transcribe_audio",
            new=AsyncMock(
                return_value=__import__(
                    "app.clients.sarvam", fromlist=["TranscriptionResult"]
                ).TranscriptionResult(
                    transcript="make them shorter and angrier",
                    language_code="en-IN",
                    user_speech="make them shorter and angrier",
                    reference_speech=None,
                )
            ),
        ),
        patch(
            "app.routers.yaps.create_chat_completion",
            new=mock_llm,
        ),
        patch(
            "app.routers.yaps._rank_tweets",
            new=AsyncMock(side_effect=lambda drafts, **_: list(drafts)),
        ),
    ):
        s.SARVAM_API_KEY = "test-key"
        s.OPENAI_ENABLED = True
        s.OPENAI_API_KEY = "sk-test"
        res = await client.post(
            "/yaps/rewrite-tweets",
            headers=auth_headers,
            data={"tweets": json.dumps(drafts)},
            files={"file": ("feedback.webm", io.BytesIO(b"audio"), "audio/webm")},
        )

    assert res.status_code == 200
    body = res.json()
    assert body["tweets"] == rewritten
    assert body["feedback"] == "make them shorter and angrier"

    messages = mock_llm.await_args.kwargs["messages"]
    assert "rewrite" in messages[0]["content"].lower() or "USER FEEDBACK" in messages[
        1
    ]["content"]
    user_prompt = messages[1]["content"]
    assert "CURRENT DRAFTS" in user_prompt
    assert drafts[0] in user_prompt
    assert "make them shorter and angrier" in user_prompt


@pytest.mark.asyncio
async def test_rewrite_tweets_rejects_empty_drafts(
    client: AsyncClient, auth_headers: dict[str, str]
):
    with patch("app.routers.yaps.settings") as s:
        s.SARVAM_API_KEY = "test-key"
        s.OPENAI_ENABLED = True
        s.OPENAI_API_KEY = "sk-test"
        res = await client.post(
            "/yaps/rewrite-tweets",
            headers=auth_headers,
            data={"tweets": "[]"},
            files={"file": ("feedback.webm", io.BytesIO(b"audio"), "audio/webm")},
        )
    assert res.status_code == 400


def test_combine_memory_joins_shown_and_spoken():
    from app.routers.yaps import _build_reference, _combine_memory

    assert (
        _combine_memory(user_speech="hi")
        == "USER COMMENT (the yap — the ONLY opinion to write):\nhi"
    )
    assert "ON SCREEN [other]" in _combine_memory(
        user_speech="  ", shown="a chart", screen_kind="other"
    )
    joined = _combine_memory(
        user_speech="this is wild",
        shown="a news headline",
        screen_kind="other",
        reference_speech="breaking news continues",
    )
    # USER COMMENT must lead so generation attends to opinion first.
    assert joined.startswith("USER COMMENT")
    assert "ON SCREEN [other]" in joined and "a news headline" in joined
    assert "AUDIO REFERENCE" in joined and "breaking news continues" in joined
    assert "this is wild" in joined

    social = _combine_memory(
        user_speech="oof",
        shown="a tweet about sleep",
        screen_kind="social_post",
    )
    assert "ON SCREEN [social_post]" in social
    assert "reply target" in social

    ref_only = _build_reference(
        shown="a chart",
        screen_kind="other",
        reference_speech="host chatter",
    )
    assert ref_only is not None
    assert not ref_only.startswith("USER COMMENT")
    assert "ON SCREEN [other]" in ref_only
    assert "AUDIO REFERENCE" in ref_only


def test_detect_screen_kind_from_transcript():
    from app.routers.yaps import _detect_screen_kind

    assert _detect_screen_kind("USER COMMENT:\nhi") is None
    assert (
        _detect_screen_kind("ON SCREEN [social_post] (x):\na tweet")
        == "social_post"
    )
    assert _detect_screen_kind("ON SCREEN [other] (x):\na chart") == "other"
    # Legacy unlabeled ON SCREEN → treat as social (reply).
    assert _detect_screen_kind("ON SCREEN (referent):\nold") == "social_post"


def test_parse_image_insight_json_and_prose_fallback():
    from app.routers.yaps import _parse_image_insight

    parsed = _parse_image_insight(
        json.dumps(
            {
                "kind": "social_post",
                "channel": "twitter",
                "description": "A tweet about AI.",
                "likes": 46,
                "replies": 3,
                "reposts": 7,
                "views": "1.6K",
                "has_image": True,
                "image_detail": "Meme of a crying frog",
            }
        )
    )
    assert parsed.kind == "social_post"
    assert parsed.channel == "twitter"
    assert parsed.description == "A tweet about AI."
    assert parsed.likes == 46
    assert parsed.replies == 3
    assert parsed.views == 1600
    assert parsed.has_image is True
    assert "frog" in (parsed.image_detail or "")

    prose = _parse_image_insight("Just a dashboard with charts.")
    assert prose.kind == "other"
    assert prose.channel is None
    assert "dashboard" in prose.description


def test_heuristic_post_template_detects_scaffolds():
    from app.routers.yaps import ImageInsight, _heuristic_post_template

    ranking = _heuristic_post_template(
        "unpopular opinion:\n\nCodex > Cursor > Claude Code",
        channel_hint="twitter",
    )
    assert ranking is not None
    assert ranking.channel == "twitter"
    assert ranking.pattern == "hot_take_ranking"
    assert "INTENT:" in ranking.template

    days = _heuristic_post_template(
        "How to clear FAANG in 120 days:\n"
        "- Days 1-20: Learn 1 core topic\n"
        "- Days 21-60: Deep dives\n"
        "- Days 61-100: advanced problems\n"
        "- Take 2 mock interviews every week\n"
        "- Track progress daily",
        channel_hint="twitter",
    )
    assert days is not None
    assert days.pattern in ("day_plan", "bullet_list")

    ages = _heuristic_post_template(
        "18yo - IIT\n19yo - DSA\n22yo - Quant\n24yo - YC\n26yo - O-1"
    )
    assert ages is not None
    assert ages.pattern == "age_timeline"

    viral = _heuristic_post_template(
        "salespeople need to stop putting engineer in their titles. "
        "It shows 28 replies, 31 likes, and 2.5K views.",
        channel_hint="twitter",
        insight=ImageInsight(
            kind="social_post",
            description="x",
            likes=31,
            replies=28,
            views=2500,
        ),
    )
    assert viral is not None
    assert viral.pattern == "viral_short"
    assert viral.likes == 31
    assert viral.replies == 28

    with_image = _heuristic_post_template(
        "Codex > Cursor > Claude Code",
        insight=ImageInsight(
            kind="social_post",
            description="x",
            has_image=True,
            image_detail="Screenshot of IDE rankings",
        ),
    )
    assert with_image is not None
    assert "IMAGE:" in with_image.template
    assert "IDE" in (with_image.image_detail or "")

    assert (
        _heuristic_post_template(
            "That's dark, bro.",
            insight=ImageInsight(
                kind="social_post", description="x", likes=2, replies=0
            ),
        )
        is None
    )


def test_parse_template_extract_stores_generic_scaffold():
    from app.routers.yaps import _parse_template_extract

    stored = _parse_template_extract(
        json.dumps(
            {
                "store": True,
                "channel": "twitter",
                "pattern": "hot_take_ranking",
                "template": "INTENT: tool ranking\nSHAPE: {a} > {b} > {c}",
                "likes": 13,
                "replies": 10,
                "has_image": True,
                "image_detail": "none visible but flagged",
            }
        ),
        channel_hint="twitter",
    )
    assert stored is not None
    assert stored.channel == "twitter"
    assert stored.pattern == "hot_take_ranking"
    assert stored.likes == 13
    assert stored.replies == 10
    assert stored.has_image is True
    assert "IMAGE:" in stored.template

    skipped = _parse_template_extract('{"store":false,"reason":"prose only"}')
    assert skipped is None

    x_alias = _parse_template_extract(
        '{"store":true,"channel":"x","pattern":"dark_one_liner","template":"INTENT: dark one-liner"}'
    )
    assert x_alias is not None
    assert x_alias.channel == "twitter"


def test_is_viral_engagement_ratio():
    from app.routers.yaps import _is_viral_engagement

    assert _is_viral_engagement(likes=100, replies=2, views=None) is True
    assert _is_viral_engagement(likes=31, replies=28, views=2500) is True
    assert _is_viral_engagement(likes=5, replies=0, views=100) is False
    # Fresh modest heat beats absolute bar.
    assert (
        _is_viral_engagement(likes=18, replies=2, views=600, age_hours=2.0) is True
    )
    # Old + weak conversion (vanity reach) — not enough.
    assert (
        _is_viral_engagement(likes=18, replies=2, views=20_000, age_hours=720.0)
        is False
    )
    # Small reach, strong like-rate (small account quality signal).
    assert (
        _is_viral_engagement(likes=40, replies=3, views=1200, age_hours=48.0)
        is True
    )
    # Huge reach, weak conversion — needs absolute bars / age path.
    assert (
        _is_viral_engagement(likes=40, replies=2, views=80_000, age_hours=48.0)
        is False
    )


def test_parse_age_hours_from_text():
    from app.routers.yaps import _parse_age_hours_from_text

    assert _parse_age_hours_from_text("posted 3h ago") == 3.0
    assert _parse_age_hours_from_text("posted 23h ago") == 23.0
    assert _parse_age_hours_from_text("2d ago") == 48.0
    assert _parse_age_hours_from_text("just now") == 0.1


def test_heuristic_user_interest_when_engaged():
    from app.routers.yaps import _heuristic_post_template

    draft = _heuristic_post_template(
        "An X post saying salespeople need to stop putting engineer in their titles.",
        channel_hint="twitter",
        user_engaged=True,
    )
    assert draft is not None
    assert draft.pattern == "user_interest"
    assert "INTENT:" in draft.template


def test_normalize_channel_aliases():
    from app.routers.yaps import _normalize_channel

    assert _normalize_channel("twitter") == "twitter"
    assert _normalize_channel("X") == "twitter"
    assert _normalize_channel("linkedin") == "linkedin"
    assert _normalize_channel("myspace") == "other"
    assert _normalize_channel(None) is None


@pytest.mark.asyncio
async def test_maybe_store_post_template_inserts_row():
    from app.routers.yaps import _maybe_store_post_template

    inserted: list[tuple[str, dict]] = []

    class _Result:
        data: list = []

    class _Query:
        def __init__(self, name: str):
            self.name = name

        def insert(self, payload: dict):
            inserted.append((self.name, payload))
            return self

        async def execute(self):
            return _Result()

    class _Fake:
        def table(self, name: str):
            return _Query(name)

    with (
        patch("app.routers.yaps.settings") as s,
        patch(
            "app.routers.yaps._extract_post_template",
            new=AsyncMock(
                return_value=__import__(
                    "app.routers.yaps", fromlist=["PostTemplateDraft"]
                ).PostTemplateDraft(
                    channel="twitter",
                    pattern="hot_take_ranking",
                    template="INTENT: tool ranking\nSHAPE: {a} > {b} > {c}",
                    likes=13,
                    replies=10,
                )
            ),
        ),
    ):
        s.OPENAI_ENABLED = True
        s.OPENAI_API_KEY = "sk-test"
        await _maybe_store_post_template(
            _Fake(),  # type: ignore[arg-type]
            user_id="11111111-1111-1111-1111-111111111111",
            description="Codex > Cursor > Claude Code",
            channel_hint="twitter",
        )

    assert len(inserted) == 1
    table, payload = inserted[0]
    assert table == "post_templates"
    assert payload["channel"] == "twitter"
    assert payload["pattern"] == "hot_take_ranking"
    assert "INTENT:" in payload["template"]
    assert payload["likes"] == 13
    assert payload["replies"] == 10
    assert payload["lifecycle"] == "active"
    assert payload["user_id"] == "11111111-1111-1111-1111-111111111111"


def test_build_generate_prompt_prioritizes_user_opinion():
    from app.routers.yaps import _build_generate_prompt

    reply = _build_generate_prompt("hello world", [], mode="reply")
    assert "reply-style" in reply
    assert "hello world" in reply
    assert "RELATED PAST NOTES: none" in reply

    create = _build_generate_prompt("hello world", [], mode="create")
    assert "ORIGINAL standalone" in create
    assert "hello world" in create


def test_build_generate_prompt_includes_post_templates_in_create_mode():
    from app.routers.yaps import _build_generate_prompt

    templates = [
        {
            "channel": "twitter",
            "pattern": "hot_take_ranking",
            "template": "INTENT: rank tools\nPATTERN: A > B > C",
        }
    ]
    create = _build_generate_prompt(
        "build in public",
        [],
        mode="create",
        post_templates=templates,
    )
    assert "POST TEMPLATES" in create
    assert "hot_take_ranking" in create
    assert "A > B > C" in create

    reply = _build_generate_prompt(
        "build in public",
        [],
        mode="reply",
        post_templates=templates,
    )
    assert "POST TEMPLATES" not in reply


def test_parse_store_flag_defaults_to_keep():
    from app.routers.yaps import _parse_store_flag

    assert _parse_store_flag('{"store":false,"reason":"command"}') is False
    assert _parse_store_flag('{"store":true,"reason":"take"}') is True
    assert _parse_store_flag("not json") is True
    assert _parse_store_flag("{}") is True


@pytest.mark.asyncio
async def test_judge_viewpoint_empty_skips_and_fail_open():
    from app.routers.yaps import _judge_viewpoint

    assert await _judge_viewpoint("   ") is False

    with patch("app.routers.yaps.settings") as s:
        s.OPENAI_ENABLED = False
        s.OPENAI_API_KEY = ""
        assert await _judge_viewpoint("anything") is True

    with (
        patch("app.routers.yaps.settings") as s,
        patch(
            "app.routers.yaps.create_chat_completion",
            new=AsyncMock(side_effect=RuntimeError("down")),
        ),
    ):
        s.OPENAI_ENABLED = True
        s.OPENAI_API_KEY = "sk-test"
        assert await _judge_viewpoint("a real take") is True


@pytest.mark.asyncio
async def test_generate_uses_reply_prompt_for_social_screen(
    client: AsyncClient, auth_headers: dict[str, str]
):
    fake_yap = {
        "id": "11111111-1111-1111-1111-111111111111",
        "status": "ready",
        "transcript": "oof",
        "reference": (
            "ON SCREEN [social_post] (social post — reply target):\n"
            "A tweet claiming sleep is optional."
        ),
        "screen_kind": "social_post",
    }
    variants = ["oof.", "sleep is not optional."]
    mock_completion = AsyncMock()
    mock_completion.choices = [
        AsyncMock(message=AsyncMock(content=json.dumps(variants)))
    ]
    mock_llm = AsyncMock(return_value=mock_completion)

    with (
        patch(
            "app.routers.yaps._fetch_yap",
            new=AsyncMock(return_value=fake_yap),
        ),
        patch(
            "app.routers.yaps._fetch_related_yaps",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "app.routers.yaps.create_chat_completion",
            new=mock_llm,
        ),
        patch(
            "app.routers.yaps._rank_tweets",
            new=AsyncMock(side_effect=lambda drafts, **_: list(drafts)),
        ),
    ):
        res = await client.post(
            f"/yaps/{fake_yap['id']}/generate",
            headers=auth_headers,
        )

    assert res.status_code == 200
    body = res.json()
    assert body["mode"] == "reply"
    assert body["screen_kind"] == "social_post"
    assert body["tweets"] == variants
    system = mock_llm.await_args.kwargs["messages"][0]["content"]
    assert "reply-style" in system.lower() or "reply" in system.lower()
    user_prompt = mock_llm.await_args.kwargs["messages"][1]["content"]
    assert "USER COMMENT" in user_prompt
    assert "oof" in user_prompt
    assert "ON SCREEN [social_post]" in user_prompt


@pytest.mark.asyncio
async def test_generate_uses_create_prompt_for_other_screen(
    client: AsyncClient, auth_headers: dict[str, str]
):
    fake_yap = {
        "id": "11111111-1111-1111-1111-111111111111",
        "status": "ready",
        "transcript": "this chart is insane",
        "reference": (
            "ON SCREEN [other] (source material):\n"
            "A revenue dashboard trending up."
        ),
        "screen_kind": "other",
    }
    variants = ["revenue up. sleep down.", "the chart does not care about my weekends."]
    mock_completion = AsyncMock()
    mock_completion.choices = [
        AsyncMock(message=AsyncMock(content=json.dumps(variants)))
    ]
    mock_llm = AsyncMock(return_value=mock_completion)

    with (
        patch(
            "app.routers.yaps._fetch_yap",
            new=AsyncMock(return_value=fake_yap),
        ),
        patch(
            "app.routers.yaps._fetch_related_yaps",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "app.routers.yaps.create_chat_completion",
            new=mock_llm,
        ),
    ):
        res = await client.post(
            f"/yaps/{fake_yap['id']}/generate",
            headers=auth_headers,
        )

    assert res.status_code == 200
    body = res.json()
    assert body["mode"] == "create"
    assert body["screen_kind"] == "other"
    system = mock_llm.await_args.kwargs["messages"][0]["content"]
    assert "ORIGINAL" in system or "standalone" in system.lower()
    user_prompt = mock_llm.await_args.kwargs["messages"][1]["content"]
    assert "ORIGINAL standalone" in user_prompt


@pytest.mark.asyncio
async def test_create_yap_with_image_describes_and_stores(
    client: AsyncClient, auth_headers: dict[str, str]
):
    from app.clients.supabase import get_supabase_client
    from app.main import app
    from app.routers.yaps import ImageInsight

    inserted: list[dict] = []

    class _Result:
        def __init__(self, data):
            self.data = data

    class _Query:
        def insert(self, payload: dict):
            self._payload = payload
            return self

        async def execute(self):
            row = {
                "id": "yap-img-1",
                "status": "ready",
                **self._payload,
            }
            inserted.append(row)
            return _Result([row])

    class _Fake:
        def table(self, _name: str):
            return _Query()

    app.dependency_overrides[get_supabase_client] = lambda: _Fake()

    with (
        patch("app.routers.yaps.settings") as s,
        patch(
            "app.routers.yaps.transcribe_audio",
            new=AsyncMock(
                return_value=__import__(
                    "app.clients.sarvam", fromlist=["TranscriptionResult"]
                ).TranscriptionResult(
                    transcript="this is wild",
                    language_code="en-IN",
                    user_speech="this is wild",
                    reference_speech=None,
                )
            ),
        ),
        patch(
            "app.routers.yaps._describe_image",
            new=AsyncMock(
                return_value=ImageInsight(
                    kind="other",
                    description="A Stanford CS article headline.",
                )
            ),
        ) as describe,
        patch(
            "app.routers.yaps._judge_viewpoint",
            new=AsyncMock(return_value=True),
        ),
    ):
        s.SARVAM_API_KEY = "test-key"
        s.OPENAI_ENABLED = True
        s.OPENAI_API_KEY = "sk-test"
        res = await client.post(
            "/yaps",
            headers=auth_headers,
            files={
                "file": ("yap.webm", io.BytesIO(b"audio-bytes"), "audio/webm"),
                "image": ("cap.png", io.BytesIO(b"\x89PNG"), "image/png"),
            },
        )

    assert res.status_code == 201
    body = res.json()
    assert body["status"] == "ready"
    assert body["stored"] is True
    assert body["screen_kind"] == "other"
    assert body["transcript"] == "this is wild"
    assert "USER COMMENT" not in (body["transcript"] or "")
    assert body["reference"] is not None
    assert "ON SCREEN [other]" in body["reference"]
    assert "A Stanford CS article headline." in body["reference"]
    describe.assert_awaited_once()
    assert inserted
    assert inserted[0]["transcript"] == "this is wild"
    assert "ON SCREEN [other]" in inserted[0]["reference"]
    assert inserted[0]["screen_kind"] == "other"


@pytest.mark.asyncio
async def test_create_yap_with_social_screenshot(
    client: AsyncClient, auth_headers: dict[str, str]
):
    from app.clients.supabase import get_supabase_client
    from app.main import app
    from app.routers.yaps import ImageInsight

    class _Result:
        def __init__(self, data):
            self.data = data

    class _Query:
        def insert(self, payload: dict):
            self._payload = payload
            return self

        async def execute(self):
            return _Result(
                [{"id": "yap-social-1", "status": "ready", **self._payload}]
            )

    class _Fake:
        def table(self, _name: str):
            return _Query()

    app.dependency_overrides[get_supabase_client] = lambda: _Fake()

    with (
        patch("app.routers.yaps.settings") as s,
        patch(
            "app.routers.yaps.transcribe_audio",
            new=AsyncMock(
                return_value=__import__(
                    "app.clients.sarvam", fromlist=["TranscriptionResult"]
                ).TranscriptionResult(
                    transcript="painful",
                    language_code="en-IN",
                    user_speech="painful",
                    reference_speech=None,
                )
            ),
        ),
        patch(
            "app.routers.yaps._describe_image",
            new=AsyncMock(
                return_value=ImageInsight(
                    kind="social_post",
                    description="An X post about burnout.",
                    channel="twitter",
                )
            ),
        ),
        patch(
            "app.routers.yaps._judge_viewpoint",
            new=AsyncMock(return_value=True),
        ),
        patch(
            "app.routers.yaps._maybe_store_post_template",
            new=AsyncMock(),
        ) as store_template,
    ):
        s.SARVAM_API_KEY = "test-key"
        s.OPENAI_ENABLED = True
        s.OPENAI_API_KEY = "sk-test"
        res = await client.post(
            "/yaps",
            headers=auth_headers,
            files={
                "file": ("yap.webm", io.BytesIO(b"audio-bytes"), "audio/webm"),
                "image": ("cap.png", io.BytesIO(b"\x89PNG"), "image/png"),
            },
        )

    assert res.status_code == 201
    body = res.json()
    assert body["stored"] is True
    assert body["screen_kind"] == "social_post"
    assert body["transcript"] == "painful"
    assert body["reference"] is not None
    assert "ON SCREEN [social_post]" in body["reference"]
    store_template.assert_awaited_once()
    assert store_template.await_args.kwargs["description"] == "An X post about burnout."
    assert store_template.await_args.kwargs["channel_hint"] == "twitter"


@pytest.mark.asyncio
async def test_create_yap_skips_insert_when_not_viewpoint(
    client: AsyncClient, auth_headers: dict[str, str]
):
    from app.clients.supabase import get_supabase_client
    from app.main import app
    from app.routers.yaps import ImageInsight

    inserted: list[dict] = []

    class _Query:
        def insert(self, payload: dict):
            inserted.append(payload)
            raise AssertionError("insert should not be called")

    class _Fake:
        def table(self, _name: str):
            return _Query()

    app.dependency_overrides[get_supabase_client] = lambda: _Fake()

    with (
        patch("app.routers.yaps.settings") as s,
        patch(
            "app.routers.yaps.transcribe_audio",
            new=AsyncMock(
                return_value=__import__(
                    "app.clients.sarvam", fromlist=["TranscriptionResult"]
                ).TranscriptionResult(
                    transcript="generator apply on this",
                    language_code="en-IN",
                    user_speech="generator apply on this",
                    reference_speech=None,
                )
            ),
        ),
        patch(
            "app.routers.yaps._describe_image",
            new=AsyncMock(
                return_value=ImageInsight(
                    kind="other",
                    description="A chart.",
                )
            ),
        ),
        patch(
            "app.routers.yaps._judge_viewpoint",
            new=AsyncMock(return_value=False),
        ),
    ):
        s.SARVAM_API_KEY = "test-key"
        s.OPENAI_ENABLED = True
        s.OPENAI_API_KEY = "sk-test"
        res = await client.post(
            "/yaps",
            headers=auth_headers,
            files={
                "file": ("yap.webm", io.BytesIO(b"audio-bytes"), "audio/webm"),
                "image": ("cap.png", io.BytesIO(b"\x89PNG"), "image/png"),
            },
        )

    assert res.status_code == 200
    body = res.json()
    assert body["stored"] is False
    assert body["id"] is None
    assert body["status"] == "ready"
    assert body["transcript"] == "generator apply on this"
    assert body["reference"] is not None
    assert "ON SCREEN [other]" in body["reference"]
    assert inserted == []
