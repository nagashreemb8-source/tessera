"""Tessera FastAPI application.

Run with:  uvicorn app.main:app --reload --port 8000
Docs:      http://localhost:8000/docs
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .analysis import mark_interrupted_analyses
from .config import get_settings
from .db import init_db
from .errors import install_error_handlers
from .routers import analysis, diagnosis, documents, explain, health, materials, path, progress, quizzes, tutor

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("tessera")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    mark_interrupted_analyses()
    settings = get_settings()
    log.info(
        "Tessera backend ready (db=%s, llm_configured=%s, cors=%s)",
        settings.db_path,
        settings.llm_configured,
        settings.cors_origin_list,
    )
    if not settings.llm_configured:
        log.warning(settings.llm_config_error())
    yield


app = FastAPI(
    title="Tessera API",
    description=(
        "Document-grounded study diagnosis for Tessera. Upload PDFs, analyse them, "
        "ask the tutor, generate study materials, take diagnostic quizzes and get an "
        "evidence-based root-cause diagnosis."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

_settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.cors_origin_list,
    allow_credentials=False,  # no cookies: the session id travels in X-Session-Id
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Session-Id", "Accept"],
    expose_headers=["Content-Type"],
    max_age=600,
)

install_error_handlers(app)

for module in (
    health,
    documents,
    analysis,
    tutor,
    materials,
    quizzes,
    diagnosis,
    path,
    progress,
    explain,
):
    app.include_router(module.router)


@app.get("/")
def root() -> dict:
    return {
        "name": "Tessera API",
        "docs": "/docs",
        "health": "/api/health",
        "note": "Create a session with POST /api/sessions, then send X-Session-Id on every request.",
    }
