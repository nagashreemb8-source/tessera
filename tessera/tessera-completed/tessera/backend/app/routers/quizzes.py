"""Quiz generation, taking and deterministic submission."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from ..models import FollowUpRequest, QuizCreateRequest, QuizSubmitRequest
from ..quiz import (
    generate_followup,
    generate_quiz,
    grade_attempt,
    list_quizzes,
    public_quiz,
    quiz_attempts,
    update_hypotheses_from_attempt,
)
from ..ratelimit import check_llm_rate
from ..sessions import get_session_id

router = APIRouter(prefix="/api/quizzes", tags=["quizzes"])


@router.post("")
async def create_quiz(request: QuizCreateRequest, session_id: str = Depends(get_session_id)) -> dict:
    check_llm_rate(session_id)
    return await generate_quiz(session_id, request)


@router.get("")
def get_quizzes(session_id: str = Depends(get_session_id)) -> dict:
    return {"quizzes": list_quizzes(session_id)}


@router.post("/followup")
async def create_followup(request: FollowUpRequest, session_id: str = Depends(get_session_id)) -> dict:
    check_llm_rate(session_id)
    return generate_followup(session_id, request.concept_ids, request.num_questions)


# NOTE: no correct answers or misconception labels are returned here.
@router.get("/{quiz_id}")
def get_quiz(quiz_id: str, session_id: str = Depends(get_session_id)) -> dict:
    return public_quiz(session_id, quiz_id)


@router.post("/{quiz_id}/submit")
def submit_quiz(
    quiz_id: str,
    submission: QuizSubmitRequest,
    session_id: str = Depends(get_session_id),
) -> dict:
    attempt = grade_attempt(session_id, quiz_id, submission)
    update_hypotheses_from_attempt(session_id, attempt)
    return attempt


@router.get("/{quiz_id}/attempts")
def get_attempts(quiz_id: str, session_id: str = Depends(get_session_id)) -> dict:
    return {"attempts": quiz_attempts(session_id, quiz_id)}
