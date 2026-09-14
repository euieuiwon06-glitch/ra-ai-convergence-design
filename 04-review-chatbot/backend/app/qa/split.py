"""2-3: 의견갈림 판단 로직 (기준 7:3)."""

from typing import Optional, TypedDict

from app.qa.constants import SPLIT_THRESHOLD_LOW


class SplitJudgement(TypedDict):
    is_split: bool
    pos_ratio: int
    neg_ratio: int


def judge_split(positive_count: int, negative_count: int) -> Optional[SplitJudgement]:
    total = positive_count + negative_count
    if total == 0:
        return None

    pos_ratio = positive_count / total
    neg_ratio = negative_count / total
    # 70:30보다 좁으면(=더 팽팽하면) 의견 갈림. 정확히 70:30이면 갈림 아님(경계값 미포함).
    is_split = min(pos_ratio, neg_ratio) > SPLIT_THRESHOLD_LOW

    return {
        "is_split": is_split,
        "pos_ratio": round(pos_ratio * 100),
        "neg_ratio": round(neg_ratio * 100),
    }
