# review-chatbot-backend

"단디스터디카페 전농점" 리뷰 데이터 기반 Q&A 챗봇 백엔드 (FastAPI + SQLite).

## 실행

```bash
pip install -r requirements.txt
python -m db.migrate          # db/reviews.db 생성 (reviews, pending_reviews, review_segments)
python -m db.seed              # 92문장 분절 시드 데이터 삽입 (선택)
uvicorn app.main:app --reload --port 8000
```

## 테스트

```bash
pytest
```

## 3-LLM 다수결 레이블링 배치

```bash
# 환경변수: OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY
python -m data.labeling.majority_vote --input path/to/reviews.csv
```

리뷰 1건마다 GPT / Claude / Gemini 3개 모델의 톤 판단(긍정/부정/중립)을 받아 다수결로
`sentiment_final`을 확정한다. 2개 이상이 같은 라벨이면 그 라벨로, 3개가 전부 다르면
"판단보류"로 표시하고 `pending_reviews` 테이블에 별도로 모은다.

## 디렉토리 구조

```
review-chatbot-backend/
├── data/
│   ├── crawler/            # 리뷰 크롤링 스크립트 (소스 확정 후 별도 작업 예정)
│   └── labeling/           # 3-LLM 다수결 레이블링 배치, 토픽 태깅
├── app/
│   ├── main.py              # FastAPI 엔트리포인트 (/chat, /reviews, /reviews/analyze)
│   ├── qa/                  # Q&A 로직 (의도분기, 토픽 매칭, 의견갈림 판단)
│   ├── models/               # DB 모델 / CRUD (reviews, review_segments)
│   └── schemas/               # Pydantic 스키마
├── db/
│   ├── schema.sql
│   ├── migrate.py
│   ├── seed.py               # 92문장 분절 시드 삽입
│   ├── seed_data/segmented_reviews.json
│   └── reviews.db            # (git에는 포함하지 않음)
└── tests/
```

## 리뷰 문장 분절 (review_segments)

한 문장 안에 [물리적 사실]과 [그로 인한 주관적 경험]이 함께 담긴 리뷰(예: "조명이 눈이 안
아프고 집중이 잘된다")는 카테고리 판단이 갈리기 쉬워서(시설 vs 몰입환경), 의미 단위로
분절해서 `review_segments`에 저장하고 각 조각을 독립적으로 분류한다.

- 카테고리/톤 매칭(질문 -> 답변)은 항상 `review_segments` 기준.
- 챗봇이 사용자에게 보여주는 근거 원문은 항상 `reviews.content`(분절 전 원본) — 원문은
  절대 수정하지 않는다.
- 같은 원본 리뷰에서 여러 세그먼트가 매칭돼도 근거로는 원본을 한 번만 보여준다.
- 시드 데이터(`db/seed_data/segmented_reviews.json`)는 조각(segment) 단위로
  GPT/Claude/Gemini 3모델 교차검증까지 마친 최종본이라 `label_source='majority_vote_segment'`로
  저장한다(문장 하나만 통째로 Claude가 판단했던 v1 방식과 구분).

## 사실형(FACTUAL) vs 맥락형(CONTEXTUAL) 질문

정보부족 판단 기준(리뷰 3개 미만)은 "맥락형" 질문에만 적용된다. `app/qa/topic_type.py`가
질문 유형을 정하는데, 대부분 카테고리는 통째로 한 유형이다:

- FACTUAL(세그먼트 1개로도 답변): 운영시간
- CONTEXTUAL(세그먼트 3개 이상 + judge_split 70:30): 혼잡도, 소음, 몰입환경

"시설"만은 유무 확인성 질문("콘센트 있어요?")과 품질/경험 판단 질문("직원 친절해요?",
"청소 잘 되나요?")이 섞여 있어서 카테고리 단위가 아니라 `classify_question_type()`이
질문에 실제로 쓰인 키워드(`FACILITY_FACT_KEYWORDS` / `FACILITY_CONTEXT_KEYWORDS`) 기준으로
나눈다 — 어느 쪽인지 특정 못하면 안전하게 CONTEXTUAL(3개 기준)로 취급한다.

## 내 리뷰 추가하기 (업로드 시에도 분절 적용)

`POST /reviews`, `POST /reviews/analyze`는 `app/qa/upload.py::process_uploaded_review()`를
거친다 — 92개 시드 리뷰와 동일하게 `data/labeling/segmentation.py::cross_validate_segments()`로
분절 + 조각별 GPT/Claude/Gemini 교차검증을 먼저 하고, 그 결과에 따라:

- 3모델의 분절 개수가 다르거나 어느 조각의 카테고리/톤이 3-way로 갈리면 저장하지 않고
  `status: "manual_review_needed"`를 반환한다(사람 검토 후 반영).
- 확정되면 리뷰 원문은 `reviews`에, 조각들은 `review_segments`(`label_source='majority_vote_segment'`)에
  저장하고 다음 질문부터 바로 Q&A에 반영된다.
- `/reviews/analyze`는 저장 없이 같은 분석 결과만 미리 보여준다(`status: "previewed"`).

## 신뢰도(%) 기반 개별 리뷰 판단

세그먼트 카테고리/톤(Q&A 매칭용)과 별개로, 업로드된 리뷰 전체에 대해 GPT/Claude/Gemini가
"긍정 확률(0~100)"을 답하고 평균을 낸다(`data/labeling/confidence.py::run_confidence_vote_single`) —
긍정/부정 이분법으로는 애매한 리뷰("나쁘진 않은데 특별히 좋지도 않다")가 억지로 한쪽에
분류되는 문제를 줄이기 위해서다. 임계값은 Q&A 의견갈림 판단과 같은 70:30을
`app/qa/constants.py`로 공유한다 — 평균 70% 이상은 "긍정", 30% 이하는 "부정", 그 사이는
"판단보류".

모델 호출 실패 정책:
1. 모델 하나가 실패(타임아웃/에러 응답/파싱 실패 포함)하면 그 모델만 1회 재시도한다.
2. 재시도까지 실패하면 그 모델은 제외하고 나머지 성공한 모델들의 평균으로 진행한다.
3. 성공한 모델이 2개 미만이면 `InsufficientModelResponsesError` -> `POST /reviews`,
   `POST /reviews/analyze` 둘 다 503과 "지금은 분석이 어려워요. 잠시 후 다시 시도해주세요."를
   반환하고 아무것도 저장하지 않는다.

응답의 `confidence_scores`/`avg_confidence`/`model_count`/`sentiment_final`은 이 신뢰도
판단 결과이고, `segments`/`topic_tags`는 세그먼트 분절 결과다 — 둘은 독립적으로 계산되므로
세그먼트 분절이 `manual_review_needed`여도 신뢰도 판단 자체는 응답에 포함된다.

배치 레이블링(`data/labeling/majority_vote.py`)은 그대로 카테고리(긍정/부정/중립) 다수결
방식을 쓴다 — 신뢰도(%) 방식으로 통일하고 싶어지면 그때 별도로 진행.

## 크롤링 관련

`data/crawler/`는 스캐폴딩만 두고 아직 구현하지 않았다. 네이버 지도 리뷰는 로그인 세션 없이
접근 시 robots.txt/이용약관 검토가 필요해서, 소스(공식 API 여부, 수동 export 등)가
확정되면 별도로 구현한다 — `data/crawler/README.md` 참고.
