"""질문 유형 분기: LOCATION_LINK / FACTUAL / CONTEXTUAL / OUT_OF_SCOPE.

`classify_intent()`는 위치/링크 질문을 키워드로 먼저 걸러낸다(LLM 호출 없이 결정적으로
LOCATION_LINK를 반환). 그 외에는 LLM 분류기를 시도하고, 키가 없거나 호출이 실패하면
기존 토픽 매칭 결과(`extract_topic` + `classify_question_type`)로 근사 판단한다.

`resolve_answer()`(app/qa/engine.py)에서는 LOCATION_LINK/OUT_OF_SCOPE만 이 분류 결과로
직접 분기하고, FACTUAL/CONTEXTUAL 여부는 실제로는 topic_type.classify_question_type이
최종 결정한다(카테고리 기본값 + "시설"은 질문 키워드 단위 세분화) — classify_intent의
역할은 "링크 질문"과 "완전히 무관한 질문"을 먼저 걸러내는 것이고, 나머지 세부 분기는
토픽 기반으로 더 정확하게 처리한다.
"""

import os
import re
import unicodedata
from typing import Callable, Optional

from app.qa.topic_type import classify_question_type
from app.qa.topics import extract_topic, is_generally_relevant

LOCATION_LINK = "LOCATION_LINK"
FACTUAL = "FACTUAL"
CONTEXTUAL = "CONTEXTUAL"
OUT_OF_SCOPE = "OUT_OF_SCOPE"
INTENTS = (LOCATION_LINK, FACTUAL, CONTEXTUAL, OUT_OF_SCOPE)

# 주의: 바로 "어디"만 넣으면 "어디가 더 조용해?" 같은 비교 질문("어디가" = 어느 쪽이)까지
# 위치 질문으로 오인한다. 그래서 "어디" 뒤에 위치를 묻는 말투가 붙는 구체적인 형태만 넣는다.
LOCATION_KEYWORDS = [
    "위치", "지도", "오시는길", "오시는 길", "원문", "링크", "사이트",
    "어디야", "어디예요", "어디에요", "어디임", "어디있", "어딘가요", "어디로", "어디쯤",
]

CLASSIFY_PROMPT = """\
사용자 질문을 다음 4개 중 하나로 분류해줘. 분류값만 출력해.

- LOCATION_LINK: 위치, 지도, 오시는 길, 리뷰 원문을 볼 수 있는 사이트/링크를 묻는 질문
- FACTUAL: 시설/서비스의 유무나 운영 정보를 묻는 질문 (예/아니오로 답 가능한 사실 확인)
  예: "주차장 있어?", "콘센트 있어?", "몇 시까지 열어?", "사물함 있어?"
- CONTEXTUAL: 이용 경험이나 주관적 평가를 종합해야 답할 수 있는 질문
  예: "집중 잘 돼?", "조용해?", "저녁에 붐벼?", "분위기 어때?"
- OUT_OF_SCOPE: 스터디카페와 무관한 질문 (날씨, 잡담 등)

질문: "{question}"
분류값만 출력:
"""

IntentClassifier = Callable[[str], str]


def _norm(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    return re.sub(r"\s+", "", text).lower()


def _has_location_keyword(question: str) -> bool:
    q = _norm(question)
    return any(_norm(kw) in q for kw in LOCATION_KEYWORDS)


def _default_llm_classifier(question: str) -> str:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY 환경변수가 없습니다.")
    from openai import OpenAI

    client = OpenAI(api_key=api_key)
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": CLASSIFY_PROMPT.format(question=question)}],
        temperature=0,
    )
    return (resp.choices[0].message.content or "").strip()


def _keyword_fallback(question: str) -> str:
    """LLM 호출 없이/실패 시 기존 토픽 매칭으로 근사 판단한다."""
    topic = extract_topic(question)
    if topic:
        return classify_question_type(question, topic)
    if is_generally_relevant(question):
        return CONTEXTUAL
    return OUT_OF_SCOPE


def classify_intent(question: str, classifier: Optional[IntentClassifier] = None) -> str:
    if _has_location_keyword(question):
        return LOCATION_LINK

    classify = classifier or _default_llm_classifier
    try:
        raw = classify(question).strip().upper()
        for intent in INTENTS:
            if intent in raw:
                return intent
    except Exception:
        pass

    return _keyword_fallback(question)
