import sqlite3

from app.config import STORE
from app.models.review import insert_review, insert_review_segment
from app.qa.engine import resolve_answer
from app.qa.split import judge_split


def _seed(
    conn: sqlite3.Connection,
    topic: str,
    pos: int,
    neg: int,
    prefix: str,
    dates: list[str] | None = None,
) -> None:
    """review + review_segments를 함께 심는다(문장 분절 패치 이후 매칭은 segment 기준)."""
    dates = dates or []
    for i in range(pos):
        review_id = f"{prefix}-pos-{i}"
        content = f"{topic} 관련 긍정 리뷰 {i}"
        insert_review(
            conn,
            review_id=review_id,
            store_name=STORE["name"],
            content=content,
            review_date=dates[i] if i < len(dates) else None,
        )
        insert_review_segment(
            conn, review_id=review_id, segment_no=1, segment_text=content, category=topic, tone="긍정"
        )
    for i in range(neg):
        review_id = f"{prefix}-neg-{i}"
        content = f"{topic} 관련 부정 리뷰 {i}"
        insert_review(conn, review_id=review_id, store_name=STORE["name"], content=content)
        insert_review_segment(
            conn, review_id=review_id, segment_no=1, segment_text=content, category=topic, tone="부정"
        )


# ---------------------------------------------------------------------------
# LOCATION_LINK — 리뷰 매칭을 완전히 우회해야 한다
# ---------------------------------------------------------------------------
def test_location_question_bypasses_review_matching(conn: sqlite3.Connection):
    result = resolve_answer("위치가 어디야?", conn)  # DB가 비어 있어도 답변 가능해야 함

    assert result["type"] == "location_link"
    assert result["naver_map_url"] == STORE["naver_map_url"]
    assert result["naver_review_url"] == STORE["naver_review_url"]


def test_review_source_link_question_is_location_link(conn: sqlite3.Connection):
    result = resolve_answer("리뷰 원문 볼 사이트 보여줘", conn)
    assert result["type"] == "location_link"


# ---------------------------------------------------------------------------
# OUT_OF_SCOPE
# ---------------------------------------------------------------------------
def test_out_of_scope_question(conn: sqlite3.Connection):
    result = resolve_answer("오늘 날씨 어때", conn)
    assert result["type"] == "out_of_scope"
    assert result["answer"] == "스터디카페 관련 질문으로 다시 물어봐주세요."
    assert result["retry"] is True
    assert result["example"]


# ---------------------------------------------------------------------------
# 토픽 자체를 못 찾은 경우 (관련은 있어 보이지만 특정 토픽이 없음)
# ---------------------------------------------------------------------------
def test_insufficient_info_when_no_specific_topic_but_relevant(conn: sqlite3.Connection):
    result = resolve_answer("여기 스터디카페 어때", conn)
    assert result["type"] == "insufficient_info"


# ---------------------------------------------------------------------------
# FACTUAL(시설/운영시간) — 세그먼트 1개만 있어도 답변 가능해야 한다
# ---------------------------------------------------------------------------
def test_factual_question_answers_with_one_review(conn: sqlite3.Connection):
    _seed(conn, "시설", pos=1, neg=0, prefix="f1")
    result = resolve_answer("주차장 있어?", conn)  # "주차"는 시설 카테고리로 묶인다

    assert result["type"] == "factual"
    assert len(result["evidence_reviews"]) == 1
    assert result["naver_map_url"] == STORE["naver_map_url"]
    assert result["naver_review_url"] == STORE["naver_review_url"]


def test_factual_question_insufficient_when_zero_reviews(conn: sqlite3.Connection):
    result = resolve_answer("콘센트 있어?", conn)
    assert result["type"] == "insufficient_info"
    assert "시설" in result["answer"]
    assert "naver_map_url" not in result  # 시설은 정보 없으면 링크 없이 정직하게 정보부족


def test_operating_hours_insufficient_still_includes_naver_link(conn: sqlite3.Connection):
    # 위치/영업시간은 답을 못 찾아도 항상 네이버지도 링크를 준다
    result = resolve_answer("몇 시까지 해요?", conn)
    assert result["type"] == "insufficient_info"
    assert result["naver_map_url"] == STORE["naver_map_url"]
    assert result["naver_review_url"] == STORE["naver_review_url"]
    assert "네이버지도" in result["answer"]


def test_factual_uses_up_to_two_most_recent_reviews(conn: sqlite3.Connection):
    _seed(
        conn,
        "시설",
        pos=3,
        neg=0,
        prefix="f2",
        dates=["2026-01-01", "2026-07-01", "2026-03-01"],
    )
    result = resolve_answer("사물함 있어?", conn)  # "사물함"도 시설 카테고리로 묶인다

    assert result["type"] == "factual"
    evidence_dates = [e["date"] for e in result["evidence_reviews"]]
    assert len(evidence_dates) == 2
    assert evidence_dates == ["2026-07-01", "2026-03-01"]  # 최신순 상위 2개


def test_facility_category_splits_fact_and_context_questions_by_keyword(conn: sqlite3.Connection):
    """같은 "시설" 카테고리라도 유무 확인 질문은 1개로 충분하고, 품질/경험 질문은
    3개 미만이면 정보부족이어야 한다 — 카테고리가 아니라 질문 단위 분기 확인."""
    _seed(conn, "시설", pos=1, neg=0, prefix="mixed")

    fact_result = resolve_answer("콘센트 있어요?", conn)
    assert fact_result["type"] == "factual"  # 유무 확인 -> 세그먼트 1개로 충분

    context_result = resolve_answer("직원분들 친절해요?", conn)
    assert context_result["type"] == "insufficient_info"  # 품질 판단 -> 3개 미만은 정보부족
    assert "3개 미만" in context_result["answer"]


# ---------------------------------------------------------------------------
# CONTEXTUAL(소음 등) — 기존 3개 미만/70:30 로직 그대로, 세그먼트 개수 기준
# ---------------------------------------------------------------------------
def test_contextual_question_needs_three_reviews(conn: sqlite3.Connection):
    _seed(conn, "소음", pos=1, neg=1, prefix="c1")  # total 2 < 3
    result = resolve_answer("여기 조용해?", conn)

    assert result["type"] == "insufficient_info"
    assert "소음" in result["answer"]
    assert "3개 미만" in result["answer"]


def test_contextual_split_when_ratio_is_within_70_30(conn: sqlite3.Connection):
    _seed(conn, "소음", pos=5, neg=3, prefix="c2")  # 5:3 -> min ratio 0.375 > 0.3
    result = resolve_answer("여기 조용해?", conn)
    expected = judge_split(5, 3)

    assert result["type"] == "split"
    assert result["is_split"] is True
    assert result["pos_ratio"] == expected["pos_ratio"]
    assert result["neg_ratio"] == expected["neg_ratio"]
    assert len(result["evidence_reviews"]) == 8


def test_contextual_confident_when_majority_clears_70_30(conn: sqlite3.Connection):
    _seed(conn, "소음", pos=4, neg=0, prefix="c3")
    result = resolve_answer("여기 조용해?", conn)

    assert result["type"] == "confident"
    assert result["is_split"] is False
    assert result["badge"] == "리뷰 4개 중 4개 근거"
    assert len(result["evidence_reviews"]) == 1
    assert result["naver_map_url"] == STORE["naver_map_url"]

    evidence = result["evidence_reviews"][0]
    content = evidence["content"]
    assert 0 <= evidence["highlight_start"] <= evidence["highlight_end"] <= len(content)


def test_evidence_content_is_always_full_review_not_segment_fragment(conn: sqlite3.Connection):
    """세그먼트 텍스트가 아니라 원본(reviews.content)이 근거로 노출돼야 한다."""
    review_id = "seg-1"
    original = "조명이 눈이 안 아프고 집중이 잘된다"
    insert_review(conn, review_id=review_id, store_name=STORE["name"], content=original)
    insert_review_segment(
        conn, review_id=review_id, segment_no=1, segment_text="조명이 눈이 안 아프다", category="시설", tone="긍정"
    )
    insert_review_segment(
        conn, review_id=review_id, segment_no=2, segment_text="집중이 잘된다", category="몰입환경", tone="긍정"
    )
    # 의견갈림(split) 분기로 유도 — pos/neg 풀 크기를 5 이하로 맞춰서 random.sample이
    # 전부(순서만 무작위로) 반환하게 하면, seg-1이 근거에 반드시 포함되어 테스트가 결정적이다.
    for i in range(3):
        pos_id = f"seg-pos-fill-{i}"
        insert_review(conn, review_id=pos_id, store_name=STORE["name"], content=f"몰입환경 긍정 채우기 {i}")
        insert_review_segment(
            conn, review_id=pos_id, segment_no=1, segment_text=f"몰입환경 긍정 채우기 {i}", category="몰입환경", tone="긍정"
        )
    for i in range(2):
        neg_id = f"seg-neg-fill-{i}"
        insert_review(conn, review_id=neg_id, store_name=STORE["name"], content=f"몰입환경 부정 채우기 {i}")
        insert_review_segment(
            conn, review_id=neg_id, segment_no=1, segment_text=f"몰입환경 부정 채우기 {i}", category="몰입환경", tone="부정"
        )

    result = resolve_answer("여기 집중 잘돼?", conn)

    assert result["type"] == "split"  # pos 4 : neg 2 -> min ratio 0.333 > 0.3
    matched = next(e for e in result["evidence_reviews"] if e["review_id"] == review_id)
    assert matched["content"] == original  # segment_text("집중이 잘된다")가 아니라 원문 전체
    assert matched["content"][matched["highlight_start"] : matched["highlight_end"]] == "집중이 잘된다"
