from __future__ import annotations

import json
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from sqlalchemy import Column, DateTime, Integer, MetaData, String, Table, Text, create_engine, select
from sqlalchemy.engine import Engine
from sqlalchemy.engine.url import make_url
from sqlalchemy.sql import func

from .config import settings
from .schemas import AuditRun, create_audit_run_base, now_iso

metadata = MetaData()

audit_runs_table = Table(
    "audit_runs",
    metadata,
    Column("id", String(96), primary_key=True),
    Column("url", Text, nullable=False),
    Column("depth", String(32), nullable=False),
    Column("status", String(32), nullable=False),
    Column("progress", Integer, nullable=False, default=0),
    Column("pages_count", Integer, nullable=False, default=0),
    Column("documents_count", Integer, nullable=False, default=0),
    Column("findings_count", Integer, nullable=False, default=0),
    Column("ai_provider", String(32), nullable=False, default="none"),
    Column("ai_model", Text, nullable=False, default="deterministic"),
    Column("ai_status", String(32), nullable=False, default="deterministic"),
    Column("html_report_url", Text),
    Column("pdf_report_url", Text),
    Column("created_at", Text, nullable=False),
    Column("updated_at", Text, nullable=False),
    Column("run_json", Text, nullable=False),
    Column("db_created_at", DateTime(timezone=True), server_default=func.now()),
)

_engine: Engine | None = None


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
        if settings.database_url.startswith("sqlite"):
            database = make_url(settings.database_url).database
            if database and database != ":memory:":
                Path(database).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)
        _engine = create_engine(settings.database_url, future=True, connect_args=connect_args)
        metadata.create_all(_engine)
    return _engine


@contextmanager
def begin() -> Iterator:
    with get_engine().begin() as connection:
        yield connection


def _run_to_row(run: AuditRun) -> dict:
    run_json = run.model_dump_json(indent=2)
    return {
        "id": run.id,
        "url": run.url,
        "depth": run.depth,
        "status": run.status,
        "progress": run.progress,
        "pages_count": len(run.pages),
        "documents_count": len(run.documents),
        "findings_count": len(run.findings),
        "ai_provider": run.ai.provider,
        "ai_model": run.ai.model,
        "ai_status": run.ai.status,
        "html_report_url": run.artifacts.htmlReportUrl,
        "pdf_report_url": run.artifacts.pdfReportUrl,
        "created_at": run.createdAt,
        "updated_at": run.updatedAt,
        "run_json": run_json,
    }


def save_audit_run(run: AuditRun) -> AuditRun:
    parsed = AuditRun.model_validate({**run.model_dump(), "updatedAt": run.updatedAt or now_iso()})
    row = _run_to_row(parsed)
    table = audit_runs_table
    with begin() as connection:
        existing = connection.execute(select(table.c.id).where(table.c.id == parsed.id)).first()
        if existing:
            connection.execute(table.update().where(table.c.id == parsed.id).values(**row))
        else:
            connection.execute(table.insert().values(**row))
    from .events import publish_audit_update

    publish_audit_update(parsed)
    return parsed


def create_stored_audit_run(audit_id: str, url: str, depth: str | None) -> AuditRun:
    run = create_audit_run_base(audit_id, url, depth)
    run.status = "queued"
    run.progress = 2
    run.updatedAt = now_iso()
    return save_audit_run(run)


def load_audit_run(audit_id: str) -> AuditRun:
    with begin() as connection:
        row = connection.execute(select(audit_runs_table.c.run_json).where(audit_runs_table.c.id == audit_id)).first()
    if not row:
        raise KeyError("Audit run not found.")
    return AuditRun.model_validate(json.loads(row.run_json))


def update_audit_run(audit_id: str, patch: dict | None = None, updater=None) -> AuditRun:
    current = load_audit_run(audit_id)
    data = current.model_dump()
    if updater:
        updated = updater(current)
        if isinstance(updated, AuditRun):
            return save_audit_run(updated)
        data = updated
    if patch:
        data.update(patch)
    data["updatedAt"] = now_iso()
    return save_audit_run(AuditRun.model_validate(data))


def list_audit_summaries(limit: int = 50) -> list[dict]:
    safe_limit = max(1, min(int(limit or 50), 100))
    with begin() as connection:
        rows = connection.execute(
            select(
                audit_runs_table.c.id,
                audit_runs_table.c.url,
                audit_runs_table.c.depth,
                audit_runs_table.c.status,
                audit_runs_table.c.progress,
                audit_runs_table.c.pages_count,
                audit_runs_table.c.documents_count,
                audit_runs_table.c.findings_count,
                audit_runs_table.c.ai_provider,
                audit_runs_table.c.ai_model,
                audit_runs_table.c.ai_status,
                audit_runs_table.c.html_report_url,
                audit_runs_table.c.pdf_report_url,
                audit_runs_table.c.created_at,
                audit_runs_table.c.updated_at,
            )
            .order_by(audit_runs_table.c.updated_at.desc())
            .limit(safe_limit)
        ).all()
    return [
        {
            "id": row.id,
            "url": row.url,
            "depth": row.depth,
            "status": row.status,
            "progress": row.progress,
            "pages": row.pages_count,
            "documents": row.documents_count,
            "findings": row.findings_count,
            "ai": {"provider": row.ai_provider, "model": row.ai_model, "status": row.ai_status},
            "artifacts": {"htmlReportUrl": row.html_report_url or None, "pdfReportUrl": row.pdf_report_url or None},
            "createdAt": row.created_at,
            "updatedAt": row.updated_at,
        }
        for row in rows
    ]
