"""Lazy lookups into app.routers.yaps for test patch compatibility."""

from __future__ import annotations

from typing import Any


def _router() -> Any:
    from app.routers import yaps

    return yaps


def settings() -> Any:
    return _router().settings


def create_chat_completion(*args: Any, **kwargs: Any) -> Any:
    return _router().create_chat_completion(*args, **kwargs)


async def fetch_related_yaps(*args: Any, **kwargs: Any) -> Any:
    return await _router()._fetch_related_yaps(*args, **kwargs)


async def fetch_post_templates(*args: Any, **kwargs: Any) -> Any:
    return await _router()._fetch_post_templates(*args, **kwargs)


async def fetch_yap(*args: Any, **kwargs: Any) -> Any:
    return await _router()._fetch_yap(*args, **kwargs)


async def rank_tweets(*args: Any, **kwargs: Any) -> Any:
    return await _router()._rank_tweets(*args, **kwargs)


async def llm_rank_tweets(*args: Any, **kwargs: Any) -> Any:
    return await _router()._llm_rank_tweets(*args, **kwargs)


async def extract_post_template(*args: Any, **kwargs: Any) -> Any:
    return await _router()._extract_post_template(*args, **kwargs)
