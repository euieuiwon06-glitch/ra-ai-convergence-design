import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from app.config import DB_PATH


def get_connection(db_path: Optional[Path] = None) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path or DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


@dataclass
class Review:
    review_id: str
    store_name: str
    content: str
    review_date: Optional[str]
    source_url: Optional[str]
    sentiment_final: Optional[str]
    topic_tags: Optional[str]
    is_user_submitted: bool
    avg_confidence: Optional[int] = None

    @property
    def topics(self) -> list[str]:
        return [t for t in (self.topic_tags or "").split(",") if t]

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> "Review":
        return cls(
            review_id=row["review_id"],
            store_name=row["store_name"],
            content=row["content"],
            review_date=row["review_date"],
            source_url=row["source_url"],
            sentiment_final=row["sentiment_final"],
            topic_tags=row["topic_tags"],
            is_user_submitted=bool(row["is_user_submitted"]),
            avg_confidence=row["avg_confidence"],
        )


def insert_review(
    conn: sqlite3.Connection,
    *,
    review_id: str,
    store_name: str,
    content: str,
    review_date: Optional[str] = None,
    source_url: Optional[str] = None,
    sentiment_gpt: Optional[str] = None,
    sentiment_claude: Optional[str] = None,
    sentiment_gemini: Optional[str] = None,
    sentiment_final: Optional[str] = None,
    topic_tags: Optional[str] = None,
    is_user_submitted: bool = False,
    confidence_gpt: Optional[int] = None,
    confidence_claude: Optional[int] = None,
    confidence_gemini: Optional[int] = None,
    avg_confidence: Optional[int] = None,
    confidence_model_count: Optional[int] = None,
) -> None:
    conn.execute(
        """
        INSERT INTO reviews (
            review_id, store_name, content, review_date, source_url,
            sentiment_gpt, sentiment_claude, sentiment_gemini, sentiment_final,
            topic_tags, is_user_submitted,
            confidence_gpt, confidence_claude, confidence_gemini,
            avg_confidence, confidence_model_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(review_id) DO UPDATE SET
            content=excluded.content,
            sentiment_gpt=excluded.sentiment_gpt,
            sentiment_claude=excluded.sentiment_claude,
            sentiment_gemini=excluded.sentiment_gemini,
            sentiment_final=excluded.sentiment_final,
            topic_tags=excluded.topic_tags,
            confidence_gpt=excluded.confidence_gpt,
            confidence_claude=excluded.confidence_claude,
            confidence_gemini=excluded.confidence_gemini,
            avg_confidence=excluded.avg_confidence,
            confidence_model_count=excluded.confidence_model_count
        """,
        (
            review_id,
            store_name,
            content,
            review_date,
            source_url,
            sentiment_gpt,
            sentiment_claude,
            sentiment_gemini,
            sentiment_final,
            topic_tags,
            int(is_user_submitted),
            confidence_gpt,
            confidence_claude,
            confidence_gemini,
            avg_confidence,
            confidence_model_count,
        ),
    )
    conn.commit()


def insert_pending(conn: sqlite3.Connection, review_id: str, reason: str = "3-way split") -> None:
    conn.execute(
        "INSERT OR REPLACE INTO pending_reviews (review_id, reason) VALUES (?, ?)",
        (review_id, reason),
    )
    conn.commit()


def get_review_by_id(conn: sqlite3.Connection, review_id: str) -> Optional[Review]:
    row = conn.execute("SELECT * FROM reviews WHERE review_id = ?", (review_id,)).fetchone()
    return Review.from_row(row) if row else None


@dataclass
class ReviewSegment:
    """review_segments 한 행 + 원본 리뷰(reviews)에서 조인해온 필드.

    segment_text는 분류/검색 매칭에만 쓰고, 챗봇이 실제로 노출하는 원문은 항상
    review_content(= reviews.content, 분절 전 원본)다.
    """

    id: int
    review_id: str
    segment_no: int
    segment_text: str
    category: str
    tone: str
    label_source: str
    review_content: str
    review_date: Optional[str]

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> "ReviewSegment":
        return cls(
            id=row["id"],
            review_id=row["review_id"],
            segment_no=row["segment_no"],
            segment_text=row["segment_text"],
            category=row["category"],
            tone=row["tone"],
            label_source=row["label_source"],
            review_content=row["review_content"],
            review_date=row["review_date"],
        )


def insert_review_segment(
    conn: sqlite3.Connection,
    *,
    review_id: str,
    segment_no: int,
    segment_text: str,
    category: str,
    tone: str,
    label_source: str = "majority_vote",
) -> None:
    conn.execute(
        """
        INSERT INTO review_segments (
            review_id, segment_no, segment_text, category, tone, label_source
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(review_id, segment_no) DO UPDATE SET
            segment_text=excluded.segment_text,
            category=excluded.category,
            tone=excluded.tone,
            label_source=excluded.label_source
        """,
        (review_id, segment_no, segment_text, category, tone, label_source),
    )
    conn.commit()


def get_segments_by_category(
    conn: sqlite3.Connection, category: str, store_name: Optional[str] = None
) -> list[ReviewSegment]:
    """카테고리가 일치하고 톤이 확정된(긍정/부정) 세그먼트를, 원본 리뷰 원문과 함께 반환한다.

    문장 분절 패치 5-1: 매칭은 review_segments 기준, 챗봇 노출은 원본(reviews.content) 기준
    — 그래서 원본 텍스트/작성일을 여기서 함께 조인해온다.
    """
    query = (
        "SELECT s.id, s.review_id, s.segment_no, s.segment_text, s.category, s.tone, "
        "s.label_source, r.content AS review_content, r.review_date AS review_date "
        "FROM review_segments s "
        "JOIN reviews r ON r.review_id = s.review_id "
        "WHERE s.tone IN ('긍정', '부정') AND s.category = ?"
    )
    params: list = [category]
    if store_name:
        query += " AND r.store_name = ?"
        params.append(store_name)
    query += " ORDER BY s.id"
    rows = conn.execute(query, params).fetchall()
    return [ReviewSegment.from_row(r) for r in rows]
