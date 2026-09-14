from pathlib import Path

from fastapi.testclient import TestClient

from app.config import STORE
from app.main import app, get_db
from app.models.review import get_connection, insert_review, insert_review_segment
from data.labeling.confidence import InsufficientModelResponsesError


def _override_get_db(db_path: Path):
    def _dep():
        conn = get_connection(db_path)
        try:
            yield conn
        finally:
            conn.close()

    return _dep


def _fake_confidence(gpt=80, claude=75, gemini=70, final="긍정", avg=75, model_count=3):
    def _fn(content):
        return {
            "scores": {"gpt": gpt, "claude": claude, "gemini": gemini},
            "avg_confidence": avg,
            "final": final,
            "model_count": model_count,
        }

    return _fn


def test_chat_endpoint_returns_insufficient_info_for_unmatched_factual_topic(db_path: Path):
    app.dependency_overrides[get_db] = _override_get_db(db_path)
    try:
        client = TestClient(app)
        resp = client.post("/chat", json={"question": "콘센트 있어?"})
        assert resp.status_code == 200
        assert resp.json()["type"] == "insufficient_info"
    finally:
        app.dependency_overrides.clear()


def test_chat_endpoint_returns_factual_with_evidence(db_path: Path):
    conn = get_connection(db_path)
    for i in range(4):
        review_id = f"p-{i}"
        content = f"시설 관련 긍정 리뷰 {i}"
        insert_review(conn, review_id=review_id, store_name=STORE["name"], content=content)
        insert_review_segment(
            conn, review_id=review_id, segment_no=1, segment_text=content, category="시설", tone="긍정"
        )
    conn.close()

    app.dependency_overrides[get_db] = _override_get_db(db_path)
    try:
        client = TestClient(app)
        resp = client.post("/chat", json={"question": "주차장 있어?"})  # "주차"는 시설 카테고리로 묶인다
        body = resp.json()
        assert body["type"] == "factual"
        assert body["naver_map_url"] == STORE["naver_map_url"]
        assert body["naver_review_url"] == STORE["naver_review_url"]
        assert len(body["evidence_reviews"]) == 2  # 시설은 FACTUAL — 최신순 최대 2개
    finally:
        app.dependency_overrides.clear()


def test_chat_endpoint_returns_location_link(db_path: Path):
    app.dependency_overrides[get_db] = _override_get_db(db_path)
    try:
        client = TestClient(app)
        resp = client.post("/chat", json={"question": "위치가 어디야?"})
        body = resp.json()
        assert body["type"] == "location_link"
        assert body["naver_map_url"] == STORE["naver_map_url"]
        assert body["naver_review_url"] == STORE["naver_review_url"]
    finally:
        app.dependency_overrides.clear()


def test_submit_review_saves_confirmed_segments(db_path: Path, monkeypatch):
    def fake_cross_validate_segments(content, classifiers=None):
        return {
            "is_confirmed": True,
            "segments": [{"segment_no": 1, "text": content, "category": "소음", "tone": "긍정"}],
            "reason": None,
        }

    monkeypatch.setattr("app.qa.upload.cross_validate_segments", fake_cross_validate_segments)
    monkeypatch.setattr("app.main.run_confidence_vote_single", _fake_confidence())
    app.dependency_overrides[get_db] = _override_get_db(db_path)
    try:
        client = TestClient(app)
        resp = client.post("/reviews", json={"content": "조용해서 좋았어요"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "saved"
        assert body["saved"] is True
        assert body["segments"] == [{"segment_no": 1, "text": "조용해서 좋았어요", "category": "소음", "tone": "긍정"}]
        assert body["sentiment_final"] == "긍정"
        assert body["confidence_scores"] == {"gpt": 80, "claude": 75, "gemini": 70}
        assert body["avg_confidence"] == 75
        assert body["model_count"] == 3
        assert body["topic_tags"] == ["소음"]
        assert "저장" in body["message"]
        assert "75%" in body["message"]

        conn = get_connection(db_path)
        row = conn.execute(
            "SELECT * FROM reviews WHERE review_id = ?", (body["review_id"],)
        ).fetchone()
        segment_row = conn.execute(
            "SELECT * FROM review_segments WHERE review_id = ?", (body["review_id"],)
        ).fetchone()
        conn.close()
        assert row is not None
        assert row["is_user_submitted"] == 1
        assert row["avg_confidence"] == 75
        assert row["confidence_gpt"] == 80
        assert row["confidence_model_count"] == 3
        assert segment_row is not None
        assert segment_row["category"] == "소음"
        assert segment_row["label_source"] == "majority_vote_segment"
    finally:
        app.dependency_overrides.clear()


def test_submit_review_ambiguous_confidence_marks_pending_message(db_path: Path, monkeypatch):
    def fake_cross_validate_segments(content, classifiers=None):
        return {
            "is_confirmed": True,
            "segments": [{"segment_no": 1, "text": content, "category": "소음", "tone": "긍정"}],
            "reason": None,
        }

    monkeypatch.setattr("app.qa.upload.cross_validate_segments", fake_cross_validate_segments)
    monkeypatch.setattr(
        "app.main.run_confidence_vote_single", _fake_confidence(gpt=40, claude=50, gemini=60, final="판단보류", avg=50)
    )
    app.dependency_overrides[get_db] = _override_get_db(db_path)
    try:
        client = TestClient(app)
        resp = client.post("/reviews", json={"content": "나쁘진 않은데 특별히 좋지도 않다"})
        body = resp.json()
        assert body["sentiment_final"] == "판단보류"
        assert body["saved"] is True  # 세그먼트 분절 자체는 확정됐으니 저장은 된다
        assert "애매" in body["message"]
        assert "50%" in body["message"]
    finally:
        app.dependency_overrides.clear()


def test_submit_review_manual_review_needed_when_segmentation_unconfirmed(db_path: Path, monkeypatch):
    def fake_cross_validate_segments(content, classifiers=None):
        return {"is_confirmed": False, "segments": [], "reason": "분절 개수 불일치"}

    monkeypatch.setattr("app.qa.upload.cross_validate_segments", fake_cross_validate_segments)
    monkeypatch.setattr("app.main.run_confidence_vote_single", _fake_confidence())
    app.dependency_overrides[get_db] = _override_get_db(db_path)
    try:
        client = TestClient(app)
        resp = client.post("/reviews", json={"content": "판단하기 애매한 리뷰입니다"})
        body = resp.json()
        assert body["status"] == "manual_review_needed"
        assert body["saved"] is False
        assert "검토" in body["message"]

        conn = get_connection(db_path)
        count = conn.execute("SELECT COUNT(*) AS c FROM reviews").fetchone()["c"]
        conn.close()
        assert count == 0  # 확정 못한 리뷰는 아무것도 저장하지 않는다
    finally:
        app.dependency_overrides.clear()


def test_submit_review_returns_503_when_insufficient_model_responses(db_path: Path, monkeypatch):
    def failing_confidence(content):
        raise InsufficientModelResponsesError("성공한 모델이 1개뿐이라 판단 불가")

    monkeypatch.setattr("app.main.run_confidence_vote_single", failing_confidence)
    app.dependency_overrides[get_db] = _override_get_db(db_path)
    try:
        client = TestClient(app)
        resp = client.post("/reviews", json={"content": "이 리뷰는 저장되면 안 됩니다"})
        assert resp.status_code == 503
        assert "다시 시도" in resp.json()["detail"]

        conn = get_connection(db_path)
        count = conn.execute("SELECT COUNT(*) AS c FROM reviews").fetchone()["c"]
        conn.close()
        assert count == 0
    finally:
        app.dependency_overrides.clear()


def test_analyze_endpoint_does_not_persist(db_path: Path, monkeypatch):
    def fake_cross_validate_segments(content, classifiers=None):
        return {
            "is_confirmed": True,
            "segments": [
                {"segment_no": 1, "text": "시끄럽고", "category": "소음", "tone": "부정"},
                {"segment_no": 2, "text": "자리도 없어요", "category": "혼잡도", "tone": "부정"},
            ],
            "reason": None,
        }

    monkeypatch.setattr("app.qa.upload.cross_validate_segments", fake_cross_validate_segments)
    monkeypatch.setattr(
        "app.main.run_confidence_vote_single", _fake_confidence(gpt=10, claude=15, gemini=20, final="부정", avg=15)
    )

    client = TestClient(app)
    resp = client.post("/reviews/analyze", json={"content": "시끄럽고 자리도 없어요"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "previewed"
    assert body["saved"] is False
    assert body["review_id"] == "preview"
    assert len(body["segments"]) == 2
    assert body["sentiment_final"] == "부정"

    conn = get_connection(db_path)
    count = conn.execute("SELECT COUNT(*) AS c FROM reviews").fetchone()["c"]
    conn.close()
    assert count == 0


def test_analyze_returns_503_when_insufficient_model_responses(monkeypatch):
    def failing_confidence(content):
        raise InsufficientModelResponsesError("성공한 모델이 0개")

    monkeypatch.setattr("app.main.run_confidence_vote_single", failing_confidence)

    client = TestClient(app)
    resp = client.post("/reviews/analyze", json={"content": "이 리뷰는 분석이 안 됩니다"})
    assert resp.status_code == 503
    assert "다시 시도" in resp.json()["detail"]


def test_user_submitted_review_counts_toward_qa_immediately(db_path: Path, monkeypatch):
    def fake_cross_validate_segments(content, classifiers=None):
        return {
            "is_confirmed": True,
            "segments": [{"segment_no": 1, "text": content, "category": "시설", "tone": "긍정"}],
            "reason": None,
        }

    monkeypatch.setattr("app.qa.upload.cross_validate_segments", fake_cross_validate_segments)
    monkeypatch.setattr("app.main.run_confidence_vote_single", _fake_confidence())
    app.dependency_overrides[get_db] = _override_get_db(db_path)
    try:
        client = TestClient(app)

        before = client.post("/chat", json={"question": "주차장 있어?"}).json()
        assert before["type"] == "insufficient_info"

        submit_resp = client.post("/reviews", json={"content": "지하에 주차장이 있어서 편했어요"})
        assert submit_resp.status_code == 200

        after = client.post("/chat", json={"question": "주차장 있어?"}).json()
        assert after["type"] == "factual"
        assert after["evidence_reviews"][0]["content"] == "지하에 주차장이 있어서 편했어요"
    finally:
        app.dependency_overrides.clear()


def test_review_content_length_validation():
    client = TestClient(app)

    too_short = client.post("/reviews", json={"content": "짧아"})
    assert too_short.status_code == 422

    too_long = client.post("/reviews", json={"content": "가" * 1001})
    assert too_long.status_code == 422
