"""문장 분절 + 조각(segment) 단위 3-LLM 교차검증 (segmentation 패치 섹션 6 + v2).

유저가 "내 리뷰 추가하기"로 올린 리뷰도 92개 시드 리뷰와 같은 파이프라인을 타게 한다:
GPT/Claude/Gemini에게 동일한 규칙으로 분절 + 카테고리/톤 분류를 맡기고,
- 3개 모델의 분절 "개수"가 다르면 사람 검토가 필요하다고 보고 확정하지 않는다.
- 개수가 같으면 조각별로 카테고리/톤을 다수결로 정한다(조각 텍스트는 기준 모델 것을 쓴다).
- 어느 한 조각이라도 카테고리나 톤이 3-way(전부 다름)로 갈리면, 리뷰 전체를 확정하지
  않고 사람 검토로 넘긴다 — 리뷰 일부만 반쯤 확정된 채로 저장하지 않기 위해서다
  (지시서 pseudocode는 그런 조각만 "판단보류" 문자열로 채워 넣지만, DB에 사실상 매칭
  안 되는 sentinel 값을 남기는 대신 리뷰 단위로 명확하게 확정/보류를 나누는 쪽을 택했다).
"""

from __future__ import annotations

import json
import os
from collections import Counter
from typing import Callable, Optional, TypedDict

from app.qa.topics import TOPIC_KEYWORDS

ALLOWED_CATEGORIES = tuple(TOPIC_KEYWORDS.keys())
VALID_TONES = ("긍정", "부정")

SEGMENTATION_PROMPT = """\
아래 리뷰 문장을 다음 규칙에 따라 의미 단위로 분절하고, 각 조각을 분류해줘.

[분절 규칙]
- 핵심 원칙: 한 문장 안에 서로 다른 질문에 답할 수 있는 정보가 2개 이상 있으면 그 지점에서 자른다.
- 뒷조각이 "좋다/별로다" 같은 일반 감상어뿐이고 앞조각과 같은 대상이면 자르지 않는다.
- 앞조각이 평가 없는 단순 정황 설명이면 자르지 않는다.
- 뒷조각이 앞조각 없이 의미가 안 통하면 자르지 않는다.
- 두 조각이 동어반복이면 자르지 않는다.

[카테고리] {categories} 중 하나
[톤] 긍정 / 부정 중 하나

리뷰 원문: "{review_text}"

아래 JSON 형식으로만 답해. 다른 설명 붙이지 마.
{{"segments": [{{"text": "조각1", "category": "...", "tone": "..."}}, ...]}}
"""


class SegmentDraft(TypedDict):
    text: str
    category: str
    tone: str


SegmentModelClient = Callable[[str], list[SegmentDraft]]


def _build_prompt(review_text: str) -> str:
    return SEGMENTATION_PROMPT.format(categories="/".join(ALLOWED_CATEGORIES), review_text=review_text)


def _parse_segments_response(raw: str) -> list[SegmentDraft]:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:]
    data = json.loads(cleaned)
    return [
        {"text": s["text"], "category": s["category"], "tone": s["tone"]} for s in data["segments"]
    ]


def classify_segments_with_gpt(review_text: str) -> list[SegmentDraft]:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY 환경변수가 없습니다.")
    from openai import OpenAI

    client = OpenAI(api_key=api_key)
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": _build_prompt(review_text)}],
        temperature=0,
        response_format={"type": "json_object"},
    )
    return _parse_segments_response(resp.choices[0].message.content or "{}")


def classify_segments_with_claude(review_text: str) -> list[SegmentDraft]:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY 환경변수가 없습니다.")
    import anthropic

    client = anthropic.Anthropic(api_key=api_key)
    resp = client.messages.create(
        model="claude-3-5-haiku-20241022",
        max_tokens=1024,
        messages=[{"role": "user", "content": _build_prompt(review_text)}],
    )
    text = resp.content[0].text if resp.content else "{}"
    return _parse_segments_response(text)


def classify_segments_with_gemini(review_text: str) -> list[SegmentDraft]:
    api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GOOGLE_API_KEY(또는 GEMINI_API_KEY) 환경변수가 없습니다.")
    import google.generativeai as genai

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-1.5-flash")
    resp = model.generate_content(_build_prompt(review_text))
    return _parse_segments_response(resp.text or "{}")


DEFAULT_SEGMENT_CLASSIFIERS: tuple[SegmentModelClient, SegmentModelClient, SegmentModelClient] = (
    classify_segments_with_gpt,
    classify_segments_with_claude,
    classify_segments_with_gemini,
)


def majority_or_none(values: list[str]) -> Optional[str]:
    top, count = Counter(values).most_common(1)[0]
    return top if count >= 2 else None


class ConfirmedSegment(TypedDict):
    segment_no: int
    text: str
    category: str
    tone: str


class SegmentationResult(TypedDict):
    is_confirmed: bool
    segments: list[ConfirmedSegment]
    reason: Optional[str]


def cross_validate_segments(
    review_text: str,
    classifiers: tuple[SegmentModelClient, SegmentModelClient, SegmentModelClient] = DEFAULT_SEGMENT_CLASSIFIERS,
) -> SegmentationResult:
    """GPT/Claude/Gemini 3개 모델에 동일 프롬프트를 던져서 분절+분류 결과를 교차검증한다.

    분절 개수가 다르거나, 개수는 같아도 어느 조각의 카테고리/톤이 3-way로 갈리면
    `is_confirmed=False`를 반환한다(사람 검토 필요). 조각 텍스트는 Claude(두 번째
    classifier) 결과를 기준으로 쓴다 — 개수/분류가 같아도 모델마다 토씨가 다를 수 있어서다.
    """
    gpt_fn, claude_fn, gemini_fn = classifiers
    per_model = [gpt_fn(review_text), claude_fn(review_text), gemini_fn(review_text)]

    lengths = {len(segs) for segs in per_model}
    if len(lengths) != 1:
        return {"is_confirmed": False, "segments": [], "reason": "분절 개수 불일치"}

    n = lengths.pop()
    if n == 0:
        return {"is_confirmed": True, "segments": [], "reason": None}

    text_source = per_model[1]  # 기준 모델: Claude
    confirmed: list[ConfirmedSegment] = []
    for i in range(n):
        category = majority_or_none([per_model[m][i]["category"] for m in range(3)])
        tone = majority_or_none([per_model[m][i]["tone"] for m in range(3)])
        if category is None or tone is None:
            return {"is_confirmed": False, "segments": [], "reason": "조각 분류 3-way 불일치"}
        confirmed.append(
            {"segment_no": i + 1, "text": text_source[i]["text"], "category": category, "tone": tone}
        )

    return {"is_confirmed": True, "segments": confirmed, "reason": None}
