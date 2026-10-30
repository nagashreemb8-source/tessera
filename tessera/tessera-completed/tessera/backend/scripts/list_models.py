"""List the model ids your Nebius Token Factory key can use.

Usage (from backend/, with the venv active):
    python scripts/list_models.py

Reads NEBIUS_BASE_URL / NEBIUS_API_KEY from backend/.env (never prints the key).
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings  # noqa: E402
from app.llm import LLMError, NebiusLLMClient  # noqa: E402


async def main() -> int:
    settings = get_settings()
    message = settings.llm_config_error()
    if message:
        print("Cannot list models yet.\n")
        print(message)
        return 2
    print(f"Base URL: {settings.nebius_base_url}")
    print(f"Configured model: {settings.nebius_model or '(none)'}\n")
    client = NebiusLLMClient(settings)
    try:
        models = await client.list_models()
    except LLMError as exc:
        print(f"Failed: {exc.message} (code: {exc.code})")
        return 1
    except Exception as exc:  # noqa: BLE001
        print(f"Failed with {type(exc).__name__}. Check NEBIUS_BASE_URL and your network.")
        return 1

    ids = sorted({str(m.get("id")) for m in models if m.get("id")})
    if not ids:
        print("The provider returned no models for this key.")
        return 1
    print("Model ids available to your key:")
    for model_id in ids:
        marker = "  <-- NEBIUS_MODEL" if model_id == settings.nebius_model else ""
        print(f"  - {model_id}{marker}")
    print(
        "\nChoose an NVIDIA open-source model (for example from the Nemotron family) from the list above "
        "and put its exact id in backend/.env as NEBIUS_MODEL."
    )
    if settings.nebius_model and settings.nebius_model not in ids:
        print(f"\nWARNING: your configured NEBIUS_MODEL '{settings.nebius_model}' is not in this list.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
