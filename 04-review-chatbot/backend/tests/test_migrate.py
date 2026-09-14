import sqlite3
from pathlib import Path

from db.migrate import migrate


def test_migrate_creates_expected_tables(tmp_path: Path):
    db_path = tmp_path / "reviews.db"
    migrate(db_path)

    conn = sqlite3.connect(db_path)
    try:
        tables = {
            row[0]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        }
        assert "reviews" in tables
        assert "pending_reviews" in tables
        assert "review_segments" in tables

        review_columns = {row[1] for row in conn.execute("PRAGMA table_info(reviews)").fetchall()}
        assert review_columns == {
            "review_id",
            "store_name",
            "content",
            "review_date",
            "source_url",
            "sentiment_gpt",
            "sentiment_claude",
            "sentiment_gemini",
            "sentiment_final",
            "topic_tags",
            "is_user_submitted",
            "confidence_gpt",
            "confidence_claude",
            "confidence_gemini",
            "avg_confidence",
            "confidence_model_count",
            "created_at",
        }

        segment_columns = {row[1] for row in conn.execute("PRAGMA table_info(review_segments)").fetchall()}
        assert segment_columns == {
            "id",
            "review_id",
            "segment_no",
            "segment_text",
            "category",
            "tone",
            "label_source",
        }
    finally:
        conn.close()


def test_migrate_is_idempotent(tmp_path: Path):
    db_path = tmp_path / "reviews.db"
    migrate(db_path)
    migrate(db_path)  # 두 번 실행해도 에러 없이 통과해야 한다
