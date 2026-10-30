from __future__ import annotations

import time

from app.analysis import _find_cycle
from conftest import TEXT_PAGES, upload_text_pdf


def wait_for_analysis(client, headers, timeout: float = 20.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        status = client.get("/api/analysis/status", headers=headers).json()
        if status["status"] in {"ready", "failed"}:
            return status
        time.sleep(0.05)
    raise AssertionError("analysis did not finish in time")


def test_analysis_produces_valid_concept_map(client, session, fake_llm):
    doc_id = upload_text_pdf(client, session["headers"])
    start = client.post("/api/analysis", headers=session["headers"])
    assert start.status_code == 200
    status = wait_for_analysis(client, session["headers"])
    assert status["status"] == "ready", status

    payload = client.get("/api/analysis", headers=session["headers"]).json()
    assert payload["status"] == "ready"
    result = payload["result"]
    assert result["overall_summary"]
    assert result["topics"] and result["definitions"] and result["formulas"]

    concepts = result["concepts"]
    ids = [c["id"] for c in concepts]
    assert len(ids) == len(set(ids))
    assert 1 <= len(concepts) <= 40

    edges = result["edges"]
    for edge in edges:
        assert edge["from_id"] in ids and edge["to_id"] in ids
        assert edge["from_id"] != edge["to_id"]
    assert _find_cycle(ids, edges) is None

    for concept in concepts:
        for ref in concept["source_pages"]:
            assert ref["document_id"] == doc_id
            assert all(1 <= p <= len(TEXT_PAGES) for p in ref["pages"])

    # The concept map endpoint returns the same graph for the UI.
    graph = client.get("/api/analysis/concepts", headers=session["headers"]).json()
    assert graph["concepts"] == concepts


def test_analysis_rejects_before_upload(client, session):
    response = client.post("/api/analysis", headers=session["headers"])
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "no_documents"


def test_analysis_fails_cleanly_without_llm_config(client, session):
    upload_text_pdf(client, session["headers"])
    start = client.post("/api/analysis", headers=session["headers"])
    assert start.status_code == 200
    status = wait_for_analysis(client, session["headers"])
    assert status["status"] == "failed"
    assert "NEBIUS" in status["error"]
    # No raw provider error or key can appear.
    assert "sk-" not in status["error"]


def test_delete_document_invalidates_analysis(client, session, fake_llm):
    doc_id = upload_text_pdf(client, session["headers"])
    client.post("/api/analysis", headers=session["headers"])
    assert wait_for_analysis(client, session["headers"])["status"] == "ready"
    assert client.get("/api/analysis", headers=session["headers"]).json()["status"] == "ready"

    client.delete(f"/api/documents/{doc_id}", headers=session["headers"])
    assert client.get("/api/analysis", headers=session["headers"]).json()["status"] == "idle"


def test_break_cycles_removes_weakest_edge():
    from app.analysis import break_cycles

    nodes = ["a", "b", "c"]
    edges = [
        {"from_id": "a", "to_id": "b", "confidence": 0.9},
        {"from_id": "b", "to_id": "c", "confidence": 0.8},
        {"from_id": "c", "to_id": "a", "confidence": 0.2},
    ]
    kept, removed = break_cycles(nodes, edges)
    assert removed and removed[0]["confidence"] == 0.2
    assert _find_cycle(nodes, kept) is None
    assert len(kept) == 2
