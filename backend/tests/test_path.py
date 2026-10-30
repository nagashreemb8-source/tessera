from __future__ import annotations

from conftest import question_ids, seed_analysis, seed_quiz, submit_answers


def _submit(client, session, questions, chosen):
    quiz_id = seed_quiz(session["id"], questions)
    ids = question_ids(session["id"], quiz_id)
    return submit_answers(
        client, session["headers"], quiz_id, dict(zip(ids, chosen))
    )


def _first_index(path: dict) -> dict[str, int]:
    out: dict[str, int] = {}
    for step in path["steps"]:
        out.setdefault(step["concept_id"], step["ord"])
    return out


def test_path_orders_prerequisites_before_dependents(client, session):
    seed_analysis(session["id"])
    _submit(
        client,
        session,
        [
            {"prompt": "Expected question", "tested": ["expected"]},
            {"prompt": "Variance question", "tested": ["variance"]},
            {"prompt": "Variables question", "tested": ["variables"]},
        ],
        ["B", "B", "A"],
    )
    path = client.get("/api/path", headers=session["headers"]).json()
    assert path["steps"]
    index = _first_index(path)
    assert index["expected"] < index["variance"]
    assert index["variance"] < index["clt"]
    # Mastered concepts are dropped; untested ones remain.
    assert "variables" not in index
    assert "distributions" in index

    for step in path["steps"]:
        assert step["minutes"] > 0
        assert step["verb"] in {"Review", "Revisit", "Practice", "Continue to", "Reassess"}
        assert step["reason"]


def test_path_adapts_after_new_attempt(client, session):
    seed_analysis(session["id"])
    _submit(
        client,
        session,
        [
            {"prompt": "Expected question", "tested": ["expected"]},
            {"prompt": "Variance question", "tested": ["variance"]},
        ],
        ["B", "B"],
    )
    first = client.get("/api/path", headers=session["headers"]).json()
    assert "expected" in _first_index(first)

    # A fresh attempt that gets expected value right changes the picture.
    _submit(
        client,
        session,
        [{"prompt": "New expected question", "tested": ["expected"]}],
        ["A"],
    )
    refreshed = client.post("/api/path/refresh", headers=session["headers"]).json()
    index = _first_index(refreshed)
    assert "expected" not in index
    assert "variance" in index
    assert refreshed["id"] != first["id"]


def test_step_completion_persists_and_uncompletes(client, session):
    seed_analysis(session["id"])
    _submit(
        client,
        session,
        [{"prompt": "Expected question", "tested": ["expected"]}],
        ["B"],
    )
    path = client.get("/api/path", headers=session["headers"]).json()
    concept_id = path["steps"][0]["concept_id"]

    completed = client.post(
        f"/api/path/steps/{concept_id}/complete", headers=session["headers"]
    ).json()
    step = next(s for s in completed["steps"] if s["concept_id"] == concept_id)
    assert step["completed"] is True
    assert completed["completed_count"] >= 1

    persisted = client.get("/api/path", headers=session["headers"]).json()
    step = next(s for s in persisted["steps"] if s["concept_id"] == concept_id)
    assert step["completed"] is True

    undone = client.post(
        f"/api/path/steps/{concept_id}/uncomplete", headers=session["headers"]
    ).json()
    step = next(s for s in undone["steps"] if s["concept_id"] == concept_id)
    assert step["completed"] is False


def test_completing_unknown_step_is_404(client, session):
    seed_analysis(session["id"])
    client.get("/api/path", headers=session["headers"])
    response = client.post(
        "/api/path/steps/does-not-exist/complete", headers=session["headers"]
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "step_not_found"


def test_empty_path_before_analysis(client, session):
    path = client.get("/api/path", headers=session["headers"]).json()
    assert path["steps"] == []
