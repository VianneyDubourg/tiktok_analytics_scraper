"""CLI entry point: scrape TikTok Studio and export the results."""
from __future__ import annotations

import argparse
import sys
from typing import Optional

import config
import utils
from exporter import get_exporter
from scraper import TikTokStudioScraper


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="TikTok Studio analytics scraper")
    parser.add_argument(
        "--format",
        choices=["excel", "csv", "sqlite"],
        default="excel",
        help="Export format (default: excel)",
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        default=config.HEADLESS,
        help="Run Chromium headless (default follows the HEADLESS env var)",
    )
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    logger = utils.setup_logging()

    try:
        with TikTokStudioScraper(headless=args.headless) as scraper:
            videos = scraper.run()
    except Exception:
        logger.exception("Le scraping a échoué de façon inattendue")
        return 1

    if not videos:
        logger.warning("Aucune vidéo extraite, aucun export généré.")
        return 1

    exporter = get_exporter(args.format)
    exporter.export(videos)
    return 0


if __name__ == "__main__":
    sys.exit(main())
