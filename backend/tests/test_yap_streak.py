"""Binary yap streak + Mon–Sun week — pure compute + create_yap wiring."""

from __future__ import annotations

import io
from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch
from zoneinfo import ZoneInfo

import pytest
from httpx import AsyncClient

from app.services.yaps.streak import YapDayOut, YapStatsOut, compute_yap_stats


def _iso(day: date, *, hour: int = 12, tz_name: str = "Asia/Kolkata") -> str:
    tz = ZoneInfo(tz_name)
    return datetime(day.year, day.month, day.day, hour, 0, 0, tzinfo=tz).isoformat()


def test_compute_streak_first_yap_friday():
    # 2026-08-07 is a Friday
    today = date(2026, 8, 7)
    stats = compute_yap_stats(
        [_iso(today)],
        tz_name="Asia/Kolkata",
        today=today,
    )
    assert stats.streak == 1
    assert len(stats.week) == 7
    assert stats.week[0].date == "2026-08-03"  # Monday
    assert [d.posted for d in stats.week] == [
        False,
        False,
        False,
        False,
        True,
        False,
        False,
    ]


def test_compute_streak_two_consecutive_days():
    today = date(2026, 8, 7)  # Fri
    stats = compute_yap_stats(
        [_iso(date(2026, 8, 6)), _iso(today)],
        tz_name="Asia/Kolkata",
        today=today,
    )
    assert stats.streak == 2
    assert stats.week[3].posted is True  # Thu
    assert stats.week[4].posted is True  # Fri


def test_compute_streak_resets_after_gap():
    today = date(2026, 8, 7)  # Fri
    stats = compute_yap_stats(
        [_iso(date(2026, 8, 3)), _iso(today)],  # Mon + Fri
        tz_name="Asia/Kolkata",
        today=today,
    )
    assert stats.streak == 1
    assert stats.week[0].posted is True
    assert stats.week[4].posted is True


def test_compute_streak_binary_ignores_multiple_same_day():
    today = date(2026, 8, 7)
    stats = compute_yap_stats(
        [_iso(today, hour=9), _iso(today, hour=18), _iso(today, hour=21)],
        tz_name="Asia/Kolkata",
        today=today,
    )
    assert stats.streak == 1
    assert sum(1 for d in stats.week if d.posted) == 1


def test_tz_day_boundary_shifts_local_date():
    # 2026-08-06 20:30 UTC = 2026-08-07 02:00 Asia/Kolkata
    utc_ts = datetime(2026, 8, 6, 20, 30, tzinfo=timezone.utc).isoformat()
    today = date(2026, 8, 7)
    stats = compute_yap_stats(
        [utc_ts],
        tz_name="Asia/Kolkata",
        today=today,
    )
    assert stats.streak == 1
    assert stats.week[4].date == "2026-08-07"
    assert stats.week[4].posted is True


def test_future_days_in_week_never_posted():
    today = date(2026, 8, 5)  # Wed
    stats = compute_yap_stats(
        [_iso(today), _iso(date(2026, 8, 8))],  # fake future row ignored
        tz_name="UTC",
        today=today,
    )
    assert stats.week[5].posted is False  # Sat
    assert stats.week[6].posted is False  # Sun


@pytest.mark.asyncio
async def test_create_yap_returns_stats_with_tz(
    client: AsyncClient, auth_headers: dict[str, str]
):
    from app.clients.supabase import get_supabase_client
    from app.main import app

    week = [
        YapDayOut(
            date=(date(2026, 8, 3) + timedelta(days=i)).isoformat(),
            posted=i == 4,
        )
        for i in range(7)
    ]
    fake_stats = YapStatsOut(streak=1, week=week)

    class _Result:
        def __init__(self, data):
            self.data = data

    class _Query:
        def __init__(self):
            self._mode = "select"
            self._payload: dict | None = None

        def insert(self, payload: dict):
            self._mode = "insert"
            self._payload = payload
            return self

        def select(self, *_a, **_k):
            self._mode = "select"
            return self

        def eq(self, *_a, **_k):
            return self

        def gte(self, *_a, **_k):
            return self

        async def execute(self):
            if self._mode == "insert":
                return _Result(
                    [{"id": "yap-streak-1", "status": "ready", **(self._payload or {})}]
                )
            return _Result([])

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
                    transcript="a real take",
                    language_code="en-IN",
                    user_speech="a real take",
                    reference_speech=None,
                )
            ),
        ),
        patch(
            "app.routers.yaps._judge_viewpoint",
            new=AsyncMock(return_value=True),
        ),
        patch(
            "app.routers.yaps.build_yap_stats",
            new=AsyncMock(return_value=fake_stats),
        ) as stats_mock,
    ):
        s.SARVAM_API_KEY = "test-key"
        res = await client.post(
            "/yaps",
            headers=auth_headers,
            data={"tz": "Asia/Kolkata"},
            files={"file": ("yap.webm", io.BytesIO(b"audio-bytes"), "audio/webm")},
        )

    assert res.status_code == 201
    body = res.json()
    assert body["stats"]["streak"] == 1
    assert len(body["stats"]["week"]) == 7
    assert body["stats"]["week"][4]["posted"] is True
    stats_mock.assert_awaited_once()
    assert stats_mock.await_args.kwargs["tz_name"] == "Asia/Kolkata"
