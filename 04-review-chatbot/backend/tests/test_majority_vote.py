from pathlib import Path

import pytest

from app.models.review import get_connection
from data.labeling.majority_vote import (
    LabelResult,
    label_review,
    majority_vote,
    print_progress_table,
    run_majority_vote_batch,
)


# ---------------------------------------------------------------------------
# 다수결 결정 로직 (majority_vote) — 지시서에서 가장 중요하다고 강조한 부분
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "gpt,claude,gemini,expected",
    [
        ("긍정", "긍정", "긍정", "긍정"),
        ("부정", "부정", "부정", "부정"),
        ("중립", "중립", "중립", "중립"),
        ("긍정", "긍정", "부정", "긍정"),  # 2:1 - GPT/Claude 동의
        ("긍정", "부정", "긍정", "긍정"),  # 2:1 - GPT/Gemini 동의 (순서 무관)
        ("부정", "긍정", "긍정", "긍정"),  # 2:1 - Claude/Gemini 동의
        ("긍정", "부정", "부정", "부정"),
        ("중립", "긍정", "중립", "중립"),
    ],
)
def test_majority_vote_two_agree_wins(gpt, claude, gemini, expected):
    assert majority_vote(gpt, claude, gemini) == expected


@pytest.mark.parametrize(
    "gpt,claude,gemini",
    [
        ("긍정", "부정", "중립"),
        ("부정", "긍정", "중립"),
        ("중립", "부정", "긍정"),
    ],
)
def test_majority_vote_all_three_different_is_pending(gpt, claude, gemini):
    assert majority_vote(gpt, claude, gemini) == "판단보류"


def test_label_review_uses_injected_classifiers_and_computes_final():
    classifiers = (lambda c: "긍정", lambda c: "긍정", lambda c: "부정")
    result = label_review("r_1", "좋아요", classifiers=classifiers)

    assert result.sentiment_gpt == "긍정"
    assert result.sentiment_claude == "긍정"
    assert result.sentiment_gemini == "부정"
    assert result.sentiment_final == "긍정"
    assert result.is_pending is False


def test_label_review_marks_pending_when_all_three_disagree():
    classifiers = (lambda c: "긍정", lambda c: "부정", lambda c: "중립")
    result = label_review("r_2", "그저 그래요", classifiers=classifiers)

    assert result.sentiment_final == "판단보류"
    assert result.is_pending is True


def test_print_progress_table_does_not_raise(capsys):
    results = [
        LabelResult("r_1", "좋아요", "긍정", "긍정", "부정", "긍정"),
        LabelResult("r_2", "별로예요", "긍정", "부정", "중립", "판단보류"),
    ]
    print_progress_table(results)
    out = capsys.readouterr().out
    assert "r_1" in out
    assert "판단보류" in out
    assert "확정 1건" in out
    assert "판단보류 1건" in out


def test_run_majority_vote_batch_persists_to_db_and_flags_pending(tmp_path: Path):
    rows = [
        {
            "review_id": "r_100",
            "store_name": "단디스터디카페 전농점",
            "content": "자리마다 콘센트가 다 있어서 좋아요",
            "date": "2026-07-01",
            "source_url": "https://example.com/1",
        },
        {
            "review_id": "r_101",
            "store_name": "단디스터디카페 전농점",
            "content": "그럭저럭이에요",
            "date": "2026-07-02",
            "source_url": "https://example.com/2",
        },
    ]

    def make_classifier(label_by_id: dict[str, str]):
        # majority_vote.label_review는 review_id를 모델 호출 함수에 넘기지 않으므로
        # content로 구분되게 클로저를 만든다.
        def _fn(content: str) -> str:
            for row in rows:
                if row["content"] == content:
                    return label_by_id[row["review_id"]]
            raise AssertionError("unexpected content")

        return _fn

    classifiers = (
        make_classifier({"r_100": "긍정", "r_101": "긍정"}),
        make_classifier({"r_100": "긍정", "r_101": "부정"}),
        make_classifier({"r_100": "부정", "r_101": "중립"}),
    )

    db_path = tmp_path / "reviews.db"
    from db.migrate import migrate

    migrate(db_path)

    results = run_majority_vote_batch(rows, db_path=db_path, classifiers=classifiers)

    assert results[0].sentiment_final == "긍정"
    assert results[1].sentiment_final == "판단보류"

    conn = get_connection(db_path)
    try:
        row_100 = conn.execute("SELECT * FROM reviews WHERE review_id = ?", ("r_100",)).fetchone()
        row_101 = conn.execute("SELECT * FROM reviews WHERE review_id = ?", ("r_101",)).fetchone()
        pending = conn.execute("SELECT * FROM pending_reviews WHERE review_id = ?", ("r_101",)).fetchone()

        assert row_100["sentiment_final"] == "긍정"
        assert row_101["sentiment_final"] == "판단보류"
        assert pending is not None
        assert conn.execute("SELECT * FROM pending_reviews WHERE review_id = ?", ("r_100",)).fetchone() is None
    finally:
        conn.close()
