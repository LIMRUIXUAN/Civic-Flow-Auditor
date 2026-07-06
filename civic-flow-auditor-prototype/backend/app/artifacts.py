from __future__ import annotations

import re
import shutil
from pathlib import Path

from .config import settings

SAFE_AUDIT_ID = re.compile(r"^[a-zA-Z0-9_-]{3,96}$")
ALLOWED_ARTIFACT_EXTENSIONS = {".html", ".pdf", ".md", ".png", ".jpg", ".jpeg", ".json"}


def assert_safe_audit_id(audit_id: str) -> str:
    if not SAFE_AUDIT_ID.match(str(audit_id or "")):
        raise ValueError("Invalid audit id.")
    return str(audit_id)


def assert_safe_artifact_name(filename: str) -> str:
    name = Path(str(filename or "")).name
    if not name or name != filename or ".." in name:
        raise ValueError("Invalid artifact path.")
    if Path(name).suffix.lower() not in ALLOWED_ARTIFACT_EXTENSIONS:
        raise ValueError("Unsupported artifact type.")
    return name


def ensure_storage_dir() -> Path:
    settings.audit_storage_dir.mkdir(parents=True, exist_ok=True)
    return settings.audit_storage_dir


def get_run_dir(audit_id: str) -> Path:
    safe_id = assert_safe_audit_id(audit_id)
    root = ensure_storage_dir().resolve()
    run_dir = (root / safe_id).resolve()
    if root not in run_dir.parents and run_dir != root:
        raise ValueError("Invalid audit storage path.")
    run_dir.mkdir(parents=True, exist_ok=True)
    return run_dir


def get_artifact_path(audit_id: str, filename: str) -> Path:
    run_dir = get_run_dir(audit_id)
    safe_name = assert_safe_artifact_name(filename)
    target = (run_dir / safe_name).resolve()
    if run_dir not in target.parents:
        raise ValueError("Invalid artifact path.")
    return target


def artifact_url(audit_id: str, filename: str) -> str:
    return f"/artifacts/{assert_safe_audit_id(audit_id)}/{assert_safe_artifact_name(filename)}"


def write_text_artifact(audit_id: str, filename: str, content: str) -> tuple[Path, str]:
    path = get_artifact_path(audit_id, filename)
    path.write_text(content, encoding="utf-8")
    return path, artifact_url(audit_id, filename)


def write_bytes_artifact(audit_id: str, filename: str, content: bytes) -> tuple[Path, str]:
    path = get_artifact_path(audit_id, filename)
    path.write_bytes(content)
    return path, artifact_url(audit_id, filename)


def purge_run_artifacts(audit_id: str) -> int:
    run_dir = get_run_dir(audit_id)
    count = len([item for item in run_dir.iterdir() if item.is_file()])
    shutil.rmtree(run_dir, ignore_errors=True)
    run_dir.mkdir(parents=True, exist_ok=True)
    return count