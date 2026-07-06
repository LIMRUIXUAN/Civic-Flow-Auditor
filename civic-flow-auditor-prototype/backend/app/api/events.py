from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from ..events import subscribe_audit
from ..repository import load_audit_run

router = APIRouter()


@router.get("/api/audits/{audit_id}/events")
async def audit_events(audit_id: str) -> StreamingResponse:
    try:
        initial = load_audit_run(audit_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail={"error": "Audit run not found."}) from exc

    async def stream():
        yield f"event: audit\ndata: {initial.model_dump_json()}\n\n"
        async for run in subscribe_audit(audit_id):
            yield f"event: audit\ndata: {run.model_dump_json()}\n\n"
            if run.status in {"report-ready", "failed", "cancelled"}:
                break

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "Connection": "keep-alive"})