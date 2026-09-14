from app.qa.topic_type import CONTEXTUAL, FACTUAL, TOPIC_TYPE_MAP, classify_question_type


def test_known_factual_topic():
    assert TOPIC_TYPE_MAP["운영시간"] == FACTUAL


def test_known_contextual_topics():
    assert TOPIC_TYPE_MAP["소음"] == CONTEXTUAL
    assert TOPIC_TYPE_MAP["혼잡도"] == CONTEXTUAL
    assert TOPIC_TYPE_MAP["몰입환경"] == CONTEXTUAL


def test_unmapped_topic_defaults_to_contextual():
    assert TOPIC_TYPE_MAP.get("완전히새로운토픽", CONTEXTUAL) == CONTEXTUAL


# ---------------------------------------------------------------------------
# "시설" 카테고리는 카테고리 단위가 아니라 질문 키워드 단위로 사실형/맥락형이 갈린다
# ---------------------------------------------------------------------------
def test_facility_existence_question_is_factual():
    assert classify_question_type("콘센트 있어요?", "시설") == FACTUAL
    assert classify_question_type("주차장 있나요?", "시설") == FACTUAL
    assert classify_question_type("사물함 있어요?", "시설") == FACTUAL


def test_facility_quality_question_is_contextual():
    assert classify_question_type("직원분들 친절해요?", "시설") == CONTEXTUAL
    assert classify_question_type("청소 잘 되어있나요?", "시설") == CONTEXTUAL
    assert classify_question_type("가격이 합리적인가요?", "시설") == CONTEXTUAL


def test_facility_generic_question_defaults_to_contextual():
    # "시설" 자체만 물어보는 포괄적 질문은 사실 확인이 아니라 종합 평가에 가깝다
    assert classify_question_type("여기 시설 어때요?", "시설") == CONTEXTUAL


def test_non_facility_category_uses_category_default_regardless_of_keywords():
    # 시설 외 카테고리는 질문 내용과 무관하게 카테고리 기본값을 그대로 쓴다
    assert classify_question_type("아무 질문", "운영시간") == FACTUAL
    assert classify_question_type("아무 질문", "소음") == CONTEXTUAL
