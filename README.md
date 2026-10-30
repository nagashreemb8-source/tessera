# Tessera — AI Study Detective

Don't just learn what you got wrong. Discover why.

Upload your own course PDFs and Tessera analyses them, tutors you from the actual
pages, generates study material and diagnostic quizzes, then explains *why* you
are struggling — separating observed mistakes from suspected gaps — and builds a
learning path that fixes the cause first.

NVIDIA × Nebius Global AI Hackathon (Best Apps and Agents).

## Two modes

| | Demo mode (default) | AI mode |
| --- | --- | --- |
| Switch | `VITE_API_BASE_URL` empty | `VITE_API_BASE_URL=http://localhost:8000` |
| Content | Sample subject (Probability & Statistics) | Your uploaded PDFs |
| Scoring / diagnosis | Deterministic, in the browser | Deterministic, on the backend |
| Explanations | Hand-written templates | Document-grounded, cited to pages |
| Needs a key | No | Yes, in `backend/.env` only |

The header badge always states which mode is active. In AI mode the UI never
falls back to sample data silently: it shows the error and a retry.

## Run the frontend

```sh
npm install
npm run dev      # http://localhost:3000 (or the port Vite prints)
npm run build
npm run lint
npm test
```

## Run the backend (AI mode)

Windows PowerShell:

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1        # or: Set-ExecutionPolicy -Scope Process Bypass
pip install -r requirements.txt
copy .env.example .env             # then fill in your own Nebius values locally
python scripts\list_models.py      # confirm which model ids your key offers
uvicorn app.main:app --reload --port 8000
```

Then, in the project root:

```powershell
copy .env.example .env
# set VITE_API_BASE_URL=http://localhost:8000 in .env
npm run dev
```

Or double-click `backend\run_dev.ps1` in PowerShell to create the venv, install
and start in one step. Details, cmd.exe equivalents, the full endpoint list and
troubleshooting live in [backend/README.md](backend/README.md).

API keys stay in `backend/.env` (gitignored) and are read from environment
variables by the server. The browser only ever calls your backend.

## Journey

**AI mode:** Documents → Analysis → Tutor / Study materials → Diagnose → Results →
Root Cause Replay → Knowledge Map → Learning Path → Concept lesson → Progress.

**Demo mode:** Overview → Diagnose → Results → Root Cause Replay → Knowledge Map →
Learning Path → Concept lesson → Progress. Progress is saved in the browser.

## Structure

- `src/routes` — thin route files (generated `routeTree.gen.ts` refreshes on dev/build)
- `src/pages` — screens (each works in demo mode and AI mode)
- `src/engine/diagnose.ts` — deterministic demo scoring, gaps, hypotheses, path
- `src/data` — sample subject: concepts, questions, lessons, practice
- `src/state/AppState.tsx`, `src/state/BackendContext.tsx` — local + backend state
- `src/services/api.ts` — typed API client (session header, error envelope, upload)
- `src/services/adapters.ts` — backend payloads → the UI's existing types
- `backend/` — FastAPI service (see [backend/README.md](backend/README.md))
- `docs/BACKEND_CONTRACT.md` — API reference, including the legacy `/api/explain`

## Tests

```sh
npm test                                   # frontend: demo engine, routing, API client, adapters
cd backend && .\.venv\Scripts\python.exe -m pytest -q   # backend: 68 offline tests
```
