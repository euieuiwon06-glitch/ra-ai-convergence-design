from data.labeling.segmentation import cross_validate_segments, majority_or_none


def _classifier(segments: list[dict]):
    return lambda content: segments


# ---------------------------------------------------------------------------
# majority_or_none — 2개 이상 일치해야 확정, 아니면 None(3-way 불일치)
# ---------------------------------------------------------------------------
def test_majority_or_none_two_agree():
    assert majority_or_none(["시설", "시설", "몰입환경"]) == "시설"


def test_majority_or_none_unanimous():
    assert majority_or_none(["소음", "소음", "소음"]) == "소음"


def test_majority_or_none_three_way_split_returns_none():
    assert majority_or_none(["시설", "소음", "몰입환경"]) is None


# ---------------------------------------------------------------------------
# cross_validate_segments
# ---------------------------------------------------------------------------
def test_confirms_when_all_three_models_agree_on_single_segment():
    one_segment = [{"text": "화장실이 좀 아쉽긴 한데ㅠ", "category": "시설", "tone": "부정"}]
    classifiers = (_classifier(one_segment), _classifier(one_segment), _classifier(one_segment))

    result = cross_validate_segments("화장실이 좀 아쉽긴 한데ㅠ", classifiers)

    assert result["is_confirmed"] is True
    assert result["segments"] == [
        {"segment_no": 1, "text": "화장실이 좀 아쉽긴 한데ㅠ", "category": "시설", "tone": "부정"}
    ]


def test_confirms_with_2_1_category_majority():
    gpt = [{"text": "조명이 눈이 안 아프다", "category": "시설", "tone": "긍정"}]
    claude = [{"text": "조명이 눈이 안 아프다", "category": "시설", "tone": "긍정"}]
    gemini = [{"text": "조명이 눈이 안 아프다", "category": "몰입환경", "tone": "긍정"}]  # 2:1 소수 의견

    result = cross_validate_segments(
        "조명이 눈이 안 아프다", (_classifier(gpt), _classifier(claude), _classifier(gemini))
    )

    assert result["is_confirmed"] is True
    assert result["segments"][0]["category"] == "시설"


def test_uses_claude_text_as_canonical_segment_text():
    gpt = [{"text": "gpt 버전 텍스트", "category": "시설", "tone": "긍정"}]
    claude = [{"text": "claude 버전 텍스트(기준)", "category": "시설", "tone": "긍정"}]
    gemini = [{"text": "gemini 버전 텍스트", "category": "시설", "tone": "긍정"}]

    result = cross_validate_segments(
        "아무 리뷰", (_classifier(gpt), _classifier(claude), _classifier(gemini))
    )

    assert result["segments"][0]["text"] == "claude 버전 텍스트(기준)"


def test_not_confirmed_when_segment_count_differs():
    one_segment = [{"text": "전체 문장", "category": "시설", "tone": "긍정"}]
    two_segments = [
        {"text": "조각1", "category": "시설", "tone": "긍정"},
        {"text": "조각2", "category": "몰입환경", "tone": "긍정"},
    ]

    result = cross_validate_segments(
        "조명이 눈이 안 아프고 집중이 잘된다",
        (_classifier(one_segment), _classifier(two_segments), _classifier(one_segment)),
    )

    assert result["is_confirmed"] is False
    assert result["segments"] == []
    assert result["reason"] == "분절 개수 불일치"


def test_not_confirmed_when_category_is_3way_split():
    gpt = [{"text": "애매한 문장", "category": "시설", "tone": "긍정"}]
    claude = [{"text": "애매한 문장", "category": "소음", "tone": "긍정"}]
    gemini = [{"text": "애매한 문장", "category": "몰입환경", "tone": "긍정"}]

    result = cross_validate_segments(
        "애매한 문장", (_classifier(gpt), _classifier(claude), _classifier(gemini))
    )

    assert result["is_confirmed"] is False
    assert result["reason"] == "조각 분류 3-way 불일치"


def test_not_confirmed_when_tone_is_3way_split():
    # 톤은 긍정/부정 둘 뿐이라 실제로는 3-way가 불가능하지만, 방어적으로 로직을 그대로 검증한다
    gpt = [{"text": "애매한 문장", "category": "시설", "tone": "긍정"}]
    claude = [{"text": "애매한 문장", "category": "시설", "tone": "부정"}]
    gemini = [{"text": "애매한 문장", "category": "시설", "tone": "중립"}]

    result = cross_validate_segments(
        "애매한 문장", (_classifier(gpt), _classifier(claude), _classifier(gemini))
    )

    assert result["is_confirmed"] is False


def test_confirms_multi_segment_review_like_review_42():
    gpt = [
        {"text": "조명이 눈이 안 아프다", "category": "시설", "tone": "긍정"},
        {"text": "집중이 잘된다", "category": "몰입환경", "tone": "긍정"},
    ]
    claude = [
        {"text": "조명이 눈이 안 아프다", "category": "시설", "tone": "긍정"},
        {"text": "집중이 잘된다", "category": "몰입환경", "tone": "긍정"},
    ]
    gemini = [
        {"text": "조명이 눈이 안 아프다", "category": "시설", "tone": "긍정"},
        {"text": "집중이 잘된다", "category": "몰입환경", "tone": "긍정"},
    ]

    result = cross_validate_segments(
        "조명이 눈이 안 아프고 집중이 잘된다", (_classifier(gpt), _classifier(claude), _classifier(gemini))
    )

    assert result["is_confirmed"] is True
    assert [s["category"] for s in result["segments"]] == ["시설", "몰입환경"]
    assert [s["segment_no"] for s in result["segments"]] == [1, 2]
