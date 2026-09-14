import pytest

from app.qa.intent import CONTEXTUAL, FACTUAL, LOCATION_LINK, OUT_OF_SCOPE, classify_intent


@pytest.mark.parametrize(
    "question",
    [
        "위치가 어디야?",
        "지도 좀 보여줘",
        "리뷰 원문 볼 사이트 보여줘",
        "링크 좀 줘",
        "오시는 길 알려줘",
    ],
)
def test_location_questions_classified_as_location_link(question):
    assert classify_intent(question) == LOCATION_LINK


def test_comparison_question_with_eodi_is_not_location_link():
    # "어디가"는 "어느 쪽이"라는 뜻의 비교 질문이지 위치를 묻는 게 아니다.
    # "어디"만으로 판단하면 이 예시 질문이 위치 질문으로 오인된다.
    def failing_classifier(_question: str) -> str:
        raise RuntimeError("네트워크 오류 시뮬레이션")

    result = classify_intent("2층이랑 4층 중 어디가 조용해?", classifier=failing_classifier)
    assert result != LOCATION_LINK


def test_location_keyword_fallback_without_llm_call():
    def boom(_question: str) -> str:
        raise AssertionError("키워드로 이미 판단됐으면 LLM 분류기를 호출하면 안 된다")

    assert classify_intent("위치가 어디야?", classifier=boom) == LOCATION_LINK


def test_llm_classifier_result_is_used_when_no_location_keyword():
    result = classify_intent("주차장 있어?", classifier=lambda q: "FACTUAL")
    assert result == FACTUAL


def test_llm_classifier_failure_falls_back_to_topic_keyword_mapping():
    def failing_classifier(_question: str) -> str:
        raise RuntimeError("네트워크 오류 시뮬레이션")

    # "주차" 토픽으로 잡히고 TOPIC_TYPE_MAP상 FACTUAL이므로 폴백도 FACTUAL이어야 한다
    assert classify_intent("주차장 있어?", classifier=failing_classifier) == FACTUAL


def test_out_of_scope_fallback_when_no_topic_and_not_relevant():
    def failing_classifier(_question: str) -> str:
        raise RuntimeError("네트워크 오류 시뮬레이션")

    assert classify_intent("오늘 날씨 어때", classifier=failing_classifier) == OUT_OF_SCOPE


def test_contextual_fallback_when_relevant_but_no_specific_topic():
    def failing_classifier(_question: str) -> str:
        raise RuntimeError("네트워크 오류 시뮬레이션")

    assert classify_intent("여기 스터디카페 어때", classifier=failing_classifier) == CONTEXTUAL
