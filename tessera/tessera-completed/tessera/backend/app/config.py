"""Central configuration. All values come from environment variables (or backend/.env).

Secrets are never logged, never returned to the browser, and never written to disk.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # LLM provider (Nebius Token Factory is OpenAI-compatible).
    nebius_api_key: str = ""
    nebius_base_url: str = ""
    nebius_model: str = ""
    nebius_embedding_model: str = ""

    cors_origins: str = (
        "http://localhost:3000,http://127.0.0.1:3000,"
        "http://localhost:5173,http://127.0.0.1:5173"
    )

    max_upload_mb: int = 25
    max_files_per_session: int = 20
    max_pages_per_pdf: int = 400

    llm_timeout_seconds: float = 90.0
    llm_max_retries: int = 2
    llm_concurrency: int = 3
    llm_max_prompt_chars: int = 24000

    data_dir: str = "data"

    # Rate limiting for LLM-heavy endpoints (per session, sliding window).
    llm_rate_limit_per_minute: int = 20

    # Retrieval
    chunk_size: int = 1000
    chunk_overlap: int = 160
    retrieval_top_k: int = 8
    retrieval_min_confidence: float = 0.25

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def resolved_data_dir(self) -> Path:
        p = Path(self.data_dir)
        if not p.is_absolute():
            p = BACKEND_DIR / p
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def uploads_dir(self) -> Path:
        p = self.resolved_data_dir / "uploads"
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def db_path(self) -> Path:
        return self.resolved_data_dir / "tessera.db"

    @property
    def llm_configured(self) -> bool:
        return bool(self.nebius_api_key and self.nebius_base_url and self.nebius_model)

    def llm_config_error(self) -> str | None:
        """Actionable message describing what is missing, or None when configured."""
        missing = []
        if not self.nebius_api_key:
            missing.append("NEBIUS_API_KEY")
        if not self.nebius_base_url:
            missing.append("NEBIUS_BASE_URL")
        if not self.nebius_model:
            missing.append("NEBIUS_MODEL")
        if not missing:
            return None
        return (
            "The AI model is not configured. Copy backend/.env.example to backend/.env and set "
            + ", ".join(missing)
            + ". Use the base URL and model id shown in your Nebius Token Factory dashboard "
            "(run `python scripts/list_models.py` to list the model ids your key can use)."
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


def reset_settings_cache() -> None:
    """Used by tests after changing environment variables."""
    get_settings.cache_clear()
