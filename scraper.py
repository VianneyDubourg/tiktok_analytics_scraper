"""Playwright-driven scraper for TikTok Studio's content analytics.

Responsible for: session persistence, manual login handoff, navigation,
infinite-scroll video discovery, and per-video statistics extraction. All
DOM lookups go through ``dom_selectors.py`` + ``utils.resolve`` so nothing here
depends on a fixed coordinate or a single brittle CSS path.
"""
from __future__ import annotations

import re
from typing import Optional

from playwright.sync_api import BrowserContext, Locator, Page, sync_playwright

import config
import dom_selectors as selectors
import utils
from models import VideoStats

logger = utils.get_logger()


class TikTokStudioScraper:
    """Drives a persistent Chromium session through TikTok Studio.

    Usage::

        with TikTokStudioScraper() as scraper:
            videos = scraper.run()
    """

    def __init__(self, headless: bool = config.HEADLESS) -> None:
        self._headless = headless
        self._playwright = None
        self._context: Optional[BrowserContext] = None
        self._page: Optional[Page] = None

    def __enter__(self) -> "TikTokStudioScraper":
        self._playwright = sync_playwright().start()
        # A persistent context stores cookies/local storage on disk, so a
        # successful manual login is remembered across process restarts -
        # no separate storage_state file to manage.
        self._context = self._playwright.chromium.launch_persistent_context(
            user_data_dir=str(config.SESSION_FOLDER),
            headless=self._headless,
            locale=config.LOCALE,
            timezone_id=config.TIMEZONE_ID,
            viewport={"width": 1440, "height": 900},
        )
        self._context.set_default_timeout(config.DEFAULT_TIMEOUT_MS)
        self._context.set_default_navigation_timeout(config.NAVIGATION_TIMEOUT_MS)
        self._page = self._context.pages[0] if self._context.pages else self._context.new_page()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        if self._context is not None:
            self._context.close()
        if self._playwright is not None:
            self._playwright.stop()

    @property
    def page(self) -> Page:
        assert self._page is not None, "Scraper must be used as a context manager"
        return self._page

    # --- High level orchestration -------------------------------------
    def run(self) -> list[VideoStats]:
        logger.info("Connexion...")
        self.ensure_logged_in()
        logger.info("Session chargée")

        self.open_content_tab()
        card_count = self.load_all_videos()
        logger.info("%d vidéos détectées", card_count)

        videos: list[VideoStats] = []
        for index in range(card_count):
            logger.info("Vidéo %d/%d", index + 1, card_count)
            try:
                stats = self._extract_one(index)
            except Exception as exc:  # noqa: BLE001 - one bad video must not abort the run
                logger.error("Échec extraction vidéo %d/%d: %s", index + 1, card_count, exc)
                continue
            videos.append(stats)
            logger.info("Extraction OK")
        return videos

    # --- Login -----------------------------------------------------------
    def ensure_logged_in(self) -> None:
        page = self.page
        page.goto(config.CONTENT_URL)
        utils.dismiss_popups(page, selectors.POPUP_DISMISS_BUTTONS)

        if utils.resolve(page, selectors.STUDIO_LOGGED_IN_INDICATORS, timeout_ms=5000):
            return  # session restored from the persistent context

        login_wall = utils.resolve(page, selectors.LOGIN_WALL_INDICATORS, timeout_ms=5000)
        if login_wall is None:
            # Ambiguous state: give the dashboard indicators a longer chance
            # before assuming something is actually wrong.
            if utils.resolve(
                page, selectors.STUDIO_LOGGED_IN_INDICATORS, timeout_ms=config.DEFAULT_TIMEOUT_MS
            ):
                return
            logger.warning(
                "Ni l'écran de connexion ni le tableau de bord Studio n'ont été détectés; "
                "poursuite prudente (vérifiez dom_selectors.py si TikTok a changé son interface)."
            )
            return

        logger.info("Connexion manuelle requise : connectez-vous dans la fenêtre du navigateur ouverte...")
        waited_ms = 0
        while waited_ms < config.LOGIN_MAX_WAIT_MS:
            if utils.resolve(
                page, selectors.STUDIO_LOGGED_IN_INDICATORS, timeout_ms=config.LOGIN_POLL_INTERVAL_MS
            ):
                logger.info("Connexion détectée.")
                return
            waited_ms += config.LOGIN_POLL_INTERVAL_MS
        raise TimeoutError("Connexion manuelle non détectée dans le délai imparti.")

    # --- Navigation --------------------------------------------------------
    def open_content_tab(self) -> None:
        page = self.page
        if utils.resolve(page, selectors.STUDIO_LOGGED_IN_INDICATORS, timeout_ms=2000) is None:
            page.goto(config.CONTENT_URL)

        nav_link = utils.resolve(page, selectors.CONTENT_NAV_LINK, timeout_ms=config.DEFAULT_TIMEOUT_MS)
        if nav_link is not None:
            try:
                nav_link.first.click(timeout=3000)
            except Exception:  # noqa: BLE001 - we may already be on the Content tab
                pass

        utils.resolve(page, selectors.VIDEO_CARD, timeout_ms=config.DEFAULT_TIMEOUT_MS)

    # --- Infinite scroll -----------------------------------------------------
    def load_all_videos(self) -> int:
        """Scroll until the video card count stops growing, never on a sleep alone."""
        page = self.page
        previous_count = -1
        stagnant_rounds = 0

        for _ in range(config.MAX_SCROLL_ROUNDS):
            cards = utils.resolve(page, selectors.VIDEO_CARD, timeout_ms=3000)
            current_count = cards.count() if cards else 0

            if current_count == previous_count:
                stagnant_rounds += 1
                if stagnant_rounds >= config.MAX_SCROLL_STAGNANT_ROUNDS:
                    break
            else:
                stagnant_rounds = 0

            previous_count = current_count
            page.mouse.wheel(0, 4000)
            page.wait_for_timeout(config.SCROLL_PAUSE_MS)

        final_cards = utils.resolve(page, selectors.VIDEO_CARD, timeout_ms=3000)
        return final_cards.count() if final_cards else 0

    # --- Per-video extraction ------------------------------------------------
    @utils.retry()
    def _extract_one(self, index: int) -> VideoStats:
        page = self.page
        cards = utils.resolve(page, selectors.VIDEO_CARD, timeout_ms=config.DEFAULT_TIMEOUT_MS)
        if cards is None:
            raise RuntimeError("Impossible de localiser la liste des vidéos")

        card = cards.nth(index)
        card.scroll_into_view_if_needed()
        url, thumbnail_url = self._read_card_summary(card)

        url_before = page.url
        card.click()

        detail_root = utils.resolve(
            page, selectors.VIDEO_DETAIL_ROOT, timeout_ms=config.VIDEO_DETAIL_TIMEOUT_MS
        )
        if detail_root is None:
            raise RuntimeError("Le panneau de détail de la vidéo ne s'est pas ouvert")

        # The detail view may be a modal (URL unchanged) or a full navigation
        # to a dedicated page; both are closed differently.
        navigated = page.url != url_before

        stats = self._extract_detail(detail_root.first, url=url or page.url, thumbnail_url=thumbnail_url)
        self._close_detail(page, navigated=navigated)
        return stats

    def _read_card_summary(self, card: Locator) -> tuple[str, str]:
        url = ""
        link = utils.resolve(card, selectors.VIDEO_CARD_LINK, timeout_ms=1000)
        if link is not None:
            href = link.first.get_attribute("href")
            if href:
                url = href if href.startswith("http") else f"{config.BASE_URL}{href}"

        thumbnail_url = ""
        thumb = utils.resolve(card, selectors.VIDEO_CARD_THUMBNAIL, timeout_ms=1000)
        if thumb is not None:
            thumbnail_url = thumb.first.get_attribute("src") or ""
        return url, thumbnail_url

    def _extract_detail(self, detail: Locator, *, url: str, thumbnail_url: str) -> VideoStats:
        video_id = self._extract_video_id(url)
        description = self._safe_text(detail, selectors.VIDEO_DETAIL_DESCRIPTION)
        raw_date = self._safe_text(detail, selectors.VIDEO_DETAIL_DATE)
        date_value, time_value = utils.parse_datetime(raw_date)
        duration_raw = self._safe_text(detail, selectors.VIDEO_DETAIL_DURATION)

        stats = VideoStats(
            video_id=video_id,
            url=url,
            description=description,
            date=date_value,
            time=time_value,
            duration_seconds=utils.parse_duration_to_seconds(duration_raw),
            thumbnail_url=thumbnail_url,
        )
        self._scan_stat_rows(detail, stats)
        return stats

    def _scan_stat_rows(self, detail: Locator, stats: VideoStats) -> None:
        """Read every visible label/value stat row generically.

        Known labels populate typed fields on ``stats``; anything else is
        preserved in ``stats.extra_stats`` so no visible metric is lost,
        even if TikTok renamed or added a statistic we didn't anticipate.
        """
        container = utils.resolve(detail, selectors.STAT_ROW_CONTAINER, timeout_ms=2000)
        if container is None:
            return
        rows = utils.resolve(container, selectors.STAT_ROW_ITEM, timeout_ms=2000)
        if rows is None:
            return

        for i in range(rows.count()):
            try:
                row_text = (rows.nth(i).inner_text() or "").strip()
            except Exception:  # noqa: BLE001 - a single flaky row shouldn't abort the scan
                continue
            if not row_text:
                continue
            label, value = self._split_label_value(row_text)
            if not label:
                continue
            field_name = self._match_known_field(label)
            if field_name is None:
                stats.extra_stats[label] = value
            else:
                self._assign_field(stats, field_name, value)

    @staticmethod
    def _split_label_value(row_text: str) -> tuple[str, str]:
        lines = [line.strip() for line in row_text.splitlines() if line.strip()]
        if len(lines) >= 2:
            return lines[0], lines[1]
        return "", row_text

    @staticmethod
    def _match_known_field(label: str) -> Optional[str]:
        for field_name, patterns in selectors.STAT_LABEL_ALIASES.items():
            for pattern in patterns:
                if re.match(pattern, label, re.IGNORECASE):
                    return field_name
        return None

    @staticmethod
    def _assign_field(stats: VideoStats, field_name: str, value: str) -> None:
        if field_name in {"completion_rate", "retention"}:
            setattr(stats, field_name, utils.parse_percent(value))
        elif field_name in {"average_watch_time_seconds", "watch_time_seconds"}:
            setattr(stats, field_name, utils.parse_duration_to_seconds(value) or utils.parse_count(value))
        else:
            setattr(stats, field_name, utils.parse_count(value))

    def _safe_text(self, scope: Locator, strategies: list[str]) -> str:
        locator = utils.resolve(scope, strategies, timeout_ms=2000)
        if locator is None:
            return ""
        try:
            return (locator.first.inner_text() or "").strip()
        except Exception:  # noqa: BLE001 - missing text should never abort extraction
            return ""

    @staticmethod
    def _extract_video_id(url: str) -> str:
        match = re.search(r"/video/(\d+)", url)
        return match.group(1) if match else ""

    def _close_detail(self, page: Page, *, navigated: bool) -> None:
        if navigated:
            page.go_back()
        else:
            close_button = utils.resolve(page, selectors.VIDEO_DETAIL_CLOSE_BUTTON, timeout_ms=2000)
            if close_button is not None:
                try:
                    close_button.first.click(timeout=2000)
                except Exception:  # noqa: BLE001 - fall back to Escape below
                    page.keyboard.press("Escape")
            else:
                page.keyboard.press("Escape")
        utils.resolve(page, selectors.VIDEO_CARD, timeout_ms=config.DEFAULT_TIMEOUT_MS)
