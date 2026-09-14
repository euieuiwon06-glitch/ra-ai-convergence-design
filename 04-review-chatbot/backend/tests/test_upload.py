import sqlite3

from app.config import STORE
from app.models.review import get_segments_by_category, get_review_by_id
from app.qa.upload import process_uploaded_review


def _confirmed_classifiers(segments: list[dict]):
    fn = lambda content: segments  # noqa: E731
    return (fn, fn, fn)


def _mismatched_classifiers():
    one = lambda content: [{"text": content, "category": "시설", "tone": "긍정"}]  # noqa: E731
    two = lambda content: [  # noqa: E731
        {"text": "조각1", "category": "시설", "tone": "긍정"},
        {"text": "조각2", "category": "몰입환경", "tone": "긍정"},
    ]
    return (one, two, one)


def test_process_uploaded_review_persists_when_confirmed(conn: sqlite3.Connection):
    segments = [{"text": "콘센트가 넉넉해요", "category": "시설", "tone": "긍정"}]
    result = process_uploaded_review(
        conn, "u-1", "콘센트가 넉넉해요", STORE["name"], persist=True, classifiers=_confirmed_classifiers(segments)
    )

    assert result["status"] == "saved"
    review = get_review_by_id(conn, "u-1")
    assert review is not None
    assert review.content == "콘센트가 넉넉해요"
    assert review.is_user_submitted is True

    stored = get_segments_by_category(conn, "시설")
    assert any(s.review_id == "u-1" for s in stored)


def test_process_uploaded_review_preview_does_not_persist(conn: sqlite3.Connection):
    segments = [{"text": "콘센트가 넉넉해요", "category": "시설", "tone": "긍정"}]
    result = process_uploaded_review(
        None, "preview", "콘센트가 넉넉해요", STORE["name"], persist=False, classifiers=_confirmed_classifiers(segments)
    )

    assert result["status"] == "previewed"
    assert result["segments"][0]["category"] == "시설"


def test_process_uploaded_review_manual_review_needed_does_not_persist(conn: sqlite3.Connection):
    result = process_uploaded_review(
        conn, "u-2", "조명이 눈이 안 아프고 집중이 잘된다", STORE["name"], persist=True, classifiers=_mismatched_classifiers()
    )

    assert result["status"] == "manual_review_needed"
    assert result["reason"] == "분절 개수 불일치"
    assert get_review_by_id(conn, "u-2") is None  # 확정 못했으니 저장도 안 한다
