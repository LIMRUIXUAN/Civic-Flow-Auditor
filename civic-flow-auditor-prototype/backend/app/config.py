from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

try:
    from dotenv import load_dotenv

    # Load backend/.env into the process environment. Production deploys
    # (Render, etc.) inject real env vars directly and don't need this, but
    # local dev only has a .env file — without loading it here, GOOGLE_API_KEY
    # silently never reaches os.getenv() below and AI enhancement stays
    # permanently "unavailable" even with a valid key on disk.
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass


def _bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    host: str = os.getenv("HOST", "127.0.0.1")
    port: int = int(os.getenv("PORT", "8787"))
    cors_origin: str = os.getenv("CORS_ORIGIN", "http://127.0.0.1:5173")
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./.audit-runs/audits-python.sqlite")
    redis_url: str = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
    audit_storage_dir: Path = Path(os.getenv("AUDIT_STORAGE_DIR", ".audit-runs")).resolve()
    max_pages: int = int(os.getenv("MAX_PAGES", "10"))
    max_concurrent_audits: int = int(os.getenv("MAX_CONCURRENT_AUDITS", "1"))
    # AI provider: "google" (Gemini via the Google Agent Development Kit) or "none".
    ai_provider: str = os.getenv("AI_PROVIDER", "google")
    # GOOGLE_API_KEY is the standard var used by google-genai / google-adk.
    # GEMINI_API_KEY is accepted as a fallback alias.
    google_api_key: str = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY", "")
    vision_model: str = os.getenv("VISION_MODEL", "gemini-2.0-flash")
    text_model: str = os.getenv("TEXT_MODEL", "gemini-2.0-flash")
    ai_timeout_ms: int = int(os.getenv("AI_TIMEOUT_MS", "20000"))
    enable_ocr: bool = _bool("ENABLE_OCR", True)
    enable_lighthouse: bool = _bool("ENABLE_LIGHTHOUSE", False)
    use_celery_eager: bool = _bool("CELERY_TASK_ALWAYS_EAGER", False)


settings = Settings()