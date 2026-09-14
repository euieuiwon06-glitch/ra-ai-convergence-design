"""1-2: 3개 LLM(GPT/Claude/Gemini) 교차검증 다수결 레이블링.

리뷰 1건마다 GPT / Claude / Gemini에게 각각 톤(긍정/부정/중립)을 판단시키고,
- 2개 이상 모델이 같은 라벨 -> 그 라벨을 sentiment_final로 확정
- 3개 모델이 전부 다르면(긍정/부정/중립 각 1개씩) -> "판단보류"로 표시하고
  pending_reviews 테이블에 모아 사람이 확인하게 한다.

CLI:
    python -m data.labeling.majority_vote --input reviews_raw.csv

재사용 가능하도록 다수결 결정 로직(`majority_vote`)과 배치 오케스트레이션
(`run_majority_vote_batch`)을 분리했고, LLM 호출 함수는 `classifiers` 인자로
주입할 수 있게 해서(기본값은 실제 GPT/Claude/Gemini 호출) 새 리뷰가 크롤링될 때마다
재사용할 수 있다.
"""

from __future__ import annotations

import argparse
import csv
import os
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

VALID_LABELS = ("긍정", "부정", "중립")
PENDING_LABEL = "판단보류"

Classifier = Callable[[str], str]


# ---------------------------------------------------------------------------
# 다수결 결정 로직 (순수 함수 — 가장 중요한 부분이라 별도로 뗀다)
# ---------------------------------------------------------------------------
def majority_vote(gpt: str, claude: str, gemini: str) -> str:
    """세 라벨 중 2개 이상 같으면 그 라벨을, 전부 다르면 "판단보류"를 반환한다."""
    labels = [gpt, claude, gemini]
    for label in VALID_LABELS:
        if labels.count(label) >= 2:
            return label
    return PENDING_LABEL


# ---------------------------------------------------------------------------
# LLM 호출 (실제 API 키가 있을 때만 동작 — 없으면 명확한 에러를 낸다)
# ---------------------------------------------------------------------------
_SENTIMENT_PROMPT = (
    "다음은 스터디카페에 대한 리뷰다. 이 리뷰의 톤을 '긍정', '부정', '중립' 중 "
    "정확히 하나의 단어로만 답하라. 다른 설명은 절대 덧붙이지 마라.\n\n"
    "리뷰: {content}"
)


def _normalize_label(raw: str) -> str:
    text = raw.strip()
    for label in VALID_LABELS:
        if label in text:
            return label
    return "중립"


def classify_with_gpt(content: str) -> str:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY 환경변수가 없습니다.")
    from openai import OpenAI

    client = OpenAI(api_key=api_key)
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": _SENTIMENT_PROMPT.format(content=content)}],
        temperature=0,
    )
    return _normalize_label(resp.choices[0].message.content or "")


def classify_with_claude(content: str) -> str:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY 환경변수가 없습니다.")
    import anthropic

    client = anthropic.Anthropic(api_key=api_key)
    resp = client.messages.create(
        model="claude-3-5-haiku-20241022",
        max_tokens=8,
        messages=[{"role": "user", "content": _SENTIMENT_PROMPT.format(content=content)}],
    )
    return _normalize_label(resp.content[0].text if resp.content else "")


def classify_with_gemini(content: str) -> str:
    api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GOOGLE_API_KEY(또는 GEMINI_API_KEY) 환경변수가 없습니다.")
    import google.generativeai as genai

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-1.5-flash")
    resp = model.generate_content(_SENTIMENT_PROMPT.format(content=content))
    return _normalize_label(resp.text or "")


DEFAULT_CLASSIFIERS: tuple[Classifier, Classifier, Classifier] = (
    classify_with_gpt,
    classify_with_claude,
    classify_with_gemini,
)


# ---------------------------------------------------------------------------
# 리뷰 1건 레이블링 + 배치 오케스트레이션
# ---------------------------------------------------------------------------
@dataclass
class LabelResult:
    review_id: str
    content: str
    sentiment_gpt: str
    sentiment_claude: str
    sentiment_gemini: str
    sentiment_final: str
    is_pending: bool = field(init=False)

    def __post_init__(self) -> None:
        self.is_pending = self.sentiment_final == PENDING_LABEL


def label_review(
    review_id: str,
    content: str,
    classifiers: tuple[Classifier, Classifier, Classifier] = DEFAULT_CLASSIFIERS,
) -> LabelResult:
    gpt_fn, claude_fn, gemini_fn = classifiers
    gpt_label = gpt_fn(content)
    claude_label = claude_fn(content)
    gemini_label = gemini_fn(content)
    final = majority_vote(gpt_label, claude_label, gemini_label)
    return LabelResult(
        review_id=review_id,
        content=content,
        sentiment_gpt=gpt_label,
        sentiment_claude=claude_label,
        sentiment_gemini=gemini_label,
        sentiment_final=final,
    )


def print_progress_table(results: list[LabelResult]) -> None:
    """교수님이 칭찬한 콘솔 표 포맷 — 계속 이 형태를 유지한다."""
    headers = ["#", "review_id", "GPT", "Claude", "Gemini", "최종"]
    rows = [
        [
            str(i + 1),
            r.review_id,
            r.sentiment_gpt,
            r.sentiment_claude,
            r.sentiment_gemini,
            r.sentiment_final,
        ]
        for i, r in enumerate(results)
    ]

    widths = [max(len(h), *(len(row[c]) for row in rows)) if rows else len(h) for c, h in enumerate(headers)]

    def fmt_row(cols: list[str]) -> str:
        return "  ".join(col.ljust(width) for col, width in zip(cols, widths))

    print(fmt_row(headers))
    print("-" * (sum(widths) + 2 * (len(widths) - 1)))
    for row in rows:
        print(fmt_row(row))

    pending_count = sum(1 for r in results if r.is_pending)
    print("-" * (sum(widths) + 2 * (len(widths) - 1)))
    print(f"총 {len(results)}건 처리 완료 · 확정 {len(results) - pending_count}건 · 판단보류 {pending_count}건")


def run_majority_vote_batch(
    rows: list[dict[str, str]],
    db_path: Optional[Path] = None,
    classifiers: tuple[Classifier, Classifier, Classifier] = DEFAULT_CLASSIFIERS,
) -> list[LabelResult]:
    """rows: reviews_raw 형식(review_id, store_name, content, date, source_url)의 리스트."""
    results = [label_review(row["review_id"], row["content"], classifiers) for row in rows]
    print_progress_table(results)

    if db_path is not None:
        _persist_results(rows, results, db_path)

    return results


def _persist_results(rows: list[dict[str, str]], results: list[LabelResult], db_path: Path) -> None:
    from app.models.review import get_connection, insert_pending, insert_review

    by_id = {row["review_id"]: row for row in rows}
    conn = get_connection(db_path)
    try:
        for result in results:
            row = by_id[result.review_id]
            insert_review(
                conn,
                review_id=result.review_id,
                store_name=row.get("store_name", ""),
                content=result.content,
                review_date=row.get("date"),
                source_url=row.get("source_url"),
                sentiment_gpt=result.sentiment_gpt,
                sentiment_claude=result.sentiment_claude,
                sentiment_gemini=result.sentiment_gemini,
                sentiment_final=result.sentiment_final,
            )
            if result.is_pending:
                insert_pending(conn, result.review_id)
    finally:
        conn.close()


def _read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def main() -> None:
    parser = argparse.ArgumentParser(description="3-LLM 다수결 리뷰 톤 레이블링 배치")
    parser.add_argument("--input", required=True, help="reviews_raw 형식 CSV 경로")
    parser.add_argument("--db", default=None, help="결과를 저장할 SQLite 경로 (기본: app.config.DB_PATH)")
    args = parser.parse_args()

    rows = _read_csv(Path(args.input))
    db_path = Path(args.db) if args.db else None
    if db_path is None:
        from app.config import DB_PATH

        db_path = DB_PATH

    run_majority_vote_batch(rows, db_path=db_path)


if __name__ == "__main__":
    main()
