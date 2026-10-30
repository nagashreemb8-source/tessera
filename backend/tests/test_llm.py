from __future__ import annotations

import asyncio

import pytest

from app.config import Settings, get_settings
from app.llm import (
    LLMNotConfigured,
    LLMOutputError,
    LLMPromptTooLarge,
    LLMTimeout,
    NebiusLLMClient,
    extract_json,
)
from app.models import ExplainLLM
from conftest import upload_text_pdf


class StubClient(NebiusLLMClient):
    def __init__(self, replies: list[str]) -> None:
        super().__init__(get_settings())
        self.replies = replies
        self.calls = 0

    async def complete(self, **_: object) -> str:  # type: ignore[override]
        self.calls += 1
        return self.replies.pop(0)


def test_extract_json_handles_fences_and_noise():
    assert extract_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert extract_json('Sure! Here you go: {"a": {"b": 2}} thanks') == {"a": {"b": 2}}
    assert extract_json("not json at all") is None


def test_malformed_json_is_repaired_once():
    stub = StubClient(
        ["this is not json", '{"title": "Fixed", "paragraphs": ["One."], "note": "ok"}']
    )
    result = asyncio.run(
        stub.json(system="s", user="u", schema=ExplainLLM, max_tokens=100)
    )
    assert result.title == "Fixed"
    assert stub.calls == 2


def test_unrepairable_json_raises_clean_error():
    stub = StubClient(["nope", "still not json"])
    with pytest.raises(LLMOutputError):
        asyncio.run(stub.json(system="s", user="u", schema=ExplainLLM, max_tokens=100))


def test_missing_configuration_raises_actionable_error():
    settings = Settings(nebius_api_key="", nebius_base_url="", nebius_model="")
    client = NebiusLLMClient(settings)
    with pytest.raises(LLMNotConfigured) as excinfo:
        asyncio.run(client.complete(system="s", user="u"))
    assert "NEBIUS_API_KEY" in excinfo.value.message
    assert excinfo.value.status_code == 503


def test_prompt_size_guard():
    settings = Settings(
        nebius_api_key="test-key-not-real",
        nebius_base_url="http://localhost:1/v1",
        nebius_model="some-model",
        llm_max_prompt_chars=100,
    )
    client = NebiusLLMClient(settings)
    with pytest.raises(LLMPromptTooLarge):
        asyncio.run(client.complete(system="s" * 60, user="u" * 60))


def test_provider_timeout_is_mapped():
    class APITimeoutError(Exception):
        pass

    mapped = NebiusLLMClient._map_provider_error(APITimeoutError())
    assert isinstance(mapped, LLMTimeout)
    assert mapped.status_code == 504


def test_tutor_reports_missing_llm_config(client, session):
    upload_text_pdf(client, session["headers"])
    response = client.post(
        "/api/tutor/ask",
        headers=session["headers"],
        json={"question": "What is variance?"},
    )
    assert response.status_code == 503
    body = response.json()
    assert body["error"]["code"] == "llm_not_configured"
    assert "backend/.env" in body["error"]["message"]
    assert "sk-" not in response.text
