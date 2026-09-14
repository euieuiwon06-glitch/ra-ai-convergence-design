"""내 리뷰 추가하기: 긍정/부정 이분법 대신 "긍정 확률(0~100)" 평균으로 판단한다.

기존에는 GPT/Claude/Gemini가 각각 "긍정"/"부정"만 골라야 해서, 애매한 리뷰
("나쁘진 않은데 특별히 좋지도 않다")도 억지로 한쪽으로 분류됐다. 이제 각 모델이 확률을
답하게 하고 평균을 낸 뒤, Q&A 의견갈림 판단과 같은 70:30 임계값(app/qa/constants.py)으로
확정한다 — 서비스 전체에서 일관된 기준 하나를 쓰기 위해서다.

배치 레이블링(data/labeling/majority_vote.py::label_review, 리뷰 전체를 긍정/부정/중립
중 하나로 다수결하는 방식)은 계속 그대로 쓴다 — 이 모듈은 "내 리뷰 추가하기" 업로드
경로에서만 쓴다.

모델 호출 실패 정책(확정):
1. 모델 하나가 실패(타임아웃/에러 응답/파싱 실패 포함)하면 그 모델만 1회 재시도한다.
2. 재시도까지 실패하면 그 모델은 제외하고 나머지 성공한 모델들의 평균으로 진행한다.
3. 성공한 모델이 2개 미만이면(0개 또는 1개) `InsufficientModelResponsesError`를 낸다 —
   호출부(app/main.py)에서 이걸 잡아 503으로 응답하고 아무것도 저장하지 않는다.
"""

from __future__ import annotations

import logging
import os
import re
import time
from typing import Callable, Optional, TypedDict

from app.qa.constants import SPLIT_THRESHOLD_HIGH, SPLIT_THRESHOLD_LOW

logger = logging.getLogger(__name__)

CONFIDENCE_PROMPT = """\
아래 스터디카페 리뷰가 긍정적인 리뷰일 확률을 0~100 사이 정수로만 답해줘.
설명 없이 숫자만 출력해.

리뷰: "{content}"
긍정 확률(0~100):
"""

ConfidenceClassifier = Callable[[str], int]

_MODEL_NAMES = ("gpt", "claude", "gemini")
_MIN_SUCCESSFUL_MODELS = 2


class InsufficientModelResponsesError(Exception):
    """성공한 모델이 2개 미만이라 신뢰도 판단을 확정할 수 없을 때."""


def parse_confidence_int(raw: str) -> int:
    """"82" -> 82, "약 80점 정도요" -> 80, 범위를 벗어나면 0~100으로 clamp한다."""
    digits = re.sub(r"[^0-9]", "", raw)
    if not digits:
        raise ValueError(f"확률값 파싱 실패: {raw!r}")
    return max(0, min(100, int(digits)))


def call_gpt_confidence(content: str) -> int:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY 환경변수가 없습니다.")
    from openai import OpenAI

    client = OpenAI(api_key=api_key)
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": CONFIDENCE_PROMPT.format(content=content)}],
        temperature=0,
    )
    return parse_confidence_int(resp.choices[0].message.content or "")


def call_claude_confidence(content: str) -> int:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY 환경변수가 없습니다.")
    import anthropic

    client = anthropic.Anthropic(api_key=api_key)
    resp = client.messages.create(
        model="claude-3-5-haiku-20241022",
        max_tokens=8,
        messages=[{"role": "user", "content": CONFIDENCE_PROMPT.format(content=content)}],
    )
    text = resp.content[0].text if resp.content else ""
    return parse_confidence_int(text)


def call_gemini_confidence(content: str) -> int:
    api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GOOGLE_API_KEY(또는 GEMINI_API_KEY) 환경변수가 없습니다.")
    import google.generativeai as genai

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-1.5-flash")
    resp = model.generate_content(CONFIDENCE_PROMPT.format(content=content))
    return parse_confidence_int(resp.text or "")


MODEL_CALLS: dict[str, ConfidenceClassifier] = {
    "gpt": call_gpt_confidence,
    "claude": call_claude_confidence,
    "gemini": call_gemini_confidence,
}


class ConfidenceResult(TypedDict):
    scores: dict[str, int]  # 재시도까지 실패한 모델은 이 dict에서 아예 빠진다
    avg_confidence: int
    final: str  # 긍정 | 부정 | 판단보류
    model_count: int  # 평균에 반영된 모델 수 (2 또는 3) — 프론트 안내용


def call_with_retry(
    model_name: str,
    content: str,
    model_calls: dict[str, ConfidenceClassifier] = MODEL_CALLS,
    sleep_fn: Callable[[float], None] = time.sleep,
) -> Optional[int]:
    """모델 1회 재시도 포함. 최종 실패해도 예외를 던지지 않고 None을 반환한다."""
    call_fn = model_calls[model_name]
    for attempt in range(2):  # 최초 1회 + 재시도 1회 = 총 2회
        try:
            return call_fn(content)
        except Exception as exc:  # noqa: BLE001 - 실패 사유 불문하고 재시도/폴백 대상
            if attempt == 0:
                sleep_fn(1)
                continue
            logger.warning("%s 확률 판단 최종 실패: %s", model_name, exc)
            return None
    return None


def run_confidence_vote_single(
    content: str,
    model_calls: dict[str, ConfidenceClassifier] = MODEL_CALLS,
    sleep_fn: Callable[[float], None] = time.sleep,
) -> ConfidenceResult:
    """리뷰 1건에 대해 3개 LLM이 각각 긍정확률(%)을 반환하면 평균으로 최종 판단한다.

    모델 하나가 (재시도까지) 실패해도 나머지 성공한 모델들의 평균으로 계속 진행하되,
    성공한 모델이 2개 미만이면 `InsufficientModelResponsesError`를 낸다.
    """
    scores: dict[str, int] = {}
    for name in _MODEL_NAMES:
        score = call_with_retry(name, content, model_calls, sleep_fn)
        if score is not None:
            scores[name] = score

    if len(scores) < _MIN_SUCCESSFUL_MODELS:
        raise InsufficientModelResponsesError(f"성공한 모델이 {len(scores)}개뿐이라 판단 불가")

    avg = sum(scores.values()) / len(scores)
    if avg >= SPLIT_THRESHOLD_HIGH * 100:
        final = "긍정"
    elif avg <= SPLIT_THRESHOLD_LOW * 100:
        final = "부정"
    else:
        final = "판단보류"

    return {"scores": scores, "avg_confidence": round(avg), "final": final, "model_count": len(scores)}
