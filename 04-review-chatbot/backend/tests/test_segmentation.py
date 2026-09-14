import sqlite3
from pathlib import Path

import pytest

from app.models.review import get_segments_by_category
from app.qa.engine import resolve_answer
from db.seed import seed


@pytest.fixture()
def seeded_conn(conn: sqlite3.Connection, db_path: Path) -> sqlite3.Connection:
    seed(db_path)
    return conn


def test_seed_inserts_92_reviews_and_114_segments(seeded_conn: sqlite3.Connection):
    review_count = seeded_conn.execute("SELECT COUNT(*) AS c FROM reviews").fetchone()["c"]
    segment_count = seeded_conn.execute("SELECT COUNT(*) AS c FROM review_segments").fetchone()["c"]
    assert review_count == 92
    assert segment_count == 114


def test_seed_uses_majority_vote_segment_label_source(seeded_conn: sqlite3.Connection):
    # v2: 조각 단위로 GPT/Claude/Gemini까지 교차검증을 마친 데이터라 v1(majority_vote)과 구분한다
    segments = get_segments_by_category(seeded_conn, "시설")
    assert all(s.label_source == "majority_vote_segment" for s in segments)


def test_segment_text_differs_from_original_when_split(seeded_conn: sqlite3.Connection):
    # review 42: "조명이 눈이 안 아프고 집중이 잘된다" -> 시설 세그먼트 + 몰입환경 세그먼트로 분절
    segments = get_segments_by_category(seeded_conn, "몰입환경")
    seg42 = next(s for s in segments if s.review_id == "42")

    assert seg42.segment_text == "집중이 잘된다"
    assert seg42.review_content == "조명이 눈이 안 아프고 집중이 잘된다"  # 원본은 그대로


def test_non_split_review_segment_equals_original(seeded_conn: sqlite3.Connection):
    # review 1: 분절 없이 원본 그대로 세그먼트 1개
    segments = get_segments_by_category(seeded_conn, "시설")
    seg1 = next(s for s in segments if s.review_id == "1")

    assert seg1.segment_text == seg1.review_content == "화장실이 좀 아쉽긴 한데ㅠ"


def test_evidence_dedupes_by_original_review_even_with_multiple_matching_segments(
    seeded_conn: sqlite3.Connection,
):
    # review 2("좌석들이 많고 멋져서 좋아요")는 시설 세그먼트가 2개다.
    # "콘센트 있어요?"는 유무 확인성(FACTUAL) 질문이라 세그먼트 id 순으로 최신
    # (=여기선 삽입 순) 2건을 고르는데, review 2가 세그먼트 2개를 갖고 있어도
    # 근거로는 한 번만 나와야 한다.
    result = resolve_answer("콘센트 있어요?", seeded_conn)

    review_ids = [e["review_id"] for e in result["evidence_reviews"]]
    assert review_ids == ["1", "2"]
    assert len(review_ids) == len(set(review_ids))
