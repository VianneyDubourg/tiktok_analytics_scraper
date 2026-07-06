"""Centralized configuration for the TikTok Studio scraper.

Every constant that could plausibly need tuning (URLs, timeouts, folders,
retry counts) lives here and nowhere else, and can be overridden via a
``.env`` file without touching code.
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return default


# --- Paths -------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
SESSION_FOLDER = Path(os.getenv("SESSION_FOLDER", BASE_DIR / ".session"))
EXPORT_FOLDER = Path(os.getenv("EXPORT_FOLDER", BASE_DIR / "data"))
LOG_FOLDER = Path(os.getenv("LOG_FOLDER", BASE_DIR / "logs"))

for _folder in (SESSION_FOLDER, EXPORT_FOLDER, LOG_FOLDER):
    _folder.mkdir(parents=True, exist_ok=True)

# --- URLs ----------------------------------------------------------------
# Split into pieces (not one hardcoded URL) so a path change only touches
# one line, and so tests/mocks can point BASE_URL elsewhere.
BASE_URL = os.getenv("BASE_URL", "https://www.tiktok.com")
STUDIO_PATH = os.getenv("STUDIO_PATH", "/tiktokstudio")
CONTENT_PATH = os.getenv("CONTENT_PATH", "/content")
STUDIO_URL = f"{BASE_URL}{STUDIO_PATH}"
CONTENT_URL = f"{STUDIO_URL}{CONTENT_PATH}"

# --- Browser / timing ------------------------------------------------------
HEADLESS = _env_bool("HEADLESS", False)
LOCALE = os.getenv("LOCALE", "en-US")
TIMEZONE_ID = os.getenv("TIMEZONE_ID", "UTC")

DEFAULT_TIMEOUT_MS = _env_int("TIMEOUT", 30_000)
NAVIGATION_TIMEOUT_MS = _env_int("NAVIGATION_TIMEOUT", 45_000)
VIDEO_DETAIL_TIMEOUT_MS = _env_int("VIDEO_DETAIL_TIMEOUT", 20_000)

# Manual login: the first run pauses so a human can log in. We poll instead
# of sleeping for a fixed duration.
LOGIN_POLL_INTERVAL_MS = _env_int("LOGIN_POLL_INTERVAL", 2_000)
LOGIN_MAX_WAIT_MS = _env_int("LOGIN_MAX_WAIT", 600_000)  # 10 minutes

# Infinite scroll: stop once no new video appears for this many consecutive
# rounds, with a hard ceiling as a safety net against runaway loops.
SCROLL_PAUSE_MS = _env_int("SCROLL_PAUSE_MS", 800)
MAX_SCROLL_STAGNANT_ROUNDS = _env_int("MAX_SCROLL_STAGNANT_ROUNDS", 4)
MAX_SCROLL_ROUNDS = _env_int("MAX_SCROLL_ROUNDS", 2000)

MAX_RETRIES = _env_int("MAX_RETRIES", 3)
RETRY_BASE_DELAY_MS = _env_int("RETRY_BASE_DELAY_MS", 1000)

# --- Export ----------------------------------------------------------------
EXPORT_FILENAME_PREFIX = "tiktok_stats"
TOP_RANKING_SIZE = _env_int("TOP_RANKING_SIZE", 20)

# --- Logging ---------------------------------------------------------------
LOG_FILE = LOG_FOLDER / "scraper.log"
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
