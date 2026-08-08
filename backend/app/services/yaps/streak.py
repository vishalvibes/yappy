"""Binary yap streak + Mon–Sun week presence (local timezone)."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from loguru import logger
from pydantic import BaseModel
from supabase import AClient

from app.services.yaps.constants import _TABLE


class YapDayOut(BaseModel):
    date: str  # YYYY-MM-DD
    posted: bool


class YapStatsOut(BaseModel):
    streak: int
    week: list[YapDayOut]


def _zone(tz_name: str | None) -> ZoneInfo:
    name = (tz_name or "").strip() or "UTC"
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError:
        logger.warning(f"unknown tz={name!r}; falling back to UTC")
        return ZoneInfo("UTC")
    except Exception:
        return ZoneInfo("UTC")


def _local_today(tz: ZoneInfo) -> date:
    return datetime.now(tz).date()


def _week_monday(day: date) -> date:
    return day - timedelta(days=day.weekday())


def _posted_local_days(
    created_ats: list[str],
    *,
    tz: ZoneInfo,
) -> set[date]:
    days: set[date] = set()
    for raw in created_ats:
        if not raw:
            continue
        try:
            # Supabase returns ISO timestamps; tolerate Z / offset / naive UTC.
            text = raw.replace("Z", "+00:00") if raw.endswith("Z") else raw
            dt = datetime.fromisoformat(text)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            days.add(dt.astimezone(tz).date())
        except ValueError:
            continue
    return days


def _compute_streak(posted: set[date], *, today: date) -> int:
    streak = 0
    cursor = today
    while cursor in posted:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


def _build_week(posted: set[date], *, today: date) -> list[YapDayOut]:
    monday = _week_monday(today)
    week: list[YapDayOut] = []
    for i in range(7):
        day = monday + timedelta(days=i)
        week.append(
            YapDayOut(
                date=day.isoformat(),
                posted=day <= today and day in posted,
            )
        )
    return week


def compute_yap_stats(
    created_ats: list[str],
    *,
    tz_name: str | None,
    today: date | None = None,
) -> YapStatsOut:
    """Pure: binary week (Mon–Sun) + consecutive-day streak ending today."""
    tz = _zone(tz_name)
    local_today = today or _local_today(tz)
    posted = _posted_local_days(created_ats, tz=tz)
    return YapStatsOut(
        streak=_compute_streak(posted, today=local_today),
        week=_build_week(posted, today=local_today),
    )


async def build_yap_stats(
    supabase: AClient,
    *,
    user_id: str,
    tz_name: str | None,
) -> YapStatsOut:
    """Load recent ready yaps and compute streak/week for `tz_name`."""
    tz = _zone(tz_name)
    today = _local_today(tz)
    lookback = today - timedelta(days=400)
    start_utc = datetime.combine(lookback, time.min, tzinfo=tz).astimezone(
        timezone.utc
    )

    try:
        res = await (
            supabase.table(_TABLE)
            .select("created_at")
            .eq("user_id", user_id)
            .eq("status", "ready")
            .gte("created_at", start_utc.isoformat())
            .execute()
        )
        rows = res.data or []
    except Exception as e:
        logger.warning(f"yap stats query failed: {type(e).__name__}: {e}")
        return YapStatsOut(streak=0, week=_build_week(set(), today=today))

    created_ats = [
        str(row["created_at"])
        for row in rows
        if row.get("created_at") is not None
    ]
    return compute_yap_stats(created_ats, tz_name=tz_name)
