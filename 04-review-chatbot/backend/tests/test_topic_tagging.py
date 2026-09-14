from data.labeling.topic_tagging import parse_topics, tag_topics


def test_parse_topics_filters_to_allowed_set_and_dedupes():
    assert parse_topics("소음, 혼잡도, 소음, 헛소리") == ["소음", "혼잡도"]


def test_parse_topics_empty_string():
    assert parse_topics("") == []


def test_tag_topics_uses_injected_classifier():
    result = tag_topics("시끄럽고 자리도 없어요", classifier=lambda content: "소음,혼잡도")
    assert result == ["소음", "혼잡도"]
