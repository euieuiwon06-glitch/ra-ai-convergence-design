import sqlite3
import uuid

from fastapi import Depends, FastAPI, HTTPException

from app.config import STORE
from app.models.review import get_connection
from app.qa.engine import resolve_answer
from app.qa.upload import UploadResult, process_uploaded_review
from app.schemas.chat import ChatRequest, ChatResponse
from app.schemas.review import ReviewSubmitRequest, ReviewSubmitResponse
from data.labeling.confidence import ConfidenceResult, InsufficientModelResponsesError, run_confidence_vote_single

app = FastAPI(title="review-chatbot-backend")

MANUAL_REVIEW_MESSAGE = "리뷰 구조가 복잡해서 검토가 필요해요. 검토 후 반영될 예정이에요."
ANALYSIS_UNAVAILABLE_MESSAGE = "지금은 분석이 어려워요. 잠시 후 다시 시도해주세요."


def get_db():
    conn = get_connection()
    try:
        yield conn
    finally:
        conn.close()


@app.post("/chat", response_model=ChatResponse)
def chat(payload: ChatRequest, conn: sqlite3.Connection = Depends(get_db)) -> ChatResponse:
    answer = resolve_answer(payload.question, conn, payload.store_name)
    return ChatResponse(**answer)


def _topic_tags_from_segments(segments: list[dict]) -> list[str]:
    seen: list[str] = []
    for seg in segments:
        if seg["category"] not in seen:
            seen.append(seg["category"])
    return seen


def _build_review_response(result: UploadResult, confidence: ConfidenceResult) -> ReviewSubmitResponse:
    saved = result["status"] == "saved"
    topic_tags = _topic_tags_from_segments(result["segments"])

    if result["status"] == "manual_review_needed":
        message = MANUAL_REVIEW_MESSAGE
    elif confidence["final"] == "판단보류":
        verb = "저장됐어요" if saved else "미리보기예요"
        message = f"리뷰가 {verb}. 긍정 확률 평균 {confidence['avg_confidence']}%로 애매해서 검토 후 반영될 예정이에요."
    else:
        verb = "저장됐어요" if saved else "미리보기예요"
        message = f"리뷰가 {verb}. 긍정 확률 {confidence['avg_confidence']}% → {confidence['final']}으로 판단했어요."
        if topic_tags:
            message += f" 관련 토픽: {', '.join(topic_tags)}"

    return ReviewSubmitResponse(
        review_id=result["review_id"],
        content=result["content"],
        status=result["status"],
        segments=result["segments"],
        sentiment_final=confidence["final"],
        confidence_scores=confidence["scores"],
        avg_confidence=confidence["avg_confidence"],
        model_count=confidence["model_count"],
        topic_tags=topic_tags,
        saved=saved,
        message=message,
    )


@app.post("/reviews", response_model=ReviewSubmitResponse)
def submit_review(payload: ReviewSubmitRequest, conn: sqlite3.Connection = Depends(get_db)) -> ReviewSubmitResponse:
    try:
        confidence = run_confidence_vote_single(payload.content)
    except InsufficientModelResponsesError as exc:
        raise HTTPException(status_code=503, detail=ANALYSIS_UNAVAILABLE_MESSAGE) from exc

    review_id = f"r_user_{uuid.uuid4().hex[:8]}"
    result = process_uploaded_review(
        conn, review_id, payload.content, STORE["name"], persist=True, confidence=confidence
    )
    return _build_review_response(result, confidence)


@app.post("/reviews/analyze", response_model=ReviewSubmitResponse)
def analyze_review(payload: ReviewSubmitRequest) -> ReviewSubmitResponse:
    """저장 없이 미리보기만 — 분절 + 조각별 카테고리 분석과 신뢰도(%) 판단 결과만 보여준다."""
    try:
        confidence = run_confidence_vote_single(payload.content)
    except InsufficientModelResponsesError as exc:
        raise HTTPException(status_code=503, detail=ANALYSIS_UNAVAILABLE_MESSAGE) from exc

    result = process_uploaded_review(
        None, "preview", payload.content, STORE["name"], persist=False, confidence=confidence
    )
    return _build_review_response(result, confidence)


@app.get("/")
def health() -> dict:
    return {"status": "ok", "store": STORE["name"]}
