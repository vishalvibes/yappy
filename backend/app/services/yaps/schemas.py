"""Request/response models for yap generate endpoints."""

from __future__ import annotations

from pydantic import BaseModel


class GenerateIn(BaseModel):
    yap_id: str | None = None
    transcript: str | None = None  # viewpoint
    reference: str | None = None
    screen_kind: str | None = None


class GenerateOut(BaseModel):
    id: str | None = None
    tweets: list[str]
    screen_kind: str | None = None
    mode: str = "create"
