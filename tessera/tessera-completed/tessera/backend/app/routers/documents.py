"""PDF upload and document management."""
from __future__ import annotations

import logging
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, File, UploadFile

from .. import retrieval
from ..config import get_settings
from ..db import dumps, get_db, log_activity, new_id, utcnow
from ..errors import ApiError
from ..models import DocumentOut, PageOut, UploadFileResult, UploadResponse
from ..pdf_processing import (
    PDF_MAGIC,
    PdfError,
    chunk_pages,
    extract_pdf,
    sanitise_filename,
    sha256_bytes,
)
from ..sessions import SESSION_HEADER, get_session_id

router = APIRouter(prefix="/api/documents", tags=["documents"])
log = logging.getLogger("tessera.documents")

ALLOWED_CONTENT_TYPES = {"application/pdf", "application/octet-stream", "binary/octet-stream", ""}


def _doc_out(row) -> DocumentOut:
    from ..db import loads

    return DocumentOut(
        id=row["id"],
        filename=row["filename"],
        status=row["status"],
        page_count=int(row["page_count"] or 0),
        chunk_count=int(row["chunk_count"] or 0),
        size_bytes=int(row["size_bytes"] or 0),
        warnings=loads(row["warnings"], []) or [],
        error_code=row["error_code"],
        created_at=row["created_at"],
    )


def list_documents(session_id: str) -> list[DocumentOut]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM documents WHERE session_id = ? ORDER BY created_at, rowid", (session_id,)
        ).fetchall()
    return [_doc_out(row) for row in rows]


@router.post("", response_model=UploadResponse)
async def upload_documents(
    files: list[UploadFile] = File(...),
    session_id: str = Depends(get_session_id),
) -> UploadResponse:
    settings = get_settings()
    max_bytes = settings.max_upload_mb * 1024 * 1024
    if len(files) > settings.max_files_per_session:
        raise ApiError(
            413,
            "too_many_files",
            f"You can upload at most {settings.max_files_per_session} files per session.",
        )
    with get_db() as conn:
        existing_count = conn.execute(
            "SELECT COUNT(*) AS c FROM documents WHERE session_id = ? AND status != 'rejected'",
            (session_id,),
        ).fetchone()["c"]
    if existing_count >= settings.max_files_per_session:
        raise ApiError(
            413,
            "too_many_files",
            f"This session already has {existing_count} documents "
            f"(limit {settings.max_files_per_session}). Delete one before uploading more.",
        )

    folder = settings.uploads_dir / session_id
    folder.mkdir(parents=True, exist_ok=True)

    results: list[UploadFileResult] = []
    for upload in files:
        raw_name = upload.filename or "document.pdf"
        display_name = sanitise_filename(raw_name)
        try:
            content = await upload.read(max_bytes + 1)
        finally:
            await upload.close()
        try:
            result = _process_one(session_id, display_name, upload.content_type or "", content, folder, settings)
        except Exception as exc:  # noqa: BLE001 - one bad file must not fail the batch
            log.warning("upload processing error (%s)", type(exc).__name__)
            result = UploadFileResult(
                filename=display_name,
                status="rejected",
                error_code="processing_error",
                message="This file could not be processed. Please try another PDF.",
            )
        results.append(result)

    return UploadResponse(results=results, documents=list_documents(session_id))


def _reject(
    session_id: str,
    filename: str,
    content: bytes,
    code: str,
    message: str,
    warnings: list[str] | None = None,
) -> UploadFileResult:
    """Persist a rejected upload so the UI can show what happened.

    Rejected rows never store the content hash (a random marker is used instead) so the
    same broken file can be retried after the student fixes it.
    """
    doc_id = new_id()
    with get_db() as conn:
        conn.execute(
            "INSERT INTO documents (id, session_id, filename, stored_path, sha256, size_bytes, "
            "page_count, chunk_count, status, error_code, warnings, created_at) "
            "VALUES (?, ?, ?, '', ?, ?, 0, 0, 'rejected', ?, ?, ?)",
            (
                doc_id,
                session_id,
                filename,
                f"rejected-{doc_id}",
                len(content),
                code,
                dumps(warnings or []),
                utcnow(),
            ),
        )
        log_activity(
            conn,
            session_id,
            "upload",
            f"Rejected {filename}: {message[:160]}",
        )
    return UploadFileResult(
        filename=filename,
        status="rejected",
        document_id=doc_id,
        warnings=warnings or [],
        error_code=code,
        message=message,
    )


def _safe_unlink(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        # A scanner/backup process may still hold the file on Windows; the DB row is
        # authoritative and the orphaned file is harmless.
        log.warning("could not delete uploaded file")


def _process_one(session_id: str, filename: str, content_type: str, content: bytes, folder: Path, settings) -> UploadFileResult:
    max_bytes = settings.max_upload_mb * 1024 * 1024

    if not filename.lower().endswith(".pdf"):
        return _reject(session_id, filename, b"", "not_a_pdf", "Only PDF files are supported. Rename the file with a .pdf extension only if it really is a PDF.")
    if content_type.lower() not in ALLOWED_CONTENT_TYPES:
        return _reject(
            session_id,
            filename,
            b"",
            "unsupported_media_type",
            f"The browser sent content type '{content_type}', which is not a PDF.",
        )
    if not content:
        return _reject(session_id, filename, b"", "empty_file", "This file is empty.")
    if len(content) > max_bytes:
        return _reject(
            session_id,
            filename,
            b"",
            "too_large",
            f"This file is {len(content) / (1024 * 1024):.1f} MB. The limit is {settings.max_upload_mb} MB per file.",
        )
    if not content.lstrip()[:5] == PDF_MAGIC:
        return _reject(
            session_id,
            filename,
            content,
            "not_a_pdf",
            "This file does not start with the PDF signature, so it is not a real PDF.",
        )

    digest = sha256_bytes(content)
    with get_db() as conn:
        duplicate = conn.execute(
            "SELECT id, filename FROM documents WHERE session_id = ? AND sha256 = ? AND status != 'rejected'",
            (session_id, digest),
        ).fetchone()
    if duplicate:
        return UploadFileResult(
            filename=filename,
            status="rejected",
            document_id=duplicate["id"],
            error_code="duplicate_document",
            message=f"This exact file was already uploaded as '{duplicate['filename']}'.",
        )

    doc_id = new_id()
    stored_path = folder / f"{doc_id}.pdf"
    stored_path.write_bytes(content)

    try:
        extraction = extract_pdf(stored_path, settings.max_pages_per_pdf)
    except PdfError as exc:
        _safe_unlink(stored_path)
        return _reject(session_id, filename, content, exc.code, exc.message, exc.warnings)

    chunks = chunk_pages(
        doc_id,
        extraction.page_texts,
        chunk_size=settings.chunk_size,
        overlap=settings.chunk_overlap,
    )
    if not chunks:
        _safe_unlink(stored_path)
        return _reject(
            session_id,
            filename,
            content,
            "scanned_pdf",
            "No usable text could be extracted from this PDF. It may be scanned or image-only; run OCR first.",
        )

    with get_db() as conn:
        conn.execute(
            "INSERT INTO documents (id, session_id, filename, stored_path, sha256, size_bytes, "
            "page_count, chunk_count, status, error_code, warnings, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)",
            (
                doc_id,
                session_id,
                filename,
                str(stored_path),
                digest,
                len(content),
                extraction.page_count,
                len(chunks),
                extraction.status,
                dumps(extraction.warnings),
                utcnow(),
            ),
        )
        for page_no, text in extraction.page_texts:
            conn.execute(
                "INSERT INTO pages (document_id, session_id, page_no, text) VALUES (?, ?, ?, ?)",
                (doc_id, session_id, page_no, text),
            )
        for chunk in chunks:
            conn.execute(
                "INSERT INTO chunks (id, session_id, document_id, chunk_index, page_start, page_end, text) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    chunk["id"],
                    session_id,
                    chunk["document_id"],
                    chunk["chunk_index"],
                    chunk["page_start"],
                    chunk["page_end"],
                    chunk["text"],
                ),
            )
        log_activity(
            conn,
            session_id,
            "upload",
            f"Uploaded {filename}: {extraction.page_count} page(s), {len(chunks)} passage(s)",
        )
    retrieval.invalidate(session_id)

    message = (
        f"Processed {extraction.page_count} page(s) into {len(chunks)} passage(s)."
        if extraction.status == "processed"
        else "Processed the readable pages; some pages had no extractable text."
    )
    return UploadFileResult(
        filename=filename,
        status=extraction.status,  # type: ignore[arg-type]
        document_id=doc_id,
        page_count=extraction.page_count,
        chunk_count=len(chunks),
        warnings=extraction.warnings,
        message=message,
    )


@router.get("", response_model=list[DocumentOut])
def get_documents(session_id: str = Depends(get_session_id)) -> list[DocumentOut]:
    return list_documents(session_id)


@router.get("/{document_id}", response_model=DocumentOut)
def get_document(document_id: str, session_id: str = Depends(get_session_id)) -> DocumentOut:
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM documents WHERE id = ? AND session_id = ?", (document_id, session_id)
        ).fetchone()
    if row is None:
        raise ApiError(404, "document_not_found", "That document does not exist in your session.")
    return _doc_out(row)


@router.get("/{document_id}/pages/{page_no}", response_model=PageOut)
def get_page(document_id: str, page_no: int, session_id: str = Depends(get_session_id)) -> PageOut:
    with get_db() as conn:
        doc = conn.execute(
            "SELECT filename FROM documents WHERE id = ? AND session_id = ?",
            (document_id, session_id),
        ).fetchone()
        if doc is None:
            raise ApiError(404, "document_not_found", "That document does not exist in your session.")
        row = conn.execute(
            "SELECT text FROM pages WHERE document_id = ? AND session_id = ? AND page_no = ?",
            (document_id, session_id, page_no),
        ).fetchone()
    if row is None:
        raise ApiError(404, "page_not_found", "That page does not exist or has no extractable text.")
    text = row["text"]
    return PageOut(
        document_id=document_id,
        filename=doc["filename"],
        page_no=page_no,
        text=text,
        char_count=len(text),
    )


@router.delete("/{document_id}")
def delete_document(document_id: str, session_id: str = Depends(get_session_id)) -> dict:
    with get_db() as conn:
        doc = conn.execute(
            "SELECT * FROM documents WHERE id = ? AND session_id = ?", (document_id, session_id)
        ).fetchone()
        if doc is None:
            raise ApiError(404, "document_not_found", "That document does not exist in your session.")

        invalidated = {}
        for table, sql in [
            ("quizzes", "DELETE FROM quizzes WHERE session_id = ?"),
            ("attempts", "DELETE FROM attempts WHERE session_id = ?"),
            ("diagnoses", "DELETE FROM diagnoses WHERE session_id = ?"),
            ("hypotheses", "DELETE FROM hypotheses WHERE session_id = ?"),
            ("materials", "DELETE FROM materials WHERE session_id = ?"),
            ("analyses", "DELETE FROM analyses WHERE session_id = ?"),
            ("path_steps", "DELETE FROM path_steps WHERE session_id = ?"),
            ("path_versions", "DELETE FROM path_versions WHERE session_id = ?"),
            ("concept_edges", "DELETE FROM concept_edges WHERE session_id = ?"),
        ]:
            invalidated[table] = conn.execute(sql, (session_id,)).rowcount
        conn.execute("DELETE FROM quiz_questions WHERE session_id = ?", (session_id,))
        conn.execute("DELETE FROM pages WHERE document_id = ? AND session_id = ?", (document_id, session_id))
        conn.execute("DELETE FROM chunks WHERE document_id = ? AND session_id = ?", (document_id, session_id))
        conn.execute("DELETE FROM documents WHERE id = ? AND session_id = ?", (document_id, session_id))
        log_activity(
            conn,
            session_id,
            "delete",
            f"Deleted {doc['filename']} and invalidated dependent analysis and quizzes",
        )

    if doc["stored_path"]:
        _safe_unlink(Path(doc["stored_path"]))
    retrieval.invalidate(session_id)
    return {
        "deleted": True,
        "document_id": document_id,
        "invalidated": invalidated,
        "message": "Document deleted. Analyses, quizzes, attempts, diagnoses and paths that depended on it were removed; upload or analyse again to continue.",
    }


__all__ = ["router", "list_documents", "shutil", "SESSION_HEADER"]
