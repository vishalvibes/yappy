"""Shared Pydantic models for yaps pipeline."""

from __future__ import annotations

from pydantic import BaseModel


class ImageInsight(BaseModel):
    kind: str  # social_post | other
    description: str
    channel: str | None = None  # twitter | linkedin | … (social only)
    likes: int | None = None
    replies: int | None = None
    reposts: int | None = None
    views: int | None = None
    age_hours: float | None = None
    has_image: bool = False
    image_detail: str | None = None


class PostTemplateDraft(BaseModel):
    """Captured template candidate for create-mode generation."""

    channel: str
    template: str
    pattern: str | None = None
    likes: int | None = None
    replies: int | None = None
    reposts: int | None = None
    views: int | None = None
    age_hours: float | None = None
    has_image: bool = False
    image_detail: str | None = None
