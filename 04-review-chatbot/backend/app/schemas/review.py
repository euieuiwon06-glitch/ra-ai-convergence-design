from pydantic import BaseModel, Field


class ReviewSubmitRequest(BaseModel):
    content: str = Field(..., min_length=5, max_length=1000)


class ReviewSegmentOut(BaseModel):
    segment_no: int
    text: str
    category: str
    tone: str  # 긍정 / 부정


class ReviewSubmitResponse(BaseModel):
    review_id: str
    content: str
    status: str  # saved | previewed | manual_review_needed
    segments: list[ReviewSegmentOut] = []
    # 신뢰도(%) 패치: 세그먼트 카테고리/톤(Q&A 매칭용)과 별개로, 리뷰 전체에 대해
    # GPT/Claude/Gemini 긍정확률(%) 평균으로 판단한 결과 — 결과 카드 표시용.
    sentiment_final: str  # 긍정 / 부정 / 판단보류
    confidence_scores: dict[str, int]  # 재시도까지 실패한 모델은 빠짐, 예: {"gpt": 82, "claude": 75}
    avg_confidence: int  # 0~100
    model_count: int  # 평균에 반영된 모델 수 (2 또는 3)
    topic_tags: list[str] = []  # 확정된 세그먼트 카테고리 목록(중복 제거)
    saved: bool
    message: str  # 사용자에게 보여줄 한 줄 피드백
