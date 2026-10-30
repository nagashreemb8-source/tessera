# Backend contract

This documents the API implemented in [`backend/`](../backend/README.md). Demo
mode needs none of it: with `VITE_API_BASE_URL` empty, scoring, diagnosis and
explanations stay local (`src/engine`, `src/data`, `src/services/explanationService.ts`).

Interactive docs: `http://localhost:8000/docs`. Setup: see
[backend/README.md](../backend/README.md).

## Switching on

```sh
# project root .env
VITE_API_BASE_URL=http://localhost:8000
```

`src/services/apiConfig.ts` is the only switch. `src/services/api.ts` adds the
session header, unwraps the error envelope and handles uploads/timeouts;
`src/services/adapters.ts` maps responses into the UI's existing types. No key
or provider URL exists in frontend code.

## Sessions

- `POST /api/sessions` → `{ "session_id": "…", "created_at": "…" }`
- Every other request sends `X-Session-Id: <uuid>`.
- A session only sees its own data; foreign resources answer **404**.
- `DELETE /api/sessions/{id}/data` deletes that session's rows and uploaded files.

Missing or malformed session header: `400 invalid_session_id`. Unknown session:
`404 session_not_found`.

## Errors

Every failure uses one envelope and an accurate status code:

```json
{
  "error": {
    "code": "document_not_found",
    "message": "That document does not exist in this session.",
    "details": {}
  }
}
```

Codes include `invalid_request`, `invalid_session_id`, `session_not_found`,
`not_a_pdf`, `corrupted_pdf`, `encrypted_pdf`, `empty_pdf`, `scanned_pdf`,
`too_large`, `too_many_pages`, `too_many_files`, `duplicate_document`,
`no_documents`, `analysis_running`, `llm_not_configured`, `llm_auth_failed`,
`llm_model_unavailable`, `llm_timeout`, `llm_rate_limited`, `llm_bad_output`,
`quiz_not_found`, `attempt_not_found`, `rate_limited`.

## Upload

`POST /api/documents` — multipart, field `files` (repeatable).

```json
{
  "results": [
    {
      "filename": "lecture3.pdf",
      "status": "processed",
      "document_id": "…",
      "page_count": 12,
      "chunk_count": 34,
      "warnings": [],
      "error_code": null,
      "message": "Processed 12 pages."
    }
  ],
  "documents": [ /* current list for the session */ ]
}
```

`status` is `processed`, `partial` (some pages had no extractable text) or
`rejected`. One bad file never fails the batch. Scanned PDFs are reported as
`scanned_pdf` — OCR is **not** performed.

Also: `GET /api/documents`, `GET /api/documents/{id}`,
`GET /api/documents/{id}/pages/{n}`, `DELETE /api/documents/{id}` (the delete
response reports how many analyses, quizzes, attempts and materials were
invalidated).

## Analysis

- `POST /api/analysis` starts a background run (409 `analysis_running` if one is
  already going).
- `GET /api/analysis/status` → `{ status, progress, stage, error }`.
- `GET /api/analysis` → stored result:

```json
{
  "id": "…",
  "status": "ready",
  "progress": 1.0,
  "stage": "done",
  "error": null,
  "result": {
    "overall_summary": "…",
    "document_summaries": [{ "document_id": "…", "document_name": "…", "summary": "…" }],
    "topics": [{ "name": "…", "summary": "…", "source_pages": [{ "document_id": "…", "pages": [4] }] }],
    "definitions": [{ "term": "…", "definition": "…", "source_pages": [] }],
    "formulas": [{ "name": "…", "expression": "…", "meaning": "…", "source_pages": [] }],
    "concepts": [
      { "id": "maximum-likelihood", "name": "Maximum Likelihood", "description": "…",
        "level": 2, "importance": 0.8, "source_pages": [] }
    ],
    "edges": [
      { "from_id": "derivatives", "to_id": "maximum-likelihood", "rationale": "…",
        "source": "document", "confidence": 0.8, "pages": [] }
    ]
  }
}
```

The concept graph is validated server-side: unique ids, no dangling edges, no
self-loops, acyclic. Each edge is marked `document` or `inferred` — the UI shows
inferred edges as hypotheses.

## Tutor

```json
POST /api/tutor/ask
{ "question": "Why does the log appear in the MLE derivation?",
  "document_ids": [], "concept_id": "maximum-likelihood",
  "history": [{ "role": "user", "content": "…" }],
  "allow_general_knowledge": false }
```

```json
{ "answer": "… [p. 7]",
  "supported": true,
  "not_found": false,
  "citations": [{ "document_id": "…", "document_name": "notes.pdf", "page": 7, "snippet": "…" }],
  "passages": [{ "document_id": "…", "document_name": "notes.pdf", "page_start": 7,
                 "page_end": 7, "text": "…", "score": 12.4 }] }
```

Citations are verified against the retrieved passages; ones pointing at unseen
pages are removed. When retrieval confidence is too low the answer is
`not_found: true` and the message says the documents do not cover it.
`GET /api/tutor/history` returns stored turns.

## Study materials

`POST /api/materials/{notes|flashcards|practice-questions|simplified-explanation}`

```json
{ "concept_ids": ["…"], "document_ids": [], "page_start": 3, "page_end": 9,
  "count": 8, "difficulty": "medium" }
```

All four return a stored `MaterialOut` (`id`, `kind`, `concept_ids`,
`concept_names`, `created_at`, `payload`). Every item in `payload` carries page
references; items citing pages outside the supplied material are dropped.
`GET /api/materials`, `GET /api/materials/{id}`, `DELETE /api/materials/{id}`.

## Quizzes and grading

`POST /api/quizzes`

```json
{ "num_questions": 8, "concept_ids": [], "difficulty_mix": { "easy": 0.3, "medium": 0.5, "hard": 0.2 } }
```

```json
{ "id": "quiz-…", "question_count": 8, "created_at": "…" }
```

`GET /api/quizzes/{id}` returns questions for taking: prompt, options A–D,
difficulty, tested concepts, source pages. **No correct answers and no
misconception labels** — those stay on the server.

`POST /api/quizzes/{id}/submit`

```json
{ "answers": { "question-id": "B", "other-question": null },
  "time_taken_seconds": 312 }
```

Grading is deterministic code, never a model call. The response is a
`GradedAttempt`: `score`, `total`, `answered`, per-question `correct`,
`correct_option`, `misconception`, `explanation`, and per-concept
`correct / answered / wrong_question_ids`.

`POST /api/quizzes/followup` (`concept_ids`, `num_questions`) generates fresh
questions aimed at the concepts a diagnosis is unsure about.

## Diagnosis

`POST /api/diagnosis` with `{ "attempt_id": "…" }`; `GET /api/diagnosis/latest`.

```json
{
  "diagnosis": {
    "id": "…", "attempt_id": "…", "created_at": "…",
    "observed": [
      { "question_id": "…", "concept_ids": ["variance"], "concept_names": ["Variance"],
        "chosen": "B", "correct_answer": "D", "pattern": "Treated variance as linear.",
        "unanswered": false, "prompt": "…", "options": { "A": "…" } }
    ],
    "statuses": { "variance": "developing", "expected-value": "mastered" },
    "gaps": [
      { "concept_id": "expected-value", "concept_name": "Expected Value",
        "kind": "prerequisite", "supporting_question_ids": ["…"],
        "dependent_concept_ids": ["variance"], "dependent_concept_names": ["Variance"],
        "supported_prerequisites": [], "alternatives": ["Careless arithmetic."],
        "evidence": "Limited", "needs_more_evidence": true,
        "summary": "…", "why": "…",
        "page_references": [{ "document_id": "…", "document_name": "notes.pdf", "page": 7, "snippet": "…" }],
        "recommended_follow_up": { "concept_id": "expected-value", "concept_name": "Expected Value", "prompt": "…" },
        "hypothesis_outcome": null }
    ],
    "concepts": [ /* nodes, so the UI can draw the map without re-fetching analysis */ ]
  }
}
```

`observed` holds facts (which question, which wrong option, which misconception
it represents). `gaps` holds hypotheses with an evidence level
(`Limited`/`Some`/`Stronger`), alternatives and a confirming follow-up. Absence
of evidence never produces a confident claim.

## Learning path

`GET /api/path`, `POST /api/path/refresh`

```json
{ "id": "…", "created_at": "…", "completed_count": 0,
  "steps": [
    { "concept_id": "expected-value", "concept_name": "Expected Value", "verb": "Review",
      "reason": "…", "prerequisites_in_path": ["random-variables"], "minutes": 18,
      "page_references": [{ "document_id": "…", "document_name": "notes.pdf", "pages": [4,5] }],
      "material_ids": [], "completed": false, "ord": 0 }
  ],
  "concepts": [] }
```

Prerequisites always precede dependents; mastered concepts are dropped; the
order is recomputed after new attempts. `POST /api/path/steps/{concept_id}/complete`
and `/uncomplete`.

## Progress

`GET /api/progress` → per-concept status, trend, attempts and score history,
completed steps, open vs resolved gaps, recent activity and counts. Everything
is persisted in SQLite (`backend/data/tessera.db`) and keyed by session, so it
survives backend restarts and browser refreshes.

## Legacy explanation endpoint

`POST /api/explain` keeps its original shape and still works with no session
header and no documents. When the caller sends `X-Session-Id` and that session
has documents, the explanation is grounded in retrieved passages.

Request:

```json
{ "conceptId": "expected-value", "conceptName": "Expected Value",
  "evidence": [{ "questionId": 3, "prompt": "…", "chosen": "B", "correct": "A", "pattern": "…" }] }
```

Response (200): `{ "title": "…", "paragraphs": ["…"], "note": "…" }`

The UI falls back to its local template (labelled
"Demo explanation (backend unavailable)") on timeout, non-200 or a malformed
body. The header badge reports which mode is active and never claims the backend
is reachable when it is not.
