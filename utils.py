"""Cross-cutting helpers: logging, retries, selector resolution, parsing."""
from __future__ import annotations

import functools
import logging
import re
import time
from logging.handlers import RotatingFileHandler
from typing import Callable, Optional, TypeVar

from dateutil import parser as date_parser
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Locator, Page, TimeoutError as PlaywrightTimeoutError

import config

LOGGER_NAME = "tiktok_scraper"
T = TypeVar("T")


# --- Logging -----------------------------------------------------------
def setup_logging() -> logging.Logger:
    """Configure the shared logger once (console + rotating file)."""
    logger = logging.getLogger(LOGGER_NAME)
    if logger.handlers:
        return logger

    logger.setLevel(config.LOG_LEVEL)
    formatter = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(message)s", "%Y-%m-%d %H:%M:%S"
    )

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

    file_handler = RotatingFileHandler(
        config.LOG_FILE, maxBytes=5_000_000, backupCount=3, encoding="utf-8"
    )
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    return logger


def get_logger() -> logging.Logger:
    return logging.getLogger(LOGGER_NAME)


# --- Retry decorator ---------------------------------------------------
def retry(
    times: int = config.MAX_RETRIES,
    base_delay_ms: int = config.RETRY_BASE_DELAY_MS,
    exceptions: tuple[type[Exception], ...] = (PlaywrightError, PlaywrightTimeoutError),
) -> Callable[[Callable[..., T]], Callable[..., T]]:
    """Retry a function on the given exceptions with linear backoff.

    Never used to paper over real bugs: only for the flaky-network /
    slow-render failures Playwright interactions are prone to.
    """

    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @functools.wraps(func)
        def wrapper(*args, **kwargs) -> T:
            logger = get_logger()
            last_exc: Optional[Exception] = None
            for attempt in range(1, times + 1):
                try:
                    return func(*args, **kwargs)
                except exceptions as exc:
                    last_exc = exc
                    logger.warning(
                        "%s failed (attempt %d/%d): %s",
                        func.__name__,
                        attempt,
                        times,
                        exc,
                    )
                    if attempt < times:
                        time.sleep(base_delay_ms / 1000 * attempt)
            assert last_exc is not None
            raise last_exc

        return wrapper

    return decorator


# --- Selector mini-DSL resolver ------------------------------------------
def _compile_pattern(pattern: str) -> re.Pattern:
    if pattern.startswith("/") and pattern.rfind("/") > 0:
        body, _, flags = pattern[1:].rpartition("/")
        flag_value = re.IGNORECASE if "i" in flags else 0
        return re.compile(body, flag_value)
    return re.compile(re.escape(pattern), re.IGNORECASE)


def _build_locator(scope: Page | Locator, strategy: str) -> Locator:
    kind, _, rest = strategy.partition(":")
    if kind == "role":
        role, _, name_pattern = rest.partition(":")
        if name_pattern:
            return scope.get_by_role(role, name=_compile_pattern(name_pattern))  # type: ignore[arg-type]
        return scope.get_by_role(role)  # type: ignore[arg-type]
    if kind == "text":
        return scope.get_by_text(_compile_pattern(rest))
    if kind == "label":
        return scope.get_by_label(_compile_pattern(rest))
    if kind == "testid":
        return scope.get_by_test_id(rest)
    if kind == "css":
        return scope.locator(rest)
    raise ValueError(f"Unknown selector strategy: {strategy!r}")


def resolve(
    scope: Page | Locator,
    strategies: list[str],
    timeout_ms: int = config.DEFAULT_TIMEOUT_MS,
    poll_ms: int = 200,
) -> Optional[Locator]:
    """Try each selector strategy in order, polling until one matches.

    Returns the first Locator that resolves to at least one element, or
    None once ``timeout_ms`` elapses without a match. This is what makes the
    scraper resilient to DOM churn: callers never hardcode a single
    selector, they hand a fallback chain from selectors.py.
    """
    logger = get_logger()
    deadline = time.monotonic() + timeout_ms / 1000
    while True:
        for strategy in strategies:
            try:
                locator = _build_locator(scope, strategy)
                if locator.count() > 0:
                    return locator
            except PlaywrightError:
                continue
        if time.monotonic() >= deadline:
            logger.debug("No strategy matched among %s within %dms", strategies, timeout_ms)
            return None
        time.sleep(poll_ms / 1000)


def dismiss_popups(page: Page, strategies: list[str]) -> None:
    """Best-effort dismissal of cookie banners / popups. Never fatal."""
    logger = get_logger()
    for strategy in strategies:
        try:
            locator = _build_locator(page, strategy)
            if locator.count() > 0:
                locator.first.click(timeout=1000)
                logger.debug("Dismissed popup via strategy: %s", strategy)
        except PlaywrightError:
            continue


# --- Parsing helpers -------------------------------------------------------
_COUNT_MULTIPLIERS = {"K": 1_000, "M": 1_000_000, "B": 1_000_000_000}
_COUNT_PATTERN = re.compile(r"^([0-9]*\.?[0-9]+)\s*([KMB]?)$")


def parse_count(raw: Optional[str]) -> Optional[int]:
    """Parse abbreviated counters like '12.3K' or '1.2M' into an int."""
    if not raw:
        return None
    text = raw.strip().upper().replace(",", "").replace("+", "")
    match = _COUNT_PATTERN.match(text)
    if not match:
        digits = re.sub(r"[^0-9]", "", text)
        return int(digits) if digits else None
    value, suffix = match.groups()
    multiplier = _COUNT_MULTIPLIERS.get(suffix, 1)
    return int(round(float(value) * multiplier))


def parse_percent(raw: Optional[str]) -> Optional[float]:
    """Parse a percentage string like '34.5%' into a float (34.5)."""
    if not raw:
        return None
    match = re.search(r"([0-9]*\.?[0-9]+)\s*%", raw)
    return float(match.group(1)) if match else None


def parse_duration_to_seconds(raw: Optional[str]) -> Optional[int]:
    """Parse 'H:MM:SS' or 'M:SS' timestamps into total seconds."""
    if not raw:
        return None
    parts = raw.strip().split(":")
    try:
        numbers = [int(part) for part in parts]
    except ValueError:
        return None
    seconds = 0
    for number in numbers:
        seconds = seconds * 60 + number
    return seconds


def parse_datetime(raw: Optional[str]):
    """Best-effort parse of a published-date string into (date, time)."""
    if not raw:
        return None, None
    cleaned = re.sub(r"(?i)published:?\s*", "", raw).strip()
    try:
        parsed = date_parser.parse(cleaned, fuzzy=True)
    except (ValueError, OverflowError):
        return None, None
    return parsed.date(), parsed.time()
