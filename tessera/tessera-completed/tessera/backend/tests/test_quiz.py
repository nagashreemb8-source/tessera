from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.models import GeneratedQuestion
from conftest import seed_analysis, seed_quiz, submit_answers


@pytest.fixture()
def analysed(client, session, fake_llm):
    from conftest import upload_text_pdf
    from test_analysis import wait_for_analysis

    upload_text_pdf(client, session["headers"])
    client.post("/api/analysis", headers=session["headers"])
    assert wait_for_analysis(client, session["headers"])["status"] == "ready"
    return session


def test_generated_quiz_does_not_leak_answers(client, analysed):
    response = client.post(
        "/api/quizzes",
        headers=analysed["headers"],
        json={"num_questions": 4, "difficulty_mix": {"easy": 0.5, "medium": 0.5, "hard": 0}},
    )
    assert response.status_code == 200, response.text
    quiz = response.json()
    assert quiz["question_count"] >= 3

    public = client.get(f"/api/quizzes/{quiz['id']}", headers=analysed["headers"]).json()
    assert len(public["questions"]) == quiz["question_count"]
    for question in public["questions"]:
        assert set(question["options"]) == {"A", "B", "C", "D"}
        assert "correct" not in question
        assert "correct_option" not in question
        assert "misconceptions" not in question
        assert "explanation" not in question
        assert question["tested_concept_ids"]
        assert question["source_pages"]


def test_grading_is_deterministic_and_handles_unanswered(client, session):
    seed_analysis(session["id"])
    quiz_id = seed_quiz(
        session["id"],
        [
            {"prompt": "Q1 expected?", "tested": ["expected", "variables"], "correct": "A"},
            {"prompt": "Q2 variance?", "tested": ["variance"], "correct": "A"},
        ],
    )
    from conftest import question_ids

    ids = question_ids(session["id"], quiz_id)
    attempt = submit_answers(
        client, session["headers"], quiz_id, {ids[0]: "A", ids[1]: None}
    )
    assert attempt["score"] == 1
    assert attempt["total"] == 2
    assert attempt["answered"] == 1
    questions = {q["id"]: q for q in attempt["questions"]}
    assert questions[ids[0]]["correct"] is True
    assert questions[ids[1]]["answered"] is False
    assert questions[ids[1]]["correct"] is False
    assert questions[ids[1]]["correct_option"] == "A"

    concepts = {c["concept_id"]: c for c in attempt["concepts"]}
    assert concepts["expected"]["correct"] == 1 and concepts["expected"]["answered"] == 1
    assert concepts["variance"]["answered"] == 0
    assert concepts["variance"]["wrong_question_ids"] == []


def test_wrong_answers_reveal_misconception_after_submission(client, session):
    seed_analysis(session["id"])
    quiz_id = seed_quiz(
        session["id"],
        [
            {
                "prompt": "Q1 expected?",
                "tested": ["expected"],
                "misconceptions": {"B": "Ignored the probability weights."},
            }
        ],
    )
    from conftest import question_ids

    question_id = question_ids(session["id"], quiz_id)[0]
    attempt = submit_answers(client, session["headers"], quiz_id, {question_id: "B"})
    question = attempt["questions"][0]
    assert question["misconception"] == "Ignored the probability weights."
    assert question["chosen"] == "B"
    assert question["correct_text"]


def test_cannot_submit_same_quiz_twice(client, session):
    seed_analysis(session["id"])
    quiz_id = seed_quiz(session["id"], [{"prompt": "Q?", "tested": ["expected"]}])
    from conftest import question_ids

    question_id = question_ids(session["id"], quiz_id)[0]
    submit_answers(client, session["headers"], quiz_id, {question_id: "A"})
    second = client.post(
        f"/api/quizzes/{quiz_id}/submit",
        headers=session["headers"],
        json={"answers": {question_id: "A"}},
    )
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "quiz_already_submitted"


def test_invalid_question_schema_is_rejected():
    base = dict(
        prompt="A valid question prompt?",
        options={"A": "one", "B": "two", "C": "three", "D": "four"},
        correct_option="A",
        difficulty="easy",
        tested_concepts=["expected"],
        source_pages=[{"document_id": "doc", "pages": [1]}],
        misconceptions={"B": "b", "C": "c", "D": "d"},
        explanation="because",
    )
    GeneratedQuestion(**base)

    with pytest.raises(ValidationError):
        GeneratedQuestion(**{**base, "options": {"A": "same", "B": "same", "C": "three", "D": "four"}})
    with pytest.raises(ValidationError):
        GeneratedQuestion(**{**base, "options": {"A": "one", "B": "two", "C": "three"}})
    with pytest.raises(ValidationError):
        GeneratedQuestion(**{**base, "misconceptions": {"B": "b"}})
    with pytest.raises(ValidationError):
        GeneratedQuestion(**{**base, "correct_option": "E"})


def test_submission_requires_valid_option(client, session):
    seed_analysis(session["id"])
    quiz_id = seed_quiz(session["id"], [{"prompt": "Q?", "tested": ["expected"]}])
    response = client.post(
        f"/api/quizzes/{quiz_id}/submit",
        headers=session["headers"],
        json={"answers": {"whatever": "Z"}},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_quiz_requires_analysis(client, session):
    response = client.post(
        "/api/quizzes", headers=session["headers"], json={"num_questions": 4}
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "analysis_required"
