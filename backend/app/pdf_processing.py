"""PDF validation, page-by-page text extraction and chunking.

PyMuPDF is used when available (pip wheels on Windows, no compiler); pypdf is a
fallback. Extraction never pretends to do OCR: an image-only PDF is reported as
scanned so the UI can tell the student what to do.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path

PDF_MAGIC = b"%PDF-"
MIN_TEXT_PER_PAGE = 12
SCANNED_PAGE_CHAR_LIMIT = 10
MIN_CHUNK_CHARS = 200


class PdfError(Exception):
    def __init__(self, code: str, message: str, *, warnings: list[str] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.warnings = warnings or []


@dataclass
class Extraction:
    page_texts: list[tuple[int, str]] = field(default_factory=list)
    page_count: int = 0
    status: str = "processed"
    warnings: list[str] = field(default_factory=list)
    empty_pages: list[int] = field(default_factory=list)


_HYPHEN_BREAK = re.compile(r"(?<=[A-Za-z])-\s*\n\s*(?=[A-Za-z])")
_MULTI_SPACE = re.compile(r"[ \t\u00a0]{2,}")
_MULTI_NEWLINE = re.compile(r"\n{3,}")


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def sanitise_filename(name: str) -> str:
    """Never use a user-supplied name as a path."""
    base = Path(name.replace("\\", "/")).name
    base = re.sub(r"[^A-Za-z0-9._ ()-]", "_", base).strip(" .")
    if not base:
        base = "document.pdf"
    if len(base) > 120:
        stem = Path(base).stem[:80]
        base = f"{stem}.pdf"
    return base


def normalise_text(raw: str) -> str:
    text = raw.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\u00ad", "")
    text = _HYPHEN_BREAK.sub("", text)
    text = _MULTI_SPACE.sub(" ", text)
    lines = [line.strip() for line in text.split("\n")]
    text = "\n".join(lines)
    text = _MULTI_NEWLINE.sub("\n\n", text)
    return text.strip()


def _drop_repeated_lines(page_texts: list[tuple[int, str]]) -> list[tuple[int, str]]:
    """Remove obvious repeated headers/footers (only when clearly repeated)."""
    if len(page_texts) < 3:
        return page_texts
    candidates: dict[str, int] = {}
    for _, text in page_texts:
        lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
        for line in set(lines[:2] + lines[-2:]):
            if 0 < len(line) <= 120:
                candidates[line] = candidates.get(line, 0) + 1
    threshold = max(3, int(len(page_texts) * 0.6))
    repeated = {line for line, count in candidates.items() if count >= threshold}
    if not repeated:
        return page_texts
    cleaned: list[tuple[int, str]] = []
    for page_no, text in page_texts:
        kept = [ln for ln in text.split("\n") if ln.strip() and ln.strip() not in repeated]
        cleaned.append((page_no, "\n".join(kept)))
    return cleaned


def _extract_pymupdf(path: Path) -> list[str]:
    import fitz  # PyMuPDF

    doc = fitz.open(path)  # type: ignore[no-any-return]
    try:
        if doc.needs_pass:
            raise PdfError(
                "encrypted_pdf",
                "This PDF is password protected. Remove the password (for example by printing it to a new PDF) and upload it again.",
            )
        if doc.page_count == 0:
            raise PdfError("empty_pdf", "This PDF has no pages.")
        return [page.get_text("text") or "" for page in doc]
    finally:
        doc.close()


def _extract_pypdf(path: Path) -> list[str]:
    from pypdf import PdfReader

    # Keep the handle open for exactly as long as we read it (Windows locks open files).
    with open(path, "rb") as handle:
        reader = PdfReader(handle)
        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except Exception as exc:  # noqa: BLE001
                raise PdfError(
                    "encrypted_pdf",
                    "This PDF is password protected. Remove the password and upload it again.",
                ) from exc
            if getattr(reader, "is_encrypted", False):
                raise PdfError(
                    "encrypted_pdf",
                    "This PDF is password protected. Remove the password and upload it again.",
                )
        if len(reader.pages) == 0:
            raise PdfError("empty_pdf", "This PDF has no pages.")
        out = []
        for page in reader.pages:
            try:
                out.append(page.extract_text() or "")
            except Exception:  # noqa: BLE001 - a single unreadable page must not kill the file
                out.append("")
        return out


def extract_pdf(path: Path, max_pages: int) -> Extraction:
    """Extract page text. Raises PdfError for files that must be rejected."""
    try:
        try:
            raw_pages = _extract_pymupdf(path)
        except PdfError:
            raise
        except Exception:  # noqa: BLE001 - fall back to pypdf if PyMuPDF trips
            raw_pages = _extract_pypdf(path)
    except PdfError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise PdfError(
            "corrupted_pdf",
            "This file could not be read as a PDF. It may be corrupted or not actually a PDF.",
        ) from exc

    page_count = len(raw_pages)
    if page_count == 0:
        raise PdfError("empty_pdf", "This PDF has no pages.")
    if page_count > max_pages:
        raise PdfError(
            "too_many_pages",
            f"This PDF has {page_count} pages. The limit is {max_pages} pages per file.",
        )

    cleaned = [(i + 1, normalise_text(text)) for i, text in enumerate(raw_pages)]
    cleaned = _drop_repeated_lines(cleaned)

    empty_pages = [p for p, t in cleaned if len(t) < SCANNED_PAGE_CHAR_LIMIT]
    total_chars = sum(len(t) for _, t in cleaned)

    if total_chars < 50:
        raise PdfError(
            "scanned_pdf",
            "This PDF has no extractable text layer, so it looks scanned or image-only. "
            "Tessera does not run OCR: run the file through an OCR tool (for example searchable-PDF export "
            "in your scanner app or Acrobat) and upload the OCR version.",
            warnings=[f"Pages with no extractable text: {', '.join(map(str, empty_pages[:30]))}"],
        )

    status = "processed"
    warnings: list[str] = []
    readable = page_count - len(empty_pages)
    if empty_pages and readable > 0:
        status = "partial"
        shown = ", ".join(map(str, empty_pages[:20]))
        more = "" if len(empty_pages) <= 20 else f" (+{len(empty_pages) - 20} more)"
        warnings.append(
            f"{len(empty_pages)} of {page_count} pages had no extractable text and were skipped: {shown}{more}. "
            "Those pages are probably images or scans."
        )
    if readable < page_count * 0.5:
        status = "partial"
        warnings.append(
            "Most pages have very little text. The PDF may be mostly scanned images; analysis quality will be limited."
        )

    return Extraction(page_texts=cleaned, page_count=page_count, status=status, warnings=warnings, empty_pages=empty_pages)


def chunk_pages(
    document_id: str,
    page_texts: list[tuple[int, str]],
    chunk_size: int = 1000,
    overlap: int = 160,
) -> list[dict]:
    """Overlapping chunks that remember which pages they came from."""
    tokens: list[tuple[str, int]] = []
    for page_no, text in page_texts:
        for word in text.split():
            tokens.append((word, page_no))
    if not tokens:
        return []

    chunks: list[dict] = []
    start = 0
    total = len(tokens)
    while start < total:
        chars = 0
        end = start
        while end < total and chars < chunk_size:
            chars += len(tokens[end][0]) + 1
            end += 1
        window = tokens[start:end]
        if window:
            text = " ".join(w for w, _ in window)
            pages = [p for _, p in window]
            chunks.append(
                {
                    "id": f"{document_id}-c{len(chunks)}",
                    "document_id": document_id,
                    "chunk_index": len(chunks),
                    "page_start": min(pages),
                    "page_end": max(pages),
                    "text": text,
                }
            )
        if end >= total:
            break
        back_chars = 0
        back = end - 1
        while back > start and back_chars < overlap:
            back_chars += len(tokens[back][0]) + 1
            back -= 1
        start = max(start + 1, back + 1)
    return chunks
