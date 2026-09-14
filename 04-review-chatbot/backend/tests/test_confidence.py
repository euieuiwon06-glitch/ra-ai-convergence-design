import pytest

from data.labeling.confidence import (
    InsufficientModelResponsesError,
    call_with_retry,
    parse_confidence_int,
    run_confidence_vote_single,
)

_NO_SLEEP = lambda seconds: None  # noqa: E731 - 테스트에서 재시도 대기를 없애기 위한 목업


def _fixed_calls(gpt: int, claude: int, gemini: int):
    return {"gpt": lambda content: gpt, "claude": lambda content: claude, "gemini": lambda content: gemini}


# ---------------------------------------------------------------------------
# parse_confidence_int
# ---------------------------------------------------------------------------
def test_parse_confidence_int_plain_number():
    assert parse_confidence_int("82") == 82


def test_parse_confidence_int_handles_malformed_llm_response():
    assert parse_confidence_int("약 80점 정도요") == 80


def test_parse_confidence_int_raises_when_no_digits():
    with pytest.raises(ValueError):
        parse_confidence_int("정말 좋아요")


def test_parse_confidence_int_clamps_above_100():
    assert parse_confidence_int("150") == 100


# ---------------------------------------------------------------------------
# run_confidence_vote_single — 70:30 경계값 (app.qa.constants와 공유하는 임계값)
# ---------------------------------------------------------------------------
def test_confidence_average_above_high_threshold_is_positive():
    result = run_confidence_vote_single("리뷰", _fixed_calls(80, 75, 70), sleep_fn=_NO_SLEEP)
    assert result["final"] == "긍정"
    assert result["avg_confidence"] == 75


def test_confidence_average_below_low_threshold_is_negative():
    result = run_confidence_vote_single("리뷰", _fixed_calls(20, 25, 30), sleep_fn=_NO_SLEEP)
    assert result["final"] == "부정"
    assert result["avg_confidence"] == 25


def test_confidence_exactly_at_boundary_70_and_30():
    # (90+70+50)/3 = 70.0 -> 긍정 (경계값 포함)
    high = run_confidence_vote_single("리뷰", _fixed_calls(90, 70, 50), sleep_fn=_NO_SLEEP)
    assert high["avg_confidence"] == 70
    assert high["final"] == "긍정"

    # (10+30+50)/3 = 30.0 -> 부정 (경계값 포함)
    low = run_confidence_vote_single("리뷰", _fixed_calls(10, 30, 50), sleep_fn=_NO_SLEEP)
    assert low["avg_confidence"] == 30
    assert low["final"] == "부정"


def test_confidence_in_ambiguous_range_is_pending():
    result = run_confidence_vote_single("리뷰", _fixed_calls(40, 50, 60), sleep_fn=_NO_SLEEP)
    assert result["avg_confidence"] == 50
    assert result["final"] == "판단보류"


# ---------------------------------------------------------------------------
# 모델 호출 실패 정책(확정): 1회 재시도 -> 그래도 실패하면 제외 -> 2개 미만 성공시 에러
# ---------------------------------------------------------------------------
def test_call_with_retry_returns_none_and_sleeps_once_after_final_failure():
    sleep_calls = []

    def always_fail(content):
        raise RuntimeError("실패")

    result = call_with_retry("gpt", "리뷰", {"gpt": always_fail}, sleep_fn=lambda s: sleep_calls.append(s))

    assert result is None
    assert sleep_calls == [1]  # 재시도 전 1번만 대기, 재시도 후엔 더 안 잔다


def test_one_model_fails_then_retries_successfully():
    call_count = {"gpt": 0}

    def flaky_gpt(content):
        call_count["gpt"] += 1
        if call_count["gpt"] == 1:
            raise RuntimeError("일시적 오류")
        return 80

    model_calls = {"gpt": flaky_gpt, "claude": lambda c: 70, "gemini": lambda c: 60}
    result = run_confidence_vote_single("리뷰", model_calls, sleep_fn=_NO_SLEEP)

    assert call_count["gpt"] == 2  # 최초 실패 + 재시도 성공
    assert result["scores"] == {"gpt": 80, "claude": 70, "gemini": 60}
    assert result["model_count"] == 3


def test_one_model_fails_twice_falls_back_to_two_models():
    def always_fail(content):
        raise RuntimeError("영구 오류")

    model_calls = {"gpt": always_fail, "claude": lambda c: 80, "gemini": lambda c: 60}
    result = run_confidence_vote_single("리뷰", model_calls, sleep_fn=_NO_SLEEP)

    assert "gpt" not in result["scores"]
    assert result["scores"] == {"claude": 80, "gemini": 60}
    assert result["model_count"] == 2
    assert result["avg_confidence"] == 70
    assert result["final"] == "긍정"


def test_two_models_fail_raises_insufficient_error():
    def always_fail(content):
        raise RuntimeError("실패")

    model_calls = {"gpt": always_fail, "claude": always_fail, "gemini": lambda c: 80}

    with pytest.raises(InsufficientModelResponsesError):
        run_confidence_vote_single("리뷰", model_calls, sleep_fn=_NO_SLEEP)


def test_all_models_fail_raises_insufficient_error():
    def always_fail(content):
        raise RuntimeError("실패")

    model_calls = {"gpt": always_fail, "claude": always_fail, "gemini": always_fail}

    with pytest.raises(InsufficientModelResponsesError):
        run_confidence_vote_single("리뷰", model_calls, sleep_fn=_NO_SLEEP)
