from __future__ import annotations

import asyncio
import time

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from ..events import TERMINAL_STATUSES
from ..repository import load_audit_run

router = APIRouter()

_POLL_SECONDS = 1.0
# Comment lines keep proxies/load balancers from closing an idle SSE stream.
_HEARTBEAT_SECONDS = 15.0


@router.get("/api/audits/{audit_id}/events")
async def audit_events(audit_id: str) -> StreamingResponse:
    try:
        load_audit_run(audit_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail={"error": "Audit run not found."}) from exc

    async def stream():
        # Poll durable storage instead of in-memory queues so progress written
        # by Celery workers or background threads is always visible here.
        last_signature: tuple | None = None
        last_sent = time.monotonic()
        while True:
            try:
                run = await asyncio.to_thread(load_audit_run, audit_id)
            except KeyError:
                return
            signature = (run.updatedAt, run.status, run.progress, len(run.findings), len(run.pages))
            if signature != last_signature:
                last_signature = signature
                last_sent = time.monotonic()
                yield f"event: audit\ndata: {run.model_dump_json()}\n\n"
                if run.status in TERMINAL_STATUSES:
                    return
            elif time.monotonic() - last_sent >= _HEARTBEAT_SECONDS:
                last_sent = time.monotonic()
                yield ": heartbeat\n\n"
            await asyncio.sleep(_POLL_SECONDS)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )
