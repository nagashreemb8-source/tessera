from __future__ import annotations

from app.db import connect
from app.retrieval import get_index, search
from conftest import make_pdf_bytes, upload_pdf, upload_text_pdf


def test_relevant_chunk_ranks_first(client, session):
    up = client.post(
        "/api/documents",
        headers=session["headers"],
        files=[
            ("files", ("a.pdf", make_pdf_bytes(["Variance is the expected squared deviation from the mean."]), "application/pdf")),
            ("files", ("b.pdf", make_pdf_bytes(["Photosynthesis converts light energy into chemical energy in chloroplasts."]), "application/pdf")),
        ],
    )
    assert up.status_code == 200

    conn = connect()
    try:
        results, confidence = search(conn, session["id"], "variance squared deviation mean", k=3)
    finally:
        conn.close()
    assert results
    assert "variance" in results[0][0].text.lower()
    assert confidence > 0.5


def test_unrelated_query_has_low_confidence(client, session):
    upload_text_pdf(client, session["headers"])
    conn = connect()
    try:
        results, confidence = search(
            conn, session["id"], "photosynthesis chlorophyll mitochondria ribosome", k=4
        )
    finally:
        conn.close()
    assert results == []
    assert confidence == 0.0


def test_search_is_scoped_to_the_session(client, session):
    doc_id = upload_text_pdf(client, session["headers"])
    other = client.post("/api/sessions").json()["session_id"]
    other_headers = {"X-Session-Id": other}
    upload_pdf(
        client,
        other_headers,
        make_pdf_bytes(["A different subject entirely: cell biology and membranes."]),
        name="bio.pdf",
    )

    conn = connect()
    try:
        results, _ = search(conn, session["id"], "variance expected value", k=5)
        assert results
        assert {doc.document_id for doc, _ in results} == {doc_id}

        other_results, _ = search(conn, other, "variance expected value", k=5)
        assert all("variance" not in doc.text.lower() for doc, _ in other_results)

        index = get_index(conn, session["id"])
        assert index.n >= 1
    finally:
        conn.close()


def test_document_filter_limits_results(client, session):
    first = upload_text_pdf(client, session["headers"])
    upload_pdf(
        client,
        session["headers"],
        make_pdf_bytes(["Variance can also appear in a second document about variance."]),
        name="second.pdf",
    )
    conn = connect()
    try:
        results, _ = search(conn, session["id"], "variance", k=10, document_ids=[first])
    finally:
        conn.close()
    assert results
    assert all(doc.document_id == first for doc, _ in results)
