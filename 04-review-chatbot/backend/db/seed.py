"""문장 분절 패치(v2)의 92문장 시드 데이터를 reviews + review_segments에 삽입한다.

원본 문장(original_text)은 reviews.content에 그대로 저장하고(source_text, 절대 수정 금지),
분절 조각은 review_segments에 저장한다 — 조각(segment) 단위로 GPT/Claude/Gemini 3모델
교차검증까지 마친 데이터라 label_source='majority_vote_segment'로 넣는다(v1의 Claude
단독 판단본과 구분).

실행:
    python -m db.seed
"""

import json
from pathlib import Path
from typing import Optional

from app.config import STORE
from app.models.review import get_connection, insert_review, insert_review_segment

SEED_PATH = Path(__file__).resolve().parent / "seed_data" / "segmented_reviews.json"


def seed(db_path: Optional[Path] = None) -> int:
    entries = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    conn = get_connection(db_path)
    try:
        for entry in entries:
            review_id = str(entry["review_id"])
            insert_review(
                conn,
                review_id=review_id,
                store_name=STORE["name"],
                content=entry["original_text"],
            )
            for seg in entry["segments"]:
                insert_review_segment(
                    conn,
                    review_id=review_id,
                    segment_no=seg["segment_no"],
                    segment_text=seg["text"],
                    category=seg["category"],
                    tone=seg["tone"],
                    label_source="majority_vote_segment",
                )
    finally:
        conn.close()
    return len(entries)


def main() -> None:
    from app.config import DB_PATH

    count = seed(DB_PATH)
    print(f"[seed] 리뷰 {count}개 + 분절 세그먼트 시드 삽입 완료 -> {DB_PATH}")


if __name__ == "__main__":
    main()
