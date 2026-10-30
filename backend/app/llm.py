"""Nebius (OpenAI-compatible) client wrapper.

- The base URL and model id *always* come from the environment; nothing is guessed.
- Timeouts, bounded retries with backoff, concurrency limiting and a prompt-size guard.
- Structured JSON output is validated with Pydantic; one repair attempt is made for
  malformed JSON before a clean error is raised.
- Logs only metadata (lengths, latency, model). Never document text or keys.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Protocol, TypeVar

from pydantic import BaseModel, ValidationError

from .config import Settings, get_settings

log = logging.getLogger("tessera.llm")

T = TypeVar("T", bound=BaseModel)


class LLMError(Exception):
    """Base class for provider failures. Messages are safe for the browser."""

    code = "llm_error"
    status_code = 502

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details


class LLMNotConfigured(LLMError):
    code = "llm_not_configured"
    status_code = 503


class LLMAuthError(LLMError):
    code = "llm_auth_failed"
    status_code = 502


class LLMTimeout(LLMError):
    code = "llm_timeout"
    status_code = 504


class LLMRateLimited(LLMError):
    code = "llm_rate_limited"
    status_code = 429


class LLMPromptTooLarge(LLMError):
    code = "llm_prompt_too_large"
    status_code = 413


class LLMOutputError(LLMError):
    code = "llm_invalid_output"
    status_code = 502


class LLMUnavailable(LLMError):
    code = "llm_unavailable"
    status_code = 503


class LLMClient(Protocol):
    async def complete(
        self, *, system: str, user: str, json_mode: bool = True, max_tokens: int = 2000
    ) -> str: ...

    async def json(
        self,
        *,
        system: str,
        user: str,
        schema: type[T],
        max_tokens: int = 2000,
        temperature: float = 0.2,
    ) -> T: ...


def extract_json(text: str) -> Any | None:
    """Best-effort extraction of the first JSON object in a model reply."""
    if not text:
        return None
    cleaned = text.strip()
    if cleaned.startswith("```"):
        # Drop a fenced block, e.g. ```json ... ```
        cleaned = cleaned.split("```", 2)[1] if cleaned.count("```") >= 2 else cleaned
        if cleaned.lstrip().lower().startswith("json"):
            cleaned = cleaned.lstrip()[4:]
        cleaned = cleaned.strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        return json.loads(cleaned[start : end + 1])
    except ValueError:
        return None


class NebiusLLMClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._client: Any = None
        self._semaphore: asyncio.Semaphore | None = None
        self._semaphore_loop: asyncio.AbstractEventLoop | None = None

    # -- internals ------------------------------------------------------- #
    def _ensure_configured(self) -> None:
        message = self.settings.llm_config_error()
        if message:
            raise LLMNotConfigured(message)

    def _get_client(self) -> Any:
        if self._client is None:
            from openai import AsyncOpenAI

            self._client = AsyncOpenAI(
                api_key=self.settings.nebius_api_key,
                base_url=self.settings.nebius_base_url,
                timeout=self.settings.llm_timeout_seconds,
                max_retries=0,  # retries are handled here so errors map cleanly
            )
        return self._client

    def _get_semaphore(self) -> asyncio.Semaphore:
        loop = asyncio.get_running_loop()
        if self._semaphore is None or self._semaphore_loop is not loop:
            self._semaphore = asyncio.Semaphore(max(1, self.settings.llm_concurrency))
            self._semaphore_loop = loop
        return self._semaphore

    @staticmethod
    def _map_provider_error(exc: Exception) -> LLMError:
        name = type(exc).__name__
        if name in {"APITimeoutError", "TimeoutError", "ReadTimeout"}:
            return LLMTimeout("The AI model took too long to respond. Please retry.")
        if name in {"AuthenticationError", "PermissionDeniedError"}:
            return LLMAuthError(
                "The AI provider rejected the server's credentials. Check NEBIUS_API_KEY in backend/.env."
            )
        if name in {"RateLimitError"}:
            return LLMRateLimited("The AI provider is rate limiting requests. Please retry shortly.")
        if name in {"APIConnectionError", "ConnectError"}:
            return LLMUnavailable(
                "Could not reach the AI provider. Check NEBIUS_BASE_URL and your connection."
            )
        if name in {"NotFoundError"}:
            return LLMError(
                "The AI provider did not recognise the configured model or endpoint. "
                "Check NEBIUS_MODEL / NEBIUS_BASE_URL (run scripts/list_models.py)."
            )
        if name in {"BadRequestError", "UnprocessableEntityError"}:
            return LLMError(
                "The AI provider rejected the request. The configured model may not support this call."
            )
        return LLMUnavailable("The AI provider is currently unavailable. Please retry.")

    # -- API ------------------------------------------------------------- #
    async def complete(
        self, *, system: str, user: str, json_mode: bool = True, max_tokens: int = 2000
    ) -> str:
        self._ensure_configured()
        total_chars = len(system) + len(user)
        if total_chars > self.settings.llm_max_prompt_chars:
            raise LLMPromptTooLarge(
                "The prompt would exceed the configured size limit. The document set is too large "
                "for one request; reduce the selection."
            )
        client = self._get_client()
        attempts = max(0, self.settings.llm_max_retries) + 1
        last_error: Exception | None = None
        for attempt in range(attempts):
            started = time.perf_counter()
            try:
                async with self._get_semaphore():
                    kwargs: dict[str, Any] = {
                        "model": self.settings.nebius_model,
                        "messages": [
                            {"role": "system", "content": system},
                            {"role": "user", "content": user},
                        ],
                        "max_tokens": max_tokens,
                        "temperature": 0.2,
                    }
                    if json_mode:
                        kwargs["response_format"] = {"type": "json_object"}
                    try:
                        response = await client.chat.completions.create(**kwargs)
                    except Exception as exc:  # noqa: BLE001 - narrow by class name
                        if json_mode and type(exc).__name__ == "BadRequestError":
                            # Some models do not implement response_format; retry without it.
                            kwargs.pop("response_format", None)
                            response = await client.chat.completions.create(**kwargs)
                        else:
                            raise
                content = (response.choices[0].message.content or "").strip()
                elapsed_ms = (time.perf_counter() - started) * 1000
                usage = getattr(response, "usage", None)
                log.info(
                    "llm call ok model=%s prompt_chars=%d reply_chars=%d latency_ms=%.0f tokens_in=%s tokens_out=%s",
                    self.settings.nebius_model,
                    total_chars,
                    len(content),
                    elapsed_ms,
                    getattr(usage, "prompt_tokens", None),
                    getattr(usage, "completion_tokens", None),
                )
                if not content:
                    raise LLMOutputError("The AI model returned an empty response.")
                return content
            except LLMError:
                raise
            except Exception as exc:  # noqa: BLE001
                mapped = self._map_provider_error(exc)
                last_error = exc
                log.warning("llm call failed (%s, attempt %d)", type(exc).__name__, attempt + 1)
                if isinstance(mapped, (LLMAuthError, LLMError)) and mapped.code in {
                    "llm_auth_failed",
                    "llm_not_configured",
                }:
                    raise mapped
                if attempt + 1 < attempts:
                    await asyncio.sleep(0.6 * (2**attempt))
                    continue
                raise mapped
        raise LLMUnavailable("The AI provider request failed.") from last_error

    async def json(
        self,
        *,
        system: str,
        user: str,
        schema: type[T],
        max_tokens: int = 2000,
        temperature: float = 0.2,
    ) -> T:
        reply = await self.complete(system=system, user=user, json_mode=True, max_tokens=max_tokens)
        parsed = extract_json(reply)
        validation_message = ""
        if parsed is not None:
            try:
                return schema.model_validate(parsed)
            except ValidationError as exc:
                validation_message = str(exc)[:1200]
        # One repair attempt with the malformed payload (truncated) and the schema hints.
        schema_hint = json.dumps(schema.model_json_schema(), ensure_ascii=False)[:4000]
        repair_user = (
            "The previous reply could not be validated. Reply again with ONLY a corrected JSON object.\n"
            f"Required JSON schema:\n{schema_hint}\n\n"
            f"Validation problems:\n{validation_message or 'The reply was not valid JSON.'}\n\n"
            f"Previous reply (truncated):\n{reply[-5000:]}"
        )
        repaired = await self.complete(
            system=system, user=repair_user, json_mode=True, max_tokens=max_tokens
        )
        parsed = extract_json(repaired)
        if parsed is None:
            raise LLMOutputError(
                "The AI model returned malformed JSON twice. Please retry; if it persists, "
                "try a different model."
            )
        try:
            return schema.model_validate(parsed)
        except ValidationError as exc:
            raise LLMOutputError(
                "The AI model returned data that did not match the expected structure. Please retry."
            ) from exc

    async def list_models(self) -> list[dict[str, Any]]:
        self._ensure_configured()
        client = self._get_client()
        try:
            response = await client.models.list()
        except Exception as exc:  # noqa: BLE001
            raise self._map_provider_error(exc) from exc
        return [m.model_dump() if hasattr(m, "model_dump") else dict(m) for m in response.data]


# --------------------------------------------------------------------------- #
# Test / dependency-injection hook
# --------------------------------------------------------------------------- #
_override: LLMClient | None = None
_default: NebiusLLMClient | None = None
_default_settings_id: int | None = None


def set_llm_client(client: LLMClient | None) -> None:
    """Tests inject a fake client here; production leaves it as None."""
    global _override
    _override = client


def get_llm() -> LLMClient:
    global _default, _default_settings_id
    if _override is not None:
        return _override
    settings = get_settings()
    if _default is None or _default_settings_id != id(settings):
        _default = NebiusLLMClient(settings)
        _default_settings_id = id(settings)
    return _default
