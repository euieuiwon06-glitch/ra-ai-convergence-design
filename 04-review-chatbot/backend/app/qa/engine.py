"""2-1~2-6 + 의도분기 + 문장분절 패치: 질문 -> 의도분류 -> 토픽 추출 -> 세그먼트 필터링
-> 분기 -> 답변 생성.

분기 순서:
1. LOCATION_LINK  -> 세그먼트 매칭 없이 바로 지도/리뷰 링크 응답
2. OUT_OF_SCOPE   -> "다시 물어봐주세요" + 재질문 유도
3. 토픽 추출 실패(스터디카페 얘기이긴 함) -> 정보부족
4. 질문 유형(FACTUAL/CONTEXTUAL, app/qa/topic_type.py::classify_question_type)에 따라:
   - FACTUAL: 세그먼트 1개만 있어도 답변(최신순 최대 2개 근거)
   - CONTEXTUAL: 기존 로직 그대로 — 세그먼트 3개 미만이면 정보부족, 이상이면 judge_split(7:3)

   대부분 카테고리는 통째로 한 유형이지만(운영시간=FACTUAL, 혼잡도/소음/몰입환경=CONTEXTUAL),
   "시설"은 유무 확인성 질문("콘센트 있어요?")과 품질/경험 판단 질문("직원 친절해요?")이
   섞여 있어서 카테고리가 아니라 질문에 쓰인 키워드 단위로 나눈다.

문장 분절 패치(review_segments)의 핵심 불변식: 카테고리/톤 매칭과 70:30 비율 계산은
세그먼트 개수 기준이지만, 챗봇이 사용자에게 보여주는 근거 원문은 항상 분절 전 원본
(reviews.content)이다 — 같은 원본 리뷰의 세그먼트가 여러 개 매칭되어도 근거로는 한 번만
보여준다(중복 제거).
"""

import random
import sqlite3
from typing import Optional, TypedDict

from app.config import MIN_SEGMENTS_REQUIRED, STORE
from app.models.review import ReviewSegment, get_segments_by_category
from app.qa.intent import LOCATION_LINK, OUT_OF_SCOPE, classify_intent
from app.qa.split import judge_split
from app.qa.topic_type import FACTUAL, classify_question_type
from app.qa.topics import extract_topic

INSUFFICIENT_TEXT = "아직 관련 리뷰가 3개 미만이라 답변이 어려워요."
FAIL_TEXT = "스터디카페 관련 질문으로 다시 물어봐주세요."
FAIL_EXAMPLE = '예: "주차장 있어?" "몇 시까지 열어?"'
LOCATION_TEXT_TEMPLATE = "{store} 위치와 리뷰 원문은 아래 링크에서 확인할 수 있어요."

MAX_EVIDENCE_REVIEWS = 5
MAX_FACTUAL_EVIDENCE_REVIEWS = 2


class EvidenceReview(TypedDict):
    review_id: str
    content: str
    highlight_start: int
    highlight_end: int
    date: Optional[str]


class ChatAnswer(TypedDict, total=False):
    type: str  # location_link | out_of_scope | insufficient_info | factual | confident | split
    answer: str
    badge: Optional[str]
    is_split: Optional[bool]
    pos_ratio: Optional[int]
    neg_ratio: Optional[int]
    evidence_reviews: list[EvidenceReview]
    naver_map_url: Optional[str]
    naver_review_url: Optional[str]
    example: Optional[str]
    retry: Optional[bool]


def _dedupe_by_review(segments: list[ReviewSegment]) -> list[ReviewSegment]:
    """같은 원본 리뷰에서 여러 세그먼트가 매칭돼도 원본은 한 번만 근거로 쓴다."""
    seen: set[str] = set()
    unique: list[ReviewSegment] = []
    for seg in segments:
        if seg.review_id in seen:
            continue
        seen.add(seg.review_id)
        unique.append(seg)
    return unique


def _segment_to_evidence(seg: ReviewSegment) -> EvidenceReview:
    """근거 원문은 항상 원본(reviews.content) 그대로 — segment_text는 그 안에서
    강조(볼드)할 위치를 찾는 데만 쓴다."""
    content = seg.review_content
    start = content.find(seg.segment_text)
    if start == -1:
        start, end = 0, len(content)
    else:
        end = start + len(seg.segment_text)
    return {
        "review_id": seg.review_id,
        "content": content,
        "highlight_start": start,
        "highlight_end": end,
        "date": seg.review_date,
    }


def _handle_factual(topic: str, segments: list[ReviewSegment]) -> ChatAnswer:
    if len(segments) == 0:
        if topic == "운영시간":
            # 영업시간은 리뷰로 답을 못 찾아도 링크는 항상 준다 — 네이버지도에 바로 나오는 정보라서
            return {
                "type": "insufficient_info",
                "answer": (
                    f"아직 {topic} 관련 리뷰가 없어서 정확히 답하기 어려워요. "
                    "네이버지도에서 영업시간을 바로 확인할 수 있어요."
                ),
                "naver_map_url": STORE["naver_map_url"],
                "naver_review_url": STORE["naver_review_url"],
            }
        return {
            "type": "insufficient_info",
            "answer": f"아직 {topic} 관련 리뷰가 없어서 확인이 어려워요.",
        }

    # 사실 확인성 질문이라 여러 리뷰를 종합하지 않고, 최신 리뷰 위주로 근거를 보여준다.
    unique_reviews = _dedupe_by_review(segments)
    top_reviews = sorted(unique_reviews, key=lambda s: s.review_date or "", reverse=True)[
        :MAX_FACTUAL_EVIDENCE_REVIEWS
    ]
    sample = top_reviews[0]
    tone_word = "긍정적인" if sample.tone == "긍정" else "부정적인"

    return {
        "type": "factual",
        "answer": f"{topic} 관련 가장 최근 리뷰에 따르면 {tone_word} 내용이었어요.",
        "evidence_reviews": [_segment_to_evidence(s) for s in top_reviews],
        "naver_map_url": STORE["naver_map_url"],
        "naver_review_url": STORE["naver_review_url"],
    }


def _handle_contextual(topic: str, segments: list[ReviewSegment]) -> ChatAnswer:
    pos = [s for s in segments if s.tone == "긍정"]
    neg = [s for s in segments if s.tone == "부정"]
    total = len(pos) + len(neg)  # 문장분절 패치 5-2: 세그먼트 개수 기준

    if total < MIN_SEGMENTS_REQUIRED:
        return {
            "type": "insufficient_info",
            "answer": f"아직 {topic} 관련 리뷰가 3개 미만이라 답변이 어려워요.",
        }

    judgement = judge_split(len(pos), len(neg))
    assert judgement is not None  # total > 0 이 보장됨

    if judgement["is_split"]:
        pos_pool = _dedupe_by_review(pos)
        neg_pool = _dedupe_by_review(neg)
        pos_sample = random.sample(pos_pool, min(len(pos_pool), MAX_EVIDENCE_REVIEWS))
        neg_sample = random.sample(neg_pool, min(len(neg_pool), MAX_EVIDENCE_REVIEWS))
        return {
            "type": "split",
            "answer": (
                f"{topic} 관련 리뷰 {total}개 중 의견이 갈려요. "
                f"(긍정 {judgement['pos_ratio']}% · 부정 {judgement['neg_ratio']}%, 기준 70:30)"
            ),
            "is_split": True,
            "pos_ratio": judgement["pos_ratio"],
            "neg_ratio": judgement["neg_ratio"],
            "evidence_reviews": [_segment_to_evidence(s) for s in pos_sample + neg_sample],
        }

    major_group, major_tone = (pos, "긍정") if len(pos) >= len(neg) else (neg, "부정")
    tone_word = "긍정적인" if major_tone == "긍정" else "부정적인"
    sample = random.choice(_dedupe_by_review(major_group))

    return {
        "type": "confident",
        "answer": f"{topic} 관련 리뷰 {total}개 중 {len(major_group)}개가 {tone_word} 의견이었어요.",
        "is_split": False,
        "badge": f"리뷰 {total}개 중 {len(major_group)}개 근거",
        "evidence_reviews": [_segment_to_evidence(sample)],
        "naver_map_url": STORE["naver_map_url"],
    }


def resolve_answer(
    question: str,
    conn: sqlite3.Connection,
    store_name: Optional[str] = None,
) -> ChatAnswer:
    intent = classify_intent(question)

    # 위치/링크 질문 -> 세그먼트 매칭 없이 바로 응답
    if intent == LOCATION_LINK:
        return {
            "type": "location_link",
            "answer": LOCATION_TEXT_TEMPLATE.format(store=store_name or STORE["name"]),
            "naver_map_url": STORE["naver_map_url"],
            "naver_review_url": STORE["naver_review_url"],
        }

    # 스터디카페와 무관한 질문 -> 재질문 유도
    if intent == OUT_OF_SCOPE:
        return {"type": "out_of_scope", "answer": FAIL_TEXT, "example": FAIL_EXAMPLE, "retry": True}

    topic = extract_topic(question)
    if topic is None:
        # 토픽은 특정하지 못했지만 스터디카페 관련 질문으로는 판단된 경우
        return {"type": "insufficient_info", "answer": INSUFFICIENT_TEXT}

    segments = get_segments_by_category(conn, topic, store_name)
    question_type = classify_question_type(question, topic)

    if question_type == FACTUAL:
        return _handle_factual(topic, segments)
    return _handle_contextual(topic, segments)
