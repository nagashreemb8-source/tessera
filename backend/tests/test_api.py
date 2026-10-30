from __future__ import annotations

from conftest import upload_text_pdf


def test_health_does_not_leak_secrets(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["db"] == "ok"
    assert body["llm"]["configured"] is False
    # Only booleans, never a key value or a provider URL.
    assert "sk-" not in response.text
    assert "bearer" not in response.text.lower()
    assert "nebius" not in response.text.lower()


def test_health_llm_when_unconfigured(client):
    response = client.get("/api/health/llm")
    assert response.status_code == 200
    body = response.json()
    assert body["configured"] is False
    assert "NEBIUS_API_KEY" in body["message"]


def test_cors_allows_configured_origin(client):
    response = client.options(
        "/api/health",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "X-Session-Id",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "x-session-id" in response.headers["access-control-allow-headers"].lower()


def test_cors_rejects_unknown_origin(client):
    response = client.get("/api/health", headers={"Origin": "http://evil.example"})
    assert "access-control-allow-origin" not in response.headers


def test_validation_error_envelope(client, session):
    response = client.post(
        "/api/tutor/ask", headers=session["headers"], json={"question": ""}
    )
    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "validation_error"
    assert body["error"]["details"]["fields"]


def test_unknown_route_returns_envelope(client):
    response = client.get("/api/nope")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_tutor_and_materials_require_documents(client, session, fake_llm):
    response = client.post(
        "/api/tutor/ask",
        headers=session["headers"],
        json={"question": "What is variance?"},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "no_documents"

    response = client.post(
        "/api/materials/notes", headers=session["headers"], json={}
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "no_documents"


def test_tutor_and_materials_end_to_end(client, session, fake_llm):
    from test_analysis import wait_for_analysis

    upload_text_pdf(client, session["headers"])
    client.post("/api/analysis", headers=session["headers"])
    assert wait_for_analysis(client, session["headers"])["status"] == "ready"

    answer = client.post(
        "/api/tutor/ask",
        headers=session["headers"],
        json={"question": "How is expected value computed?"},
    )
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["answer"]
    assert body["citations"]
    assert body["citations"][0]["page"] >= 1
    assert body["passages"]

    history = client.get("/api/tutor/history", headers=session["headers"]).json()
    assert len(history["turns"]) == 2
    assert history["turns"][0]["role"] == "user"

    notes = client.post(
        "/api/materials/notes", headers=session["headers"], json={"count": 3}
    )
    assert notes.status_code == 200, notes.text
    notes_body = notes.json()
    assert notes_body["kind"] == "notes"
    assert notes_body["payload"]["sections"]
    assert notes_body["payload"]["sections"][0]["page_refs"][0]["page"] >= 1

    cards = client.post(
        "/api/materials/flashcards", headers=session["headers"], json={"count": 3}
    )
    assert cards.status_code == 200
    assert cards.json()["payload"]["cards"]

    practice = client.post(
        "/api/materials/practice-questions",
        headers=session["headers"],
        json={"count": 2},
    )
    assert practice.status_code == 200
    assert practice.json()["payload"]["questions"]

    simplified = client.post(
        "/api/materials/simplified-explanation", headers=session["headers"], json={}
    )
    assert simplified.status_code == 200
    assert simplified.json()["payload"]["analogy"]

    listed = client.get("/api/materials", headers=session["headers"]).json()
    assert len(listed["materials"]) == 4

    one = client.get(
        f"/api/materials/{notes_body['id']}", headers=session["headers"]
    ).json()
    assert one["id"] == notes_body["id"]


def test_explain_backwards_compatible(client, fake_llm):
    response = client.post(
        "/api/explain",
        json={
            "conceptId": "expected-value",
            "conceptName": "Expected Value",
            "evidence": [
                {
                    "questionId": 3,
                    "prompt": "What is E[X]?",
                    "chosen": "B",
                    "correct": "A",
                    "pattern": "Average ignoring weights.",
                }
            ],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert isinstance(body["title"], str)
    assert isinstance(body["paragraphs"], list) and body["paragraphs"]
    assert "note" in body


def test_followup_quiz_endpoint_requires_gap(client, session):
    from conftest import seed_analysis

    seed_analysis(session["id"])
    response = client.post(
        "/api/quizzes/followup", headers=session["headers"], json={"num_questions": 2}
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "no_gaps_to_test"
