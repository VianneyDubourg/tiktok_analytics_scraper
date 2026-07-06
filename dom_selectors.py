"""Centralized Playwright selector strategies for TikTok Studio.

TikTok ships an obfuscated, frequently-changing DOM and does not publish a
stable markup contract, so every selector below is an *ordered list of
fallback strategies* rather than a single brittle CSS path. ``utils.resolve``
tries each strategy top-to-bottom and returns the first one that actually
matches something on the page. Nothing here depends on a fixed coordinate,
a single hashed class name, or an element index.

If TikTok changes its interface, this should be the ONLY file that needs
editing: add a new strategy string (or reorder priorities), keep
``scraper.py`` untouched.

Strategy mini-DSL understood by ``utils.resolve``:
    "role:<role>:<name-regex>"  -> page.get_by_role(role, name=re.compile(...))
    "role:<role>"               -> page.get_by_role(role)
    "text:<regex>"               -> page.get_by_text(re.compile(...))
    "label:<regex>"              -> page.get_by_label(re.compile(...))
    "testid:<value>"             -> page.get_by_test_id(<value>)
    "css:<selector>"             -> page.locator(<selector>)

Tip for maintenance: run ``playwright codegen https://www.tiktok.com/tiktokstudio/content``
(after logging in once) to record real selectors and slot them in here.
"""
from __future__ import annotations

# --- Login detection ---------------------------------------------------
# Elements that indicate the user is NOT logged in yet.
LOGIN_WALL_INDICATORS: list[str] = [
    "role:heading:Log in to TikTok",
    "role:button:Use phone / email / username",
    "css:div[class*='login-scan-qrcode']",
    "text:/Log in to TikTok/i",
]

# Elements that indicate TikTok Studio's dashboard chrome is loaded (i.e.
# the user IS logged in).
STUDIO_LOGGED_IN_INDICATORS: list[str] = [
    "role:link:Content",
    "role:navigation",
    "css:[data-e2e='cc-content-tab']",
    "text:/Manage your content/i",
]

# --- Cookie / popup dismissal --------------------------------------------
POPUP_DISMISS_BUTTONS: list[str] = [
    "role:button:Accept all",
    "role:button:Allow all",
    "role:button:Got it",
    "role:button:/^(Close|Dismiss|Not now|No thanks)$/i",
    "css:button[aria-label='Close']",
]

# --- Navigation ------------------------------------------------------------
CONTENT_NAV_LINK: list[str] = [
    "role:link:Content",
    "role:tab:Content",
    "css:[data-e2e='cc-content-tab']",
    "text:/^Content$/",
]

# --- Video list / infinite scroll ------------------------------------------
VIDEO_LIST_CONTAINER: list[str] = [
    "css:[data-e2e='cc-video-list']",
    "css:main",
    "css:body",
]

VIDEO_CARD: list[str] = [
    "css:[data-e2e='cc-video-card']",
    "css:div[class*='videoCard']",
    "css:a[href*='/video/']",
]

VIDEO_CARD_THUMBNAIL: list[str] = [
    "css:img",
]

VIDEO_CARD_LINK: list[str] = [
    "css:a[href*='/video/']",
]

# --- Video detail panel -----------------------------------------------------
# The detail view may render as a modal dialog or as a full navigation; both
# are handled by scraper.py.
VIDEO_DETAIL_ROOT: list[str] = [
    "role:dialog",
    "css:[data-e2e='cc-video-detail']",
    "css:main",
]

VIDEO_DETAIL_CLOSE_BUTTON: list[str] = [
    "role:button:Close",
    "css:button[aria-label='Close']",
    "css:[data-e2e='cc-video-detail-close']",
]

VIDEO_DETAIL_DESCRIPTION: list[str] = [
    "css:[data-e2e='cc-video-detail-desc']",
    "css:div[class*='videoDesc']",
    "css:h1",
]

VIDEO_DETAIL_DATE: list[str] = [
    "css:[data-e2e='cc-video-detail-date']",
    "text:/Published:/i",
]

VIDEO_DETAIL_DURATION: list[str] = [
    "css:[data-e2e='cc-video-detail-duration']",
    "text:/^[0-9]{1,2}:[0-9]{2}$/",
]

# Generic "label -> value" stat rows. TikTok Studio renders analytics as
# pairs of a visible label and an adjacent value; scanning by label text is
# the most resilient approach since it survives class-name churn.
#
# Maps a canonical VideoStats field name to a list of regexes matching the
# label as it may appear on screen. First match wins; anything on the panel
# that does NOT match one of these ends up in ``extra_stats`` automatically.
STAT_LABEL_ALIASES: dict[str, list[str]] = {
    "views": [r"^Video views$", r"^Views$", r"^Total views$"],
    "likes": [r"^Likes$"],
    "comments": [r"^Comments$"],
    "shares": [r"^Shares$"],
    "favorites": [r"^Saves$", r"^Favorites$", r"^Favourites$"],
    "watch_time_seconds": [r"^Total watch time$", r"^Watch time$"],
    "average_watch_time_seconds": [r"^Average watch time$", r"^Avg\.? watch time$"],
    "completion_rate": [r"^Video completion rate$", r"^Completion rate$"],
    "retention": [r"^Average retention$", r"^Retention rate$", r"^Retention$"],
    "followers_generated": [r"^Followers$", r"^New followers$", r"^Followers gained$"],
}

# Container that holds all label/value stat rows on the detail panel, used
# for the generic scan that feeds both known fields and extra_stats.
STAT_ROW_CONTAINER: list[str] = [
    "css:[data-e2e='cc-video-detail-stats']",
    "css:section[class*='stats']",
    "css:main",
]

STAT_ROW_ITEM: list[str] = [
    "css:[data-e2e='cc-stat-item']",
    "css:div[class*='statItem']",
    "css:li",
]
