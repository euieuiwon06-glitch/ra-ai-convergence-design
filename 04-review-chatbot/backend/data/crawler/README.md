# 크롤러 (보류)

네이버 지도 리뷰 크롤링은 robots.txt / 이용약관 확인과 소스 확정(공식 API 유무, 로그인 필요 여부,
수동 export 대안)이 끝난 뒤 별도로 구현한다. 지시서(섹션 6, 7번)에 따라 이번 작업에서는
제외했다.

크롤러가 채워야 할 산출물 형식만 미리 정해둔다 — `data/labeling/majority_vote.py`와
`db/schema.sql`이 이 형식을 그대로 받는다.

`reviews_raw` (CSV 또는 동일 컬럼의 테이블):

| 컬럼 | 설명 |
| --- | --- |
| review_id | 고유 ID |
| store_name | 매장명 |
| content | 리뷰 원문 |
| date | 작성일 |
| source_url | 원본 리뷰 URL |
