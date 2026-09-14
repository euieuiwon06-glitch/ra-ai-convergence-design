import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get("REVIEW_DB_PATH", BASE_DIR / "db" / "reviews.db"))

# 2-2 + 문장 분절 패치 5-2: 매칭된 세그먼트 개수가 이 미만이면 "정보부족" 응답
# (분절 이전에는 리뷰 개수 기준이었지만, 원본 리뷰 1개가 여러 카테고리에 걸칠 수 있어
# 분절 이후에는 세그먼트 개수를 기준으로 삼는다)
MIN_SEGMENTS_REQUIRED = 3

# 2-3: 의견갈림 판단 기준 (7:3). 정확히 70:30인 경우는 "갈림 아님"으로 취급한다(경계값 미포함).
SPLIT_THRESHOLD = 0.30

STORE = {
    "name": "단디스터디카페 전농점",
    "naver_map_url": (
        "https://map.naver.com/p/entry/place/2076839402"
        "?placePath=%2Fhome%3Fentry%3Dplt%26from%3Dmap%26fromPanelNum%3D1"
        "%26additionalHeight%3D76%26timestamp%3D202607291021%26locale%3Dko"
        "%26svcName%3Dmap_pcv5&searchType=place&lng=127.0598699&lat=37.5776010"
        "&c=15.00,0,0,0,dh"
    ),
    # 네이버 지도 플레이스 페이지의 리뷰 탭. 프론트에서는 지도 링크 하나만 노출하고
    # "지도를 열면 리뷰도 바로 보인다"는 캡션으로 안내하지만, LOCATION_LINK/FACTUAL
    # 응답에는 백엔드가 두 링크를 함께 내려준다(패치: 위치/링크 질문 처리).
    "naver_review_url": "https://map.naver.com/p/entry/place/2076839402?placePath=%2Freview&searchType=place",
}
