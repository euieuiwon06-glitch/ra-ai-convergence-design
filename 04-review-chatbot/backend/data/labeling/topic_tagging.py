"""1-3: 리뷰-토픽 태깅.

톤 판단과 달리 다수결까지는 필요 없고(지시서 1-3), 비용을 고려해 가장 저렴한 모델
하나로만 처리한다. 여기서는 gpt-4o-mini를 기본값으로 쓴다 — majority_vote.py가 이미
openai 패키지를 의존성으로 가지고 있어서 별도 SDK를 추가하지 않아도 된다.
"""

from __future__ import annotations

import os
from typing import Callable

from app.qa.topics import TOPIC_KEYWORDS

ALLOWED_TOPICS = tuple(TOPIC_KEYWORDS.keys())

_TAGGING_PROMPT = (
    "다음은 스터디카페 리뷰다. 이 리뷰가 언급하는 주제를 아래 목록에서 골라 콤마로만 "
    "구분해서 답하라(해당 없으면 빈 문자열). 목록 밖의 단어는 절대 쓰지 마라.\n"
    f"목록: {', '.join(ALLOWED_TOPICS)}\n\n"
    "리뷰: {content}"
)

TopicClassifier = Callable[[str], str]


def _default_topic_classifier(content: str) -> str:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY 환경변수가 없습니다.")
    from openai import OpenAI

    client = OpenAI(api_key=api_key)
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": _TAGGING_PROMPT.format(content=content)}],
        temperature=0,
    )
    return resp.choices[0].message.content or ""


def parse_topics(raw: str) -> list[str]:
    candidates = [t.strip() for t in raw.replace("、", ",").split(",")]
    seen: list[str] = []
    for topic in candidates:
        if topic in ALLOWED_TOPICS and topic not in seen:
            seen.append(topic)
    return seen


def tag_topics(content: str, classifier: TopicClassifier = _default_topic_classifier) -> list[str]:
    raw = classifier(content)
    return parse_topics(raw)
