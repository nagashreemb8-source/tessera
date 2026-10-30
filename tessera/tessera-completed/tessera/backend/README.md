# Tessera backend

FastAPI service that turns a student's own PDFs into a grounded study session:
analysis, tutor answers, study materials, diagnostic quizzes, root-cause
diagnosis, a prerequisite-aware learning path and progress tracking.

No login, no paid services beyond your own LLM API key, no Docker, no Redis,
no external database. One Python process + one SQLite file.

## Requirements

- Python 3.10+ (3.11/3.12 fine) on Windows, macOS or Linux
- A Nebius Token Factory account (OpenAI-compatible API) for AI features.
  Everything except the AI calls works without a key: upload, extraction,
  retrieval, grading and diagnosis are deterministic.

## Windows PowerShell setup

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
# edit backend\.env locally and set NEBIUS_API_KEY / NEBIUS_BASE_URL / NEBIUS_MODEL
python scripts\list_models.py     # prints the model ids your key can actually use
uvicorn app.main:app --reload --port 8000
```

If `Activate.ps1` is blocked:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

Or skip activation entirely and use the venv interpreter directly:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

`.\run_dev.ps1` does the venv creation, install and start in one step.

## Command Prompt (cmd.exe)

```bat
cd backend
py -m venv .venv
.venv\Scripts\activate.bat
pip install -r requirements.txt
copy .env.example .env
python scripts\list_models.py
uvicorn app.main:app --reload --port 8000
```

## Configuration (`backend/.env`)

`backend/.env` is gitignored. Never commit it, never paste its contents into a
chat, an issue or a screenshot. Only `backend/.env.example` (empty values) is
committed.

| Variable | Meaning |
| --- | --- |
| `NEBIUS_API_KEY` | Your Token Factory key. Never sent to the browser. |
| `NEBIUS_BASE_URL` | OpenAI-compatible base URL from your dashboard (verify — do not guess). |
| `NEBIUS_MODEL` | Exact model id from `scripts/list_models.py`. |
| `NEBIUS_EMBEDDING_MODEL` | Optional. Leave empty: lexical BM25 retrieval is the default and needs no service. |
| `CORS_ORIGINS` | Comma-separated browser origins. Default covers ports 3000 and 5173. |
| `MAX_UPLOAD_MB` | Per-file upload limit (default 25). |
| `MAX_FILES_PER_SESSION` | Documents per study session (default 20). |
| `MAX_PAGES_PER_PDF` | Page limit per file (default 400). |
| `LLM_TIMEOUT_SECONDS` | Per-request timeout (default 90). |
| `LLM_MAX_RETRIES` | Retries with backoff for transient failures (default 2). |
| `LLM_CONCURRENCY` | In-flight model calls allowed at once (default 3). |
| `LLM_MAX_PROMPT_CHARS` | Prompt size guard used by map-reduce analysis (default 24000). |
| `DATA_DIR` | SQLite + uploaded PDFs (default `backend/data`, gitignored). |

Without a configured key the server still starts; AI endpoints return a clean
`llm_not_configured` error (HTTP 503) and `GET /api/health` reports booleans
only. Check readiness with `GET /api/health/llm`.

## Tests

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -q
```

The suite runs fully offline: a fake LLM client, generated PDFs and a temporary
database. It covers PDF validation and extraction, session isolation, retrieval,
quiz secrecy and deterministic grading, the diagnosis scenarios, learning-path
ordering, LLM failure mapping, CORS and the legacy `POST /api/explain`.

## HTTP API

All routes are under `/api`; interactive docs at `/docs`, OpenAPI at
`/openapi.json`. Errors use one envelope:

```json
{ "error": { "code": "document_not_found", "message": "…", "details": {} } }
```

### Sessions

No accounts. `POST /api/sessions` returns an unguessable `session_id`; send it
as `X-Session-Id` on every other request. Each session sees only its own rows,
and a foreign id answers 404, not 403. `DELETE /api/sessions/{id}/data` wipes
that session's documents, files, quizzes and progress.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Service + DB status, LLM-configured booleans |
| GET | `/api/health/llm` | Real provider reachability and model availability |
| POST | `/api/sessions` | Create a session |
| DELETE | `/api/sessions/{id}/data` | Delete everything for this session |
| POST | `/api/documents` | Upload one or more PDFs (multipart `files`) |
| GET | `/api/documents` | List this session's documents |
| GET | `/api/documents/{id}` | Document metadata |
| GET | `/api/documents/{id}/pages/{n}` | Extracted text of page `n` |
| DELETE | `/api/documents/{id}` | Delete a document and invalidate dependents |
| POST | `/api/analysis` | Start (or restart) analysis in the background |
| GET | `/api/analysis/status` | Progress of the running analysis |
| GET | `/api/analysis` | Stored analysis: summaries, topics, definitions, formulas, concept map |
| POST | `/api/tutor/ask` | Retrieval-grounded question answering with page citations |
| GET | `/api/tutor/history` | Stored conversation turns |
| POST | `/api/materials/notes` | Revision notes |
| POST | `/api/materials/flashcards` | Flashcards |
| POST | `/api/materials/practice-questions` | Practice questions with worked answers |
| POST | `/api/materials/simplified-explanation` | Plain-language explanation + analogy |
| GET | `/api/materials` | List generated materials |
| GET/DELETE | `/api/materials/{id}` | Read or delete one material |
| POST | `/api/quizzes` | Generate a diagnostic quiz (MCQ only) |
| POST | `/api/quizzes/followup` | Follow-up quiz targeting suspected gaps |
| GET | `/api/quizzes` | Quiz list with latest scores |
| GET | `/api/quizzes/{id}` | Quiz for taking — **no answers, no misconception labels** |
| POST | `/api/quizzes/{id}/submit` | Submit answers; graded deterministically |
| GET | `/api/quizzes/{id}/attempts` | Attempts for a quiz |
| POST | `/api/diagnosis` | Diagnose a graded attempt |
| GET | `/api/diagnosis/latest` | Most recent diagnosis |
| GET | `/api/path` | Current learning path |
| POST | `/api/path/refresh` | Recompute the path |
| POST | `/api/path/steps/{concept_id}/complete` | Mark a step done |
| POST | `/api/path/steps/{concept_id}/uncomplete` | Undo that |
| GET | `/api/progress` | Aggregate progress and activity |
| POST | `/api/explain` | Backward-compatible explanation endpoint |

## How it works

```
app/config.py          settings from environment, limits, LLM readiness
app/db.py              SQLite schema (created on startup) + connection helpers
app/sessions.py        session creation, header validation, isolation dependency
app/pdf_processing.py  magic-byte checks, page-by-page extraction, chunking,
                       scanned-page detection (no OCR), per-file status
app/retrieval.py       BM25 over this session's chunks; swappable interface
app/llm.py             OpenAI-compatible client: JSON mode, timeouts, retries,
                       malformed-JSON repair, concurrency limit, fake-client hook
app/prompts.py         every prompt template, with untrusted document blocks
app/analysis.py        map-reduce analysis, DAG validation, merge/dedupe
app/tutor.py           retrieval first, citations verified against retrieved pages
app/study_materials.py notes / flashcards / practice / simplified explanations
app/quiz.py            generation, strict structural validation, grading
app/diagnosis.py       observed mistakes vs suspected gaps, deterministic evidence
app/learning_path.py   topological order, gap-first prioritisation
app/progress.py        per-concept aggregates and activity timeline
app/routers/*.py       thin HTTP layer per feature
```

Design rules worth knowing when reading the code:

- **Correctness is never delegated to the model.** Grading compares the chosen
  option with the stored correct option. Diagnosis walks the prerequisite graph
  with explicit thresholds; the model only phrases an explanation that is
  validated against the evidence before it is stored.
- **Retrieval happens before generation.** Tutor answers, materials and quiz
  items all receive labelled passages (document + page) and must cite pages
  that really exist in the retrieved set; invalid citations are stripped.
- **PDF text is untrusted data.** It is wrapped in delimited blocks with an
  instruction to ignore anything inside that looks like a command.
- **Map-reduce for large documents.** Chunks are grouped under
  `LLM_MAX_PROMPT_CHARS`, analysed in sections, then merged, deduplicated and
  validated as a DAG (no cycles, no self-loops, no dangling edges).

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `llm_not_configured` | `NEBIUS_API_KEY`, `NEBIUS_BASE_URL` or `NEBIUS_MODEL` is empty in `backend/.env`. |
| `llm_auth_failed` | Key rejected — check the key in the dashboard, not in chat. |
| `llm_model_unavailable` | Model id does not match your account; run `python scripts\list_models.py`. |
| `llm_timeout` | Raise `LLM_TIMEOUT_SECONDS` or upload smaller documents. |
| Upload reports `scanned_pdf` | The PDF has no text layer. OCR is not included; export a text PDF or run OCR externally. |
| Upload reports `encrypted_pdf` | Remove the password from the PDF first. |
| Browser blocked by CORS | Add the exact dev origin to `CORS_ORIGINS` and restart. |
| `WinError 10013` on port 8000 | Something else is using the port; pass `--port 8001` and update `VITE_API_BASE_URL`. |
| Analysis stuck after a crash | Restart the server: interrupted runs are marked failed and can be re-run. |

## Known limitations

- Scanned/image-only PDFs are detected and reported, but not OCR'd.
- Retrieval is lexical (BM25). Synonyms and paraphrase-heavy questions retrieve
  less well than exact terminology; an embeddings backend can be dropped into
  `retrieval.py` later.
- The concept map is capped (8–40 nodes) so quizzes stay meaningful.
- Diagnosis is deliberately conservative: few answered questions yield
  "more evidence needed" instead of a confident claim.
- No authentication: sessions are anonymous bearer tokens. Do not expose this
  backend publicly as-is.
