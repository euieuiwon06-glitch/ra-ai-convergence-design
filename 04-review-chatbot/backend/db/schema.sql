-- reviews.content(source_text)는 절대 수정하지 않는다 — 챗봇이 노출하는 원문 근거는
-- 항상 이 컬럼 그대로다. 카테고리/톤은 review_segments 기준으로 판단한다(패치: 문장 분절).
CREATE TABLE IF NOT EXISTS reviews (
    review_id TEXT PRIMARY KEY,
    store_name TEXT NOT NULL,
    content TEXT NOT NULL,
    review_date DATE,
    source_url TEXT,
    sentiment_gpt TEXT,       -- 긍정/부정/중립 (레거시 — 분절 이전 방식의 리뷰 전체 톤)
    sentiment_claude TEXT,
    sentiment_gemini TEXT,
    sentiment_final TEXT,     -- 다수결 확정값, 판단보류 가능
    topic_tags TEXT,          -- 콤마구분 (레거시, 참고용 — 매칭은 review_segments 기준)
    is_user_submitted BOOLEAN NOT NULL DEFAULT 0,
    -- 신뢰도(%) 패치: "내 리뷰 추가하기"에서 GPT/Claude/Gemini가 각각 매긴 긍정확률(0~100).
    -- sentiment_gpt/claude/gemini(위 컬럼)는 배치 레이블링이 쓰는 문자열 라벨이라 그대로 두고,
    -- 확률값은 별도 컬럼에 저장한다 — 같은 컬럼에 문자열/정수를 섞어 쓰면 배치 파이프라인이 깨진다.
    confidence_gpt INTEGER,
    confidence_claude INTEGER,
    confidence_gemini INTEGER,
    avg_confidence INTEGER,   -- 성공한 모델들의 평균(반올림), 0~100
    confidence_model_count INTEGER,  -- 평균에 반영된 모델 수(2 또는 3)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 다수결 판단보류(3개 모델 전부 다름) 리뷰를 모아두는 테이블
CREATE TABLE IF NOT EXISTS pending_reviews (
    review_id TEXT PRIMARY KEY REFERENCES reviews(review_id),
    reason TEXT DEFAULT '3-way split'
);

-- 문장 분절 결과. 카테고리 분류/검색 매칭은 이 테이블 기준이고,
-- 챗봇이 근거로 보여주는 원문은 항상 reviews.content(segment_text 아님).
CREATE TABLE IF NOT EXISTS review_segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    review_id TEXT NOT NULL REFERENCES reviews(review_id),
    segment_no INTEGER NOT NULL,                  -- 원본 내 순서 (1부터)
    segment_text TEXT NOT NULL,                   -- 분절된 문장 (분류/검색 매칭용)
    category TEXT NOT NULL,                       -- 혼잡도/소음/시설/몰입환경/운영시간
    tone TEXT NOT NULL,                            -- 긍정/부정
    label_source TEXT NOT NULL DEFAULT 'majority_vote',  -- majority_vote | manual_review | llm_single
    UNIQUE(review_id, segment_no)
);

CREATE INDEX IF NOT EXISTS idx_reviews_sentiment_final ON reviews (sentiment_final);
CREATE INDEX IF NOT EXISTS idx_reviews_topic_tags ON reviews (topic_tags);
CREATE INDEX IF NOT EXISTS idx_segments_category ON review_segments (category);
CREATE INDEX IF NOT EXISTS idx_segments_review ON review_segments (review_id);
