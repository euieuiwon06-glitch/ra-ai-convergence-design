"""Q&A 의견갈림 판단과 개별 리뷰 신뢰도(%) 판단이 함께 쓰는 임계값.

70:30 기준 — 이 이상/이하면 "확실"로, 그 사이(30~70)는 애매 구간으로 취급한다.
- judge_split()(app/qa/split.py): 카테고리 세그먼트 전체의 긍정/부정 비율이 이 구간
  안이면 "의견 갈림".
- run_confidence_vote_single()(data/labeling/confidence.py): 리뷰 1건에 대해
  3-LLM이 매긴 긍정확률(%) 평균이 이 구간 안이면 "판단보류".

서비스 전체에서 일관된 기준 하나를 쓰기 위해 두 로직이 이 상수를 공유한다.
"""

SPLIT_THRESHOLD_HIGH = 0.70  # 이 이상이면 "확실 긍정"
SPLIT_THRESHOLD_LOW = 0.30  # 이 이하면 "확실 부정"
