from __future__ import annotations

from app.config import get_settings
from app.db import get_db
from app.pdf_processing import chunk_pages, normalise_text
from conftest import (
    make_blank_pdf_bytes,
    make_encrypted_pdf_bytes,
    make_pdf_bytes,
    upload_pdf,
    upload_text_pdf,
    TEXT_PAGES,
)


def test_valid_pdf_is_processed_with_page_numbers(client, session):
    doc_id = upload_text_pdf(client, session["headers"])
    docs = client.get("/api/documents", headers=session["headers"]).json()
    assert len(docs) == 1
    assert docs[0]["status"] == "processed"
    assert docs[0]["page_count"] == 3
    assert docs[0]["chunk_count"] >= 1

    page = client.get(
        f"/api/documents/{doc_id}/pages/2", headers=session["headers"]
    ).json()
    assert page["page_no"] == 2
    assert "Chapter 2" in page["text"]
    assert "expected value" in page["text"].lower()

    with get_db() as conn:
        chunks = conn.execute(
            "SELECT page_start, page_end, text FROM chunks WHERE document_id = ?", (doc_id,)
        ).fetchall()
    for chunk in chunks:
        assert 1 <= chunk["page_start"] <= chunk["page_end"] <= 3
        assert chunk["text"].strip()


def test_non_pdf_is_rejected(client, session):
    response = upload_pdf(client, session["headers"], b"just some text, not a pdf")
    assert response.status_code == 200
    result = response.json()["results"][0]
    assert result["status"] == "rejected"
    assert result["error_code"] == "not_a_pdf"


def test_non_pdf_renamed_to_pdf_is_rejected(client, session):
    response = upload_pdf(client, session["headers"], b"hello world", name="fake.pdf")
    result = response.json()["results"][0]
    assert result["error_code"] == "not_a_pdf"


def test_empty_file_is_rejected(client, session):
    response = upload_pdf(client, session["headers"], b"", name="empty.pdf")
    result = response.json()["results"][0]
    assert result["error_code"] == "empty_file"


def test_corrupted_pdf_is_rejected(client, session):
    response = upload_pdf(client, session["headers"], b"%PDF-1.7\nthis is not a real pdf body")
    result = response.json()["results"][0]
    assert result["status"] == "rejected"
    assert result["error_code"] == "corrupted_pdf"


def test_encrypted_pdf_is_rejected(client, session):
    response = upload_pdf(client, session["headers"], make_encrypted_pdf_bytes())
    result = response.json()["results"][0]
    assert result["status"] == "rejected"
    assert result["error_code"] == "encrypted_pdf"


def test_scanned_pdf_is_rejected_with_explanation(client, session):
    response = upload_pdf(client, session["headers"], make_blank_pdf_bytes(2))
    result = response.json()["results"][0]
    assert result["status"] == "rejected"
    assert result["error_code"] == "scanned_pdf"
    assert "OCR" in result["message"]


def test_oversized_file_is_rejected(client, session, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "max_upload_mb", 1)
    big = b"%PDF-" + b"0" * (1024 * 1024 + 64)
    response = upload_pdf(client, session["headers"], big, name="big.pdf")
    result = response.json()["results"][0]
    assert result["error_code"] == "too_large"


def test_too_many_pages_is_rejected(client, session, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "max_pages_per_pdf", 2)
    response = upload_pdf(client, session["headers"], make_pdf_bytes(TEXT_PAGES))
    result = response.json()["results"][0]
    assert result["error_code"] == "too_many_pages"


def test_duplicate_upload_is_detected(client, session):
    pdf = make_pdf_bytes(TEXT_PAGES)
    first = upload_pdf(client, session["headers"], pdf, name="a.pdf")
    assert first.json()["results"][0]["status"] == "processed"
    second = upload_pdf(client, session["headers"], pdf, name="b.pdf")
    result = second.json()["results"][0]
    assert result["status"] == "rejected"
    assert result["error_code"] == "duplicate_document"
    assert len([d for d in second.json()["documents"] if d["status"] != "rejected"]) == 1


def test_mixed_batch_does_not_fail_good_files(client, session):
    response = client.post(
        "/api/documents",
        headers=session["headers"],
        files=[
            ("files", ("good.pdf", make_pdf_bytes(TEXT_PAGES), "application/pdf")),
            ("files", ("bad.pdf", b"not a pdf", "application/pdf")),
        ],
    )
    payload = response.json()
    statuses = {r["filename"]: r["status"] for r in payload["results"]}
    assert statuses["good.pdf"] == "processed"
    assert statuses["bad.pdf"] == "rejected"


def test_partial_pdf_reports_unreadable_pages(client, session):
    import fitz

    doc = fitz.open()
    page = doc.new_page()
    page.insert_textbox(fitz.Rect(50, 50, 550, 780), TEXT_PAGES[0], fontsize=10)
    doc.new_page()  # image-only / blank page
    pdf = doc.tobytes()
    doc.close()
    response = upload_pdf(client, session["headers"], pdf)
    result = response.json()["results"][0]
    assert result["status"] == "partial"
    assert result["warnings"]
    assert "2" in result["warnings"][0]


def test_delete_document_removes_chunks_and_dependents(client, session):
    doc_id = upload_text_pdf(client, session["headers"])
    response = client.delete(f"/api/documents/{doc_id}", headers=session["headers"])
    assert response.status_code == 200
    body = response.json()
    assert body["deleted"] is True
    assert "invalidated" in body
    assert client.get(f"/api/documents/{doc_id}", headers=session["headers"]).status_code == 404
    with get_db() as conn:
        count = conn.execute(
            "SELECT COUNT(*) AS c FROM chunks WHERE document_id = ?", (doc_id,)
        ).fetchone()["c"]
    assert count == 0


def test_chunk_overlap_and_page_spans():
    pages = [(1, "alpha " * 300), (2, "beta " * 300)]
    chunks = chunk_pages("doc1", pages, chunk_size=500, overlap=100)
    assert len(chunks) >= 3
    assert chunks[0]["page_start"] == 1
    assert chunks[-1]["page_end"] == 2
    # Consecutive chunks share words (overlap).
    first_words = set(chunks[0]["text"].split())
    second_words = set(chunks[1]["text"].split())
    assert first_words & second_words


def test_normalise_text_fixes_hyphenation():
    assert normalise_text("probabil-\nity") == "probability"
