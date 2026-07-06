"""Export pipeline: turn scraped VideoStats into on-disk reports.

``BaseExporter`` is the extension point. Adding CSV/SQLite (done below) or
later Notion/Google Sheets support means writing one more subclass here -
the scraper and ``VideoStats`` model never change.
"""
from __future__ import annotations

import sqlite3
from abc import ABC, abstractmethod
from datetime import datetime
from pathlib import Path
from typing import Sequence

import pandas as pd

import config
import utils
from models import VideoStats

logger = utils.get_logger()

VIDEO_COLUMNS = [
    "Date", "Heure", "Description", "URL", "ID", "Durée",
    "Vues", "Likes", "Commentaires", "Partages", "Favoris",
    "Watch Time", "Average Watch Time", "Completion Rate",
    "Retention", "Followers Generated", "Thumbnail",
]

_FIELD_TO_COLUMN = {
    "date": "Date",
    "time": "Heure",
    "description": "Description",
    "url": "URL",
    "video_id": "ID",
    "duration_seconds": "Durée",
    "views": "Vues",
    "likes": "Likes",
    "comments": "Commentaires",
    "shares": "Partages",
    "favorites": "Favoris",
    "watch_time_seconds": "Watch Time",
    "average_watch_time_seconds": "Average Watch Time",
    "completion_rate": "Completion Rate",
    "retention": "Retention",
    "followers_generated": "Followers Generated",
    "thumbnail_url": "Thumbnail",
}


def _videos_to_dataframe(videos: Sequence[VideoStats]) -> pd.DataFrame:
    if not videos:
        return pd.DataFrame(columns=VIDEO_COLUMNS)

    rows = []
    for video in videos:
        raw = video.to_dict()
        row = {column: raw.get(field_name) for field_name, column in _FIELD_TO_COLUMN.items()}
        # Any label discovered on the stats panel that isn't a known field
        # becomes its own column, so nothing the UI showed gets dropped.
        for key, value in video.extra_stats.items():
            row.setdefault(key, value)
        rows.append(row)

    df = pd.DataFrame(rows)
    ordered_columns = [c for c in VIDEO_COLUMNS if c in df.columns]
    extra_columns = sorted(c for c in df.columns if c not in VIDEO_COLUMNS)
    return df[ordered_columns + extra_columns]


def _build_summary(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame({"Métrique": [], "Valeur": []})

    views = df["Vues"].fillna(0)
    likes = df["Likes"].fillna(0)
    comments = df["Commentaires"].fillna(0)
    shares = df["Partages"].fillna(0)
    favorites = df["Favoris"].fillna(0)

    engagement = (likes + comments + shares + favorites) / views.replace(0, pd.NA)
    avg_engagement = engagement.mean(skipna=True)

    most_viewed = df.loc[views.idxmax(), "Description"] if views.any() else None
    most_liked = df.loc[likes.idxmax(), "Description"] if likes.any() else None

    return pd.DataFrame(
        {
            "Métrique": [
                "Nombre total de vidéos",
                "Vues totales",
                "Likes totaux",
                "Commentaires totaux",
                "Partages totaux",
                "Engagement moyen",
                "Moyenne des vues",
                "Moyenne des likes",
                "Vidéo la plus vue",
                "Vidéo avec le plus de likes",
            ],
            "Valeur": [
                len(df),
                int(views.sum()),
                int(likes.sum()),
                int(comments.sum()),
                int(shares.sum()),
                round(avg_engagement, 4) if pd.notna(avg_engagement) else None,
                round(views.mean(), 2),
                round(likes.mean(), 2),
                most_viewed,
                most_liked,
            ],
        }
    )


def _build_rankings(df: pd.DataFrame, top_n: int = config.TOP_RANKING_SIZE) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame()

    working = df.copy()
    views = working["Vues"].fillna(0)
    likes = working["Likes"].fillna(0)
    comments = working["Commentaires"].fillna(0)
    shares = working["Partages"].fillna(0)
    favorites = working["Favoris"].fillna(0)
    working["Engagement"] = (likes + comments + shares + favorites) / views.replace(0, pd.NA)

    def top(column: str, label: str) -> pd.DataFrame:
        subset = working[["Description", "URL", column]].dropna(subset=[column])
        subset = subset.sort_values(column, ascending=False).head(top_n).reset_index(drop=True)
        return subset.rename(
            columns={
                "Description": f"{label} - Description",
                "URL": f"{label} - URL",
                column: f"{label} - Valeur",
            }
        )

    return pd.concat(
        [top("Vues", "Top Vues"), top("Likes", "Top Likes"), top("Engagement", "Top Engagement")],
        axis=1,
    )


class BaseExporter(ABC):
    """Extension point: every export backend implements just `export`."""

    @abstractmethod
    def export(self, videos: Sequence[VideoStats]) -> Path:
        raise NotImplementedError


class ExcelExporter(BaseExporter):
    """Writes the 3-sheet workbook requested: videos, summary, ranking."""

    def export(self, videos: Sequence[VideoStats]) -> Path:
        df = _videos_to_dataframe(videos)
        summary = _build_summary(df)
        rankings = _build_rankings(df)

        filename = f"{config.EXPORT_FILENAME_PREFIX}_{datetime.now():%Y-%m-%d}.xlsx"
        path = config.EXPORT_FOLDER / filename

        with pd.ExcelWriter(path, engine="openpyxl") as writer:
            df.to_excel(writer, sheet_name="Toutes les vidéos", index=False)
            summary.to_excel(writer, sheet_name="Résumé", index=False)
            rankings.to_excel(writer, sheet_name="Classement", index=False)
            self._autofit_columns(writer)

        logger.info("Export Excel terminé: %s", path)
        return path

    @staticmethod
    def _autofit_columns(writer: pd.ExcelWriter) -> None:
        for worksheet in writer.sheets.values():
            for column_cells in worksheet.columns:
                max_length = max(
                    (len(str(cell.value)) for cell in column_cells if cell.value is not None),
                    default=10,
                )
                worksheet.column_dimensions[column_cells[0].column_letter].width = min(max_length + 2, 60)


class CSVExporter(BaseExporter):
    def export(self, videos: Sequence[VideoStats]) -> Path:
        df = _videos_to_dataframe(videos)
        filename = f"{config.EXPORT_FILENAME_PREFIX}_{datetime.now():%Y-%m-%d}.csv"
        path = config.EXPORT_FOLDER / filename
        df.to_csv(path, index=False)
        logger.info("Export CSV terminé: %s", path)
        return path


class SQLiteExporter(BaseExporter):
    def export(self, videos: Sequence[VideoStats]) -> Path:
        df = _videos_to_dataframe(videos)
        filename = f"{config.EXPORT_FILENAME_PREFIX}_{datetime.now():%Y-%m-%d}.db"
        path = config.EXPORT_FOLDER / filename
        with sqlite3.connect(path) as connection:
            df.to_sql("videos", connection, if_exists="replace", index=False)
        logger.info("Export SQLite terminé: %s", path)
        return path


# Future backends (Notion, Google Sheets, ...) plug in the same way:
#
#   class NotionExporter(BaseExporter):
#       def export(self, videos): ...  # push rows via the Notion API
#
# and get registered in EXPORTERS below - no scraper or model changes needed.
EXPORTERS: dict[str, type[BaseExporter]] = {
    "excel": ExcelExporter,
    "csv": CSVExporter,
    "sqlite": SQLiteExporter,
}


def get_exporter(name: str) -> BaseExporter:
    try:
        return EXPORTERS[name]()
    except KeyError as exc:
        raise ValueError(f"Format d'export inconnu: {name!r}. Options: {list(EXPORTERS)}") from exc
