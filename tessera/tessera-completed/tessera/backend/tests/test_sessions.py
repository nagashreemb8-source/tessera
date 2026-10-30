from __future__ import annotations

from app.db import get_db
from conftest import seed_analysis, seed_quiz, upload_text_pdf


def test_missing_session_header_returns_error_envelope(client):
    response = client.get("/api/documents")
    assert response.status_code == 400
    body = response.json()
    assert body["error"]["code"] == "session_required"
    assert "message" in body["error"]


def test_malformed_session_header_is_rejected(client):
    response = client.get("/api/documents", headers={"X-Session-Id": "bad id!"})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_session"


def test_unknown_session_is_404(client):
    response = client.get(
        "/api/documents", headers={"X-Session-Id": "a" * 32}
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "session_not_found"


def test_other_session_cannot_read_documents(client, session):
    doc_id = upload_text_pdf(client, session["headers"])
    other = client.post("/api/sessions").json()["session_id"]
    other_headers = {"X-Session-Id": other}

    assert client.get(f"/api/documents/{doc_id}", headers=other_headers).status_code == 404
    assert (
        client.get(f"/api/documents/{doc_id}/pages/1", headers=other_headers).status_code
        == 404
    )
    assert client.delete(f"/api/documents/{doc_id}", headers=other_headers).status_code == 404
    assert client.get("/api/documents", headers=other_headers).json() == []

    # The original session still sees its document.
    assert client.get(f"/api/documents/{doc_id}", headers=session["headers"]).status_code == 200


def test_other_session_cannot_read_or_submit_quiz(client, session):
    seed_analysis(session["id"])
    quiz_id = seed_quiz(session["id"], [{"prompt": "Q1?", "tested": ["expected"]}])
    with get_db() as conn:
        question_id = conn.execute(
            "SELECT id FROM quiz_questions WHERE quiz_id = ?", (quiz_id,)
        ).fetchone()["id"]

    other = client.post("/api/sessions").json()["session_id"]
    other_headers = {"X-Session-Id": other}

    assert client.get(f"/api/quizzes/{quiz_id}", headers=other_headers).status_code == 404
    submit = client.post(
        f"/api/quizzes/{quiz_id}/submit",
        headers=other_headers,
        json={"answers": {question_id: "A"}},
    )
    assert submit.status_code == 404
    assert client.get(f"/api/quizzes/{quiz_id}/attempts", headers=other_headers).status_code == 404


def test_other_session_cannot_read_attempt_or_diagnosis(client, session):
    seed_analysis(session["id"])
    quiz_id = seed_quiz(session["id"], [{"prompt": "Q1?", "tested": ["expected"]}])
    with get_db() as conn:
        question_id = conn.execute(
            "SELECT id FROM quiz_questions WHERE quiz_id = ?", (quiz_id,)
        ).fetchone()["id"]
    attempt = client.post(
        f"/api/quizzes/{quiz_id}/submit",
        headers=session["headers"],
        json={"answers": {question_id: "B"}},
    ).json()

    other = client.post("/api/sessions").json()["session_id"]
    other_headers = {"X-Session-Id": other}
    response = client.post(
        "/api/diagnosis",
        headers=other_headers,
        json={"attempt_id": attempt["attempt_id"]},
    )
    assert response.status_code == 404
    assert client.get("/api/progress", headers=other_headers).json()["attempts"] == []


def test_wipe_session_data(client, session):
    from app.config import get_settings

    upload_text_pdf(client, session["headers"])
    folder = get_settings().uploads_dir / session["id"]
    assert folder.exists()

    response = client.delete(f"/api/sessions/{session['id']}/data", headers=session["headers"])
    assert response.status_code == 200
    assert response.json()["deleted"] is True
    assert not folder.exists()
    # Session is gone, so subsequent calls report session_not_found.
    assert client.get("/api/documents", headers=session["headers"]).status_code == 404


def test_cannot_wipe_another_session(client, session):
    other = client.post("/api/sessions").json()["session_id"]
    response = client.delete(f"/api/sessions/{other}/data", headers=session["headers"])
    assert response.status_code == 404
    assert client.get("/api/documents", headers={"X-Session-Id": other}).status_code == 200
