from app.qa.topics import extract_topic, is_generally_relevant


def test_extract_topic_congestion():
    assert extract_topic("시험기간에도 자리 있어?") == "혼잡도"


def test_extract_topic_noise():
    assert extract_topic("여기 조용한 편이야?") == "소음"


def test_extract_topic_parking_maps_to_facility():
    # 주차/사물함/콘센트는 세그먼트 데이터에서 전부 "시설"로 묶여있다
    assert extract_topic("주차장 있나요?") == "시설"


def test_extract_topic_locker_maps_to_facility():
    assert extract_topic("사물함 있어?") == "시설"


def test_extract_topic_outlet_maps_to_facility():
    assert extract_topic("콘센트 있어?") == "시설"


def test_extract_topic_none_for_unrelated_question():
    assert extract_topic("오늘 날씨 어때") is None


def test_is_generally_relevant_true_for_studycafe_word_without_topic_match():
    assert is_generally_relevant("여기 스터디카페 어때") is True


def test_is_generally_relevant_false_for_unrelated_question():
    assert is_generally_relevant("오늘 날씨 어때") is False
