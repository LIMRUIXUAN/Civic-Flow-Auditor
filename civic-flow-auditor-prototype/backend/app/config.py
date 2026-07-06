from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


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
    ai_provider: str = os.getenv("AI_PROVIDER", "openrouter")
    openrouter_api_key: str = os.getenv("OPENROUTER_API_KEY", "")
    vision_model: str = os.getenv("VISION_MODEL", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free")
    text_model: str = os.getenv("TEXT_MODEL", "nvidia/nemotron-3-ultra-550b-a55b:free")
    ai_timeout_ms: int = int(os.getenv("AI_TIMEOUT_MS", "12000"))
    enable_ocr: bool = _bool("ENABLE_OCR", True)
    enable_lighthouse: bool = _bool("ENABLE_LIGHTHOUSE", False)
    use_celery_eager: bool = _bool("CELERY_TASK_ALWAYS_EAGER", False)


settings = Settings()