"""Typed data structures shared across the scraper and the exporters."""
from __future__ import annotations

from dataclasses import dataclass, field, fields
from datetime import date as date_type
from datetime import time as time_type
from typing import Any, Dict, Optional


@dataclass
class VideoStats:
    """All statistics collected for a single TikTok video.

    Known metrics get a typed, fixed column. Anything visible on the stats
    panel that doesn't match a known label still gets captured in
    ``extra_stats`` so the scraper never silently drops a statistic just
    because it wasn't anticipated.
    """

    video_id: str
    url: str
    description: str = ""
    date: Optional[date_type] = None
    time: Optional[time_type] = None
    duration_seconds: Optional[int] = None
    views: Optional[int] = None
    likes: Optional[int] = None
    comments: Optional[int] = None
    shares: Optional[int] = None
    favorites: Optional[int] = None
    watch_time_seconds: Optional[int] = None
    average_watch_time_seconds: Optional[float] = None
    completion_rate: Optional[float] = None
    retention: Optional[float] = None
    followers_generated: Optional[int] = None
    thumbnail_url: str = ""
    extra_stats: Dict[str, Any] = field(default_factory=dict)

    def engagement_rate(self) -> float:
        """(likes + comments + shares + favorites) / views, or 0 if no views."""
        if not self.views:
            return 0.0
        interactions = sum(
            value or 0
            for value in (self.likes, self.comments, self.shares, self.favorites)
        )
        return interactions / self.views

    def to_dict(self) -> Dict[str, Any]:
        """Flatten into a single dict; extra_stats keys become top-level columns."""
        base = {
            f.name: getattr(self, f.name)
            for f in fields(self)
            if f.name != "extra_stats"
        }
        base.update(self.extra_stats)
        return base
