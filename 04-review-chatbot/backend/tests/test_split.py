from app.qa.split import judge_split


def test_zero_reviews_returns_none():
    assert judge_split(0, 0) is None


def test_exactly_70_30_is_not_split():
    """지시서 2-3: 기준이 70:30이고, 정확히 그 경계값이면 '갈림 아님'으로 취급한다."""
    result = judge_split(7, 3)
    assert result is not None
    assert result["is_split"] is False
    assert result["pos_ratio"] == 70
    assert result["neg_ratio"] == 30


def test_69_31_is_split():
    """70:30보다 아주 조금이라도 좁으면(더 팽팽하면) 갈림으로 판단한다."""
    result = judge_split(69, 31)
    assert result["is_split"] is True
    assert result["pos_ratio"] == 69
    assert result["neg_ratio"] == 31


def test_71_29_is_not_split():
    result = judge_split(71, 29)
    assert result["is_split"] is False


def test_50_50_is_split():
    result = judge_split(5, 5)
    assert result["is_split"] is True
    assert result["pos_ratio"] == 50
    assert result["neg_ratio"] == 50


def test_all_positive_is_not_split():
    result = judge_split(10, 0)
    assert result["is_split"] is False
    assert result["pos_ratio"] == 100
    assert result["neg_ratio"] == 0


def test_all_negative_is_not_split():
    result = judge_split(0, 10)
    assert result["is_split"] is False


def test_negative_majority_exactly_70_30_is_not_split():
    result = judge_split(3, 7)
    assert result["is_split"] is False
    assert result["pos_ratio"] == 30
    assert result["neg_ratio"] == 70


def test_ratio_rounding():
    # 2/3 = 66.67% -> 67, 1/3 = 33.33% -> 33
    result = judge_split(2, 1)
    assert result["pos_ratio"] == 67
    assert result["neg_ratio"] == 33
