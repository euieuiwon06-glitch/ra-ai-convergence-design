from typing import Optional

from pydantic import BaseModel

from app.config import STORE


class ChatRequest(BaseModel):
    question: str
    store_name: str = STORE["name"]


class EvidenceReview(BaseModel):
    review_id: str
    content: str
    highlight_start: int
    highlight_end: int
    date: Optional[str] = None


class ChatResponse(BaseModel):
    type: str  # location_link | out_of_scope | insufficient_info | factual | confident | split
    answer: str
    is_split: Optional[bool] = None
    pos_ratio: Optional[int] = None
    neg_ratio: Optional[int] = None
    badge: Optional[str] = None
    evidence_reviews: list[EvidenceReview] = []
    naver_map_url: Optional[str] = None
    naver_review_url: Optional[str] = None
    example: Optional[str] = None
    retry: Optional[bool] = None
