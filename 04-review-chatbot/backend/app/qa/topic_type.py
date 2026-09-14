"""FACTUAL(사실형) vs CONTEXTUAL(맥락형) 질문 유형 판단.

FACTUAL: 시설/운영정보 유무 확인처럼 리뷰 1개만 있어도 답변 가능한 사실 확인성 질문.
CONTEXTUAL: 이용 경험/주관적 평가를 여러 리뷰로 종합해야 답할 수 있는 질문 — 기존
judge_split(7:3) 로직이 그대로 적용된다.

혼잡도/소음/몰입환경/운영시간은 카테고리 전체가 한 가지 유형이라 카테고리만 보고 정하면
되지만, "시설"은 유무 확인성 질문("콘센트 있어요?")과 품질/경험 판단이 필요한 질문
("직원분들 친절해요?", "청소 잘 되나요?")이 섞여 있다. 그래서 "시설"만은 카테고리 단위가
아니라 질문에 실제로 쓰인 키워드 단위로 사실형/맥락형을 나눈다.
"""

from app.qa.topics import _norm

FACTUAL = "FACTUAL"
CONTEXTUAL = "CONTEXTUAL"

# 카테고리 전체가 한 가지 유형인 경우의 기본값. "시설"은 여기 없다 — 아래
# FACILITY_FACT_KEYWORDS/FACILITY_CONTEXT_KEYWORDS로 질문 단위 판단.
TOPIC_TYPE_MAP: dict[str, str] = {
    "운영시간": FACTUAL,
    "혼잡도": CONTEXTUAL,
    "소음": CONTEXTUAL,
    "몰입환경": CONTEXTUAL,
}

# "시설" 카테고리 안에서 유무 확인성(사실형) 키워드 — "있다/없다"로 바로 답할 수 있는 것.
# 리뷰(세그먼트) 1개만 있어도 답변 가능하다.
FACILITY_FACT_KEYWORDS = [
    "콘센트", "전원", "충전기", "충전", "주차", "주차장", "발렛", "차량",
    "사물함", "락커", "캐비닛", "짐보관", "와이파이", "wifi", "화장실",
    "프린터", "냉난방", "정수기", "엘리베이터", "편의점", "스탠드", "노트북",
    "카페형", "세미나실", "캐럴", "정기권", "1일권", "회원권", "안마의자", "모니터",
]

# "시설" 카테고리 안에서 품질/경험 판단이 필요한(맥락형) 키워드 — 3개 이상 모여야 답변.
FACILITY_CONTEXT_KEYWORDS = [
    "의자", "조명", "책상", "칸막이", "가격", "요금", "할인", "환불",
    "직원", "청소", "관리", "입구", "접근성", "시설",
]


def classify_question_type(question: str, category: str) -> str:
    """카테고리 기본값을 쓰되, "시설"만 질문에 실제로 쓰인 키워드로 사실형/맥락형을 나눈다.

    새 카테고리가 추가되면 TOPIC_TYPE_MAP에 기본값을 넣거나, "시설"처럼 사실형/맥락형이
    섞여 있으면 이 함수에 분기를 추가하면 된다.
    """
    if category != "시설":
        return TOPIC_TYPE_MAP.get(category, CONTEXTUAL)

    q = _norm(question)
    if any(_norm(kw) in q for kw in FACILITY_FACT_KEYWORDS):
        return FACTUAL
    if any(_norm(kw) in q for kw in FACILITY_CONTEXT_KEYWORDS):
        return CONTEXTUAL
    return CONTEXTUAL  # 어느 쪽인지 특정 못하면 안전하게 맥락형(3개 기준)으로 취급
