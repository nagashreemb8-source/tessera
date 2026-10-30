from __future__ import annotations

from conftest import question_ids, seed_analysis, seed_quiz, submit_answers


def run_quiz(client, session, questions, chosen: list[str | None]) -> tuple[dict, dict]:
    quiz_id = seed_quiz(session["id"], questions)
    ids = question_ids(session["id"], quiz_id)
    answers = {qid: choice for qid, choice in zip(ids, chosen)}
    attempt = submit_answers(client, session["headers"], quiz_id, answers)
    response = client.post(
        "/api/diagnosis",
        headers=session["headers"],
        json={"attempt_id": attempt["attempt_id"]},
    )
    assert response.status_code == 200, response.text
    return attempt, response.json()


def test_prerequisite_error_explains_dependent_errors(client, session):
    seed_analysis(session["id"])
    questions = [
        {"prompt": "Expected value question 1", "tested": ["expected"]},
        {"prompt": "Expected value question 2", "tested": ["expected"]},
        {"prompt": "Variance question 1", "tested": ["variance"]},
        {"prompt": "Variance question 2", "tested": ["variance"]},
        {"prompt": "Random variables question", "tested": ["variables"]},
    ]
    _, diagnosis = run_quiz(client, session, questions, ["B", "B", "C", "C", "A"])

    assert diagnosis["observed"], "mistakes should be observed facts"
    assert diagnosis["statuses"]["variables"] == "mastered"
    assert diagnosis["statuses"]["expected"] == "developing"
    assert diagnosis["statuses"]["variance"] == "developing"
    assert diagnosis["statuses"]["basics"] == "untested"

    top = diagnosis["gaps"][0]
    assert top["concept_id"] == "expected"
    assert top["kind"] == "prerequisite"
    assert "variance" in top["dependent_concept_ids"]
    assert top["evidence"] in {"Some", "Stronger"}
    assert top["needs_more_evidence"] is False
    assert top["alternatives"]
    assert top["why"]
    assert top["recommended_follow_up"]["concept_id"] == "expected"
    # Hedged wording, not a verdict.
    assert any(word in top["summary"].lower() for word in ("possible", "suggest", "hypothesis"))
    # A correct prerequisite is never blamed.
    assert all(gap["concept_id"] != "variables" for gap in diagnosis["gaps"])


def test_single_isolated_error_needs_more_evidence(client, session):
    seed_analysis(session["id"])
    questions = [
        {"prompt": "Expected value question", "tested": ["expected"]},
        {"prompt": "Variance question", "tested": ["variance"]},
    ]
    _, diagnosis = run_quiz(client, session, questions, ["A", "B"])

    assert len(diagnosis["gaps"]) == 1
    gap = diagnosis["gaps"][0]
    assert gap["concept_id"] == "variance"
    assert gap["kind"] == "self"
    assert gap["evidence"] == "Limited"
    assert gap["needs_more_evidence"] is True
    assert gap["supported_prerequisites"] == ["Expected Value"]


def test_isolated_error_does_not_blame_upstream(client, session):
    seed_analysis(session["id"])
    questions = [
        {"prompt": "Variables question", "tested": ["variables"]},
        {"prompt": "Distributions question", "tested": ["distributions"]},
    ]
    _, diagnosis = run_quiz(client, session, questions, ["A", "B"])

    gap_concepts = {gap["concept_id"] for gap in diagnosis["gaps"]}
    assert gap_concepts == {"distributions"}
    assert diagnosis["gaps"][0]["kind"] == "self"
    assert diagnosis["gaps"][0]["supported_prerequisites"] == ["Random Variables"]


def test_no_diagnosis_for_unanswered_questions(client, session):
    seed_analysis(session["id"])
    questions = [{"prompt": "Expected value question", "tested": ["expected"]}]
    _, diagnosis = run_quiz(client, session, questions, [None])
    assert diagnosis["gaps"] == []
    assert diagnosis["statuses"]["expected"] == "untested"


def test_follow_up_correct_answer_resolves_hypothesis(client, session):
    seed_analysis(session["id"])
    questions = [
        {"prompt": "Expected value question 1", "tested": ["expected"]},
        {"prompt": "Expected value question 2", "tested": ["expected"]},
        {"prompt": "Variance question", "tested": ["variance"]},
    ]
    _, first = run_quiz(client, session, questions, ["B", "B", "C"])
    gap_id = first["gaps"][0]["concept_id"]
    assert gap_id == "expected"

    followup_quiz = seed_quiz(
        session["id"],
        [
            {"prompt": "Fresh expected value question 1", "tested": ["expected"]},
            {"prompt": "Fresh expected value question 2", "tested": ["expected"]},
        ],
        followup=["expected"],
    )
    ids = question_ids(session["id"], followup_quiz)
    submit_answers(client, session["headers"], followup_quiz, {ids[0]: "A", ids[1]: "A"})

    latest = client.get("/api/diagnosis/latest", headers=session["headers"]).json()["diagnosis"]
    gap = next(g for g in latest["gaps"] if g["concept_id"] == "expected")
    assert gap["hypothesis_outcome"] == "supported"

    progress = client.get("/api/progress", headers=session["headers"]).json()
    assert progress["gaps_resolved"] >= 1
    expected = next(c for c in progress["concepts"] if c["concept_id"] == "expected")
    assert expected["status"] == "mastered"


def test_follow_up_wrong_answer_keeps_hypothesis_open(client, session):
    seed_analysis(session["id"])
    questions = [
        {"prompt": "Expected value question 1", "tested": ["expected"]},
        {"prompt": "Expected value question 2", "tested": ["expected"]},
        {"prompt": "Variance question", "tested": ["variance"]},
    ]
    run_quiz(client, session, questions, ["B", "B", "C"])
    followup_quiz = seed_quiz(
        session["id"],
        [{"prompt": "Fresh expected value question", "tested": ["expected"]}],
        followup=["expected"],
    )
    ids = question_ids(session["id"], followup_quiz)
    submit_answers(client, session["headers"], followup_quiz, {ids[0]: "D"})

    latest = client.get("/api/diagnosis/latest", headers=session["headers"]).json()["diagnosis"]
    gap = next(g for g in latest["gaps"] if g["concept_id"] == "expected")
    assert gap["hypothesis_outcome"] == "possible-gap"
    progress = client.get("/api/progress", headers=session["headers"]).json()
    assert progress["gaps_open"] >= 1


def test_diagnosis_requires_own_attempt(client, session):
    response = client.post(
        "/api/diagnosis", headers=session["headers"], json={"attempt_id": "att_missing"}
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "attempt_not_found"
