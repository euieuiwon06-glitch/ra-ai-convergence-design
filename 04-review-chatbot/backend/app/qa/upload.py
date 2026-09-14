"""내 리뷰 추가하기 업로드 플로우 (문장 분절 패치 v2).

`run_majority_vote_single()`(리뷰 전체를 통째로 톤 분류하던 v1 방식)은 분절 개념이 생기기
전에 작성된 함수라 폐기했다. 이제 유저가 올리는 리뷰도 92개 시드 리뷰와 동일한
파이프라인(분절 -> 조각별 GPT/Claude/Gemini 교차검증)을 탄다 — 그래야 기존 데이터와
일관성이 생긴다.
"""

import sqlite3
from typing import Optional, TypedDict

from app.models.review import insert_review, insert_review_segment
from data.labeling.confidence import ConfidenceResult
from data.labeling.segmentation import (
    ConfirmedSegment,
    DEFAULT_SEGMENT_CLASSIFIERS,
    SegmentModelClient,
    cross_validate_segments,
)


class UploadResult(TypedDict):
    status: str  # saved | previewed | manual_review_needed
    review_id: str
    content: str
    segments: list[ConfirmedSegment]
    reason: Optional[str]


def process_uploaded_review(
    conn: Optional[sqlite3.Connection],
    review_id: str,
    content: str,
    store_name: str,
    *,
    persist: bool,
    classifiers: tuple[SegmentModelClient, SegmentModelClient, SegmentModelClient] = DEFAULT_SEGMENT_CLASSIFIERS,
    confidence: Optional[ConfidenceResult] = None,
) -> UploadResult:
    """리뷰 1건을 분절 + 3모델 교차검증하고, persist=True면 reviews/review_segments에 저장한다.

    persist=False(POST /reviews/analyze 미리보기)면 DB에 아무것도 쓰지 않고 분석 결과만
    돌려준다. 분절 개수가 모델 간 다르거나 어느 조각의 카테고리/톤이 3-way로 갈리면
    확정하지 않고 "manual_review_needed"를 반환한다 — 이 경우도 아무것도 저장하지 않는다
    (사람이 검토해서 확정한 뒤 별도로 반영).

    `confidence`(data.labeling.confidence.run_confidence_vote_single 결과)를 넘기면
    reviews 테이블의 confidence_* 컬럼에 함께 저장한다 — 세그먼트 카테고리/톤(Q&A 매칭용)과
    별개로, "내 리뷰 추가하기" 결과 카드에 보여줄 리뷰 전체의 긍정확률 판단이다.
    """
    result = cross_validate_segments(content, classifiers)

    if not result["is_confirmed"]:
        return {
            "status": "manual_review_needed",
            "review_id": review_id,
            "content": content,
            "segments": [],
            "reason": result["reason"],
        }

    if persist:
        assert conn is not None
        insert_review(
            conn,
            review_id=review_id,
            store_name=store_name,
            content=content,
            is_user_submitted=True,
            confidence_gpt=confidence["scores"].get("gpt") if confidence else None,
            confidence_claude=confidence["scores"].get("claude") if confidence else None,
            confidence_gemini=confidence["scores"].get("gemini") if confidence else None,
            avg_confidence=confidence["avg_confidence"] if confidence else None,
            confidence_model_count=confidence["model_count"] if confidence else None,
        )
        for seg in result["segments"]:
            insert_review_segment(
                conn,
                review_id=review_id,
                segment_no=seg["segment_no"],
                segment_text=seg["text"],
                category=seg["category"],
                tone=seg["tone"],
                label_source="majority_vote_segment",
            )
        status = "saved"
    else:
        status = "previewed"

    return {"status": status, "review_id": review_id, "content": content, "segments": result["segments"], "reason": None}
