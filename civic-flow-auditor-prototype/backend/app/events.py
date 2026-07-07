from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import AsyncIterator

from .schemas import AuditRun

TERMINAL_STATUSES = {"report-ready", "failed", "cancelled"}

_subscribers: dict[str, set[asyncio.Queue[AuditRun]]] = defaultdict(set)
_history_subscribers: set[asyncio.Queue[AuditRun]] = set()


def publish_audit_update(run: AuditRun) -> None:
    """Best-effort in-process fan-out. Called from worker threads and Celery
    processes, so it must never raise (a full queue or a missing event loop in
    the caller must not break saving an audit run)."""
    for queue in list(_subscribers.get(run.id, set())):
        try:
            queue.put_nowait(run)
        except Exception:
            pass
    for queue in list(_history_subscribers):
        try:
            queue.put_nowait(run)
        except Exception:
            pass


async def subscribe_audit(audit_id: str) -> AsyncIterator[AuditRun]:
    queue: asyncio.Queue[AuditRun] = asyncio.Queue(maxsize=100)
    _subscribers[audit_id].add(queue)
    try:
        while True:
            yield await queue.get()
    finally:
        _subscribers[audit_id].discard(queue)


async def subscribe_history() -> AsyncIterator[AuditRun]:
    queue: asyncio.Queue[AuditRun] = asyncio.Queue(maxsize=100)
    _history_subscribers.add(queue)
    try:
        while True:
            yield await queue.get()
    finally:
        _history_subscribers.discard(queue)
