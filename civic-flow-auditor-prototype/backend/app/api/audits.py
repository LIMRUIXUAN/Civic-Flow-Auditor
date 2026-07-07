from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from ..artifacts import get_artifact_path, get_run_dir, purge_run_artifacts
from ..config import settings
from ..repository import create_stored_audit_run, list_audit_summaries, load_audit_run, save_audit_run, update_audit_run
from ..schemas import CreateAuditRequest, SaveDocumentAuditRequest, build_deterministic_summary, normalize_depth, now_iso
from ..security import validate_scan_target

router = APIRouter()


def _run_in_process(
    audit_id: str,
    reason: str,
    login_email: str | None = None,
    login_password: str | None = None,
) -> None:
    update_audit_run(audit_id, {"error": reason})

    def run_fallback() -> None:
        try:
            from ..agents.orchestrator import run_audit

            run_audit(audit_id, login_email=login_email, login_password=login_password)
        except Exception as fallback_exc:
            update_audit_run(
                audit_id,
                {
                    "status": "failed",
                    "progress": 5,
                    "error": f"Audit failed in fallback worker: {fallback_exc}",
                },
            )

    threading.Thread(target=run_fallback, name=f"audit-fallback-{audit_id}", daemon=True).start()


def _redis_available() -> bool:
    try:
        import redis

        client = redis.Redis.from_url(settings.redis_url, socket_connect_timeout=0.5, socket_timeout=0.5)
        return bool(client.ping())
    except Exception:
        return False


def _queue_audit(
    audit_id: str,
    login_email: str | None = None,
    login_password: str | None = None,
) -> None:
    from ..worker import run_audit_task

    if not settings.use_celery_eager and not _redis_available():
        _run_in_process(
            audit_id,
            "Background queue unavailable; running audit in this API process.",
            login_email=login_email,
            login_password=login_password,
        )
        return

    try:
        result = run_audit_task.delay(audit_id, login_email=login_email, login_password=login_password)
        if getattr(result, "id", None):
            update_audit_run(audit_id, {"error": None})
    except Exception as exc:
        _run_in_process(
            audit_id,
            f"Background queue unavailable; running audit in this API process. ({exc})",
            login_email=login_email,
            login_password=login_password,
        )


@router.get("/api/health")
def health() -> dict[str, Any]:
    from ..config import settings

    return {
        "ok": True,
        "service": "civic-flow-auditor-python",
        "adk": "python",
        "queue": "celery",
        "maxPages": settings.max_pages,
        "aiProvider": settings.ai_provider,
        "openRouterConfigured": bool(settings.openrouter_api_key),
        "ocr": "enabled" if settings.enable_ocr else "disabled",
    }


@router.get("/api/audits")
def audits(limit: int = Query(default=50)) -> list[dict[str, Any]]:
    return list_audit_summaries(limit)


@router.post("/api/audits", status_code=202)
def create_audit(payload: CreateAuditRequest) -> dict[str, Any]:
    try:
        safe_url = validate_scan_target(payload.url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
    audit_id = uuid4().hex[:10]
    run = create_stored_audit_run(audit_id, safe_url, normalize_depth(payload.depth))
    _queue_audit(audit_id, login_email=payload.login_email, login_password=payload.login_password)
    return run.model_dump(mode="json")


@router.get("/api/audits/{audit_id}")
def get_audit(audit_id: str) -> dict[str, Any]:
    try:
        return load_audit_run(audit_id).model_dump(mode="json")
    except KeyError as exc:
        raise HTTPException(status_code=404, detail={"error": "Audit run not found."}) from exc


@router.post("/api/audits/{audit_id}/cancel")
def cancel_audit(audit_id: str) -> dict[str, Any]:
    try:
        run = update_audit_run(
            audit_id,
            {
                "status": "cancelled",
                "error": "Audit cancelled by the user.",
                "progress": max(load_audit_run(audit_id).progress, 5),
            },
        )
        return {"cancelled": True, "state": "cancelled", "run": run.model_dump(mode="json")}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail={"error": "Audit run not found."}) from exc


@router.post("/api/audits/{audit_id}/enhance")
def enhance_audit(audit_id: str) -> dict[str, Any]:
    try:
        run = load_audit_run(audit_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail={"error": "Audit run not found."}) from exc
    run.executiveSummary = run.executiveSummary or build_deterministic_summary(run)
    run.ai.status = "deterministic"
    run.ai.generatedFields = ["executiveSummary"]
    saved = save_audit_run(run)
    return saved.model_dump(mode="json")


@router.post("/api/audits/{audit_id}/purge-artifacts")
def purge_artifacts(audit_id: str) -> dict[str, Any]:
    try:
        run = load_audit_run(audit_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail={"error": "Audit run not found."}) from exc
    removed = purge_run_artifacts(audit_id)
    run.artifacts.screenshots = []
    run.artifacts.htmlReportPath = None
    run.artifacts.htmlReportUrl = None
    run.artifacts.pdfReportPath = None
    run.artifacts.pdfReportUrl = None
    run.artifacts.ticketReportPath = None
    run.artifacts.ticketReportUrl = None
    for finding in run.findings:
        finding.screenshotPath = None
        finding.screenshotUrl = None
    run.safetyNotes = list(dict.fromkeys([*run.safetyNotes, "Local scan evidence artifacts were purged from this audit run."]))
    saved = save_audit_run(run)
    return {"removed": removed, "auditRun": saved.model_dump(mode="json")}


@router.post("/api/audits/document-report")
def document_report(payload: SaveDocumentAuditRequest) -> dict[str, Any]:
    from ..tools.reporting import generate_report

    data = dict(payload.auditRun)
    if not data.get("id") or data.get("id") in {"empty-audit", "pending"}:
        data["id"] = f"doc-{uuid4().hex[:8]}"
    data.setdefault("url", "document-scan://local")
    data.setdefault("depth", "standard")
    data.setdefault("status", "report-ready")
    data.setdefault("progress", 100)
    timestamp = now_iso()
    data.setdefault("createdAt", timestamp)
    data["updatedAt"] = timestamp
    from ..schemas import AuditRun

    run = AuditRun.model_validate(data)
    run.executiveSummary = run.executiveSummary or build_deterministic_summary(run)
    run.artifacts = generate_report(run)
    saved = save_audit_run(run)
    return saved.model_dump(mode="json")


@router.get("/reports/{audit_id}.html")
def html_report(audit_id: str) -> FileResponse:
    path = get_run_dir(audit_id) / "report.html"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Report not found.")
    return FileResponse(path, media_type="text/html")


@router.get("/reports/{audit_id}.pdf")
def pdf_report(audit_id: str) -> FileResponse:
    path = get_run_dir(audit_id) / "report.pdf"
    if not path.exists():
        raise HTTPException(status_code=404, detail="PDF report not found.")
    return FileResponse(path, media_type="application/pdf")


@router.get("/artifacts/{audit_id}/{filename}")
def artifact(audit_id: str, filename: str) -> FileResponse:
    path = get_artifact_path(audit_id, filename)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Artifact not found.")
    return FileResponse(path)
