"""2-1: 질문에서 토픽을 추출하는 로직.

카테고리는 5종(혼잡도/소음/시설/몰입환경/운영시간)으로 고정한다 — 문장 분절 패치에서
3-LLM 교차검증으로 실제 라벨링한 review_segments.category가 이 5종이기 때문에,
질문 쪽 분류기도 반드시 같은 어휘를 써야 매칭이 된다(주차/사물함/콘센트처럼 더 잘게
쪼갠 카테고리는 실제 세그먼트 데이터에 존재하지 않아 전부 "시설"로 묶는다).

실제 서비스에서는 LLM으로 토픽을 추출할 수도 있지만, 매 채팅마다 LLM 호출 비용/지연이
발생하므로 기본 구현은 키워드 기반 분류기로 두고 `extract_topic`만 교체하면 되도록
분리했다.
"""

import re
import unicodedata
from typing import Optional

TOPIC_KEYWORDS: dict[str, list[str]] = {
    "혼잡도": [
        "자리", "좌석", "붐비", "붐빔", "혼잡", "한산", "한적", "만석", "대기", "줄",
        "노쇼", "예약", "전세", "경쟁", "북적", "몰린다", "몰려", "빈자리",
    ],
    "소음": [
        "소음", "조용", "시끄", "방음", "헤드폰", "통화", "타이핑", "백색소음",
        "도로", "여닫", "에어컨소리", "대화소리", "음악", "소리",
    ],
    "시설": [
        "콘센트", "전원", "충전기", "충전", "주차", "주차장", "발렛", "차량",
        "사물함", "락커", "캐비닛", "짐보관",
        "와이파이", "wifi", "의자", "모니터", "화장실", "프린터",
        "냉난방", "정수기", "조명", "스탠드", "책상", "안마의자", "칸막이",
        "노트북", "카페형", "세미나실", "캐럴", "가격", "요금", "할인", "환불",
        "정기권", "1일권", "회원권", "직원", "청소", "관리", "입구", "엘리베이터",
        "접근성", "편의점", "시설",
    ],
    "몰입환경": [
        "인테리어", "분위기", "자연광", "산만", "향", "집중", "창가", "공간", "넓",
        "스터디그룹", "몰입", "안정감", "냄새", "문구", "골목", "안전", "무섭",
    ],
    "운영시간": [
        "24시간", "24시", "운영시간", "영업시간", "새벽", "연장",
        "명절", "자정", "365일", "오전", "심야", "할증", "마감", "몇시",
        "언제까지", "언제부터", "휴무",
    ],
}

GENERAL_RELEVANCE_KEYWORDS = sorted(
    {kw for kws in TOPIC_KEYWORDS.values() for kw in kws}
    | {"스터디카페", "스카", "카페", "이용", "대여", "회원", "리뷰"}
)


def _norm(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    return re.sub(r"\s+", "", text).lower()


def extract_topic(question: str) -> Optional[str]:
    """질문 문자열에서 가장 점수가 높은 토픽 하나를 고른다. 매칭이 없으면 None."""
    q = _norm(question)
    best_topic: Optional[str] = None
    best_score = 0

    for topic, keywords in TOPIC_KEYWORDS.items():
        score = sum(1 for kw in keywords if _norm(kw) in q)
        if score > best_score:
            best_score = score
            best_topic = topic

    return best_topic


def is_generally_relevant(question: str) -> bool:
    """토픽으로는 못 잡았지만 스터디카페 얘기이긴 한지(정보부족 vs 이해실패 분기용)."""
    q = _norm(question)
    return any(_norm(kw) in q for kw in GENERAL_RELEVANCE_KEYWORDS)
