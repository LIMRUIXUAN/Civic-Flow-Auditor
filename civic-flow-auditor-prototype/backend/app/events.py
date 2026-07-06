from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import AsyncIterator

from .schemas import AuditRun

_subscribers: dict[str, set[asyncio.Queue[AuditRun]]] = defaultdict(set)
_history_subscribers: set[asyncio.Queue[AuditRun]] = set()


def publish_audit_update(run: AuditRun) -> None:
    for queue in list(_subscribers.get(run.id, set())):
        queue.put_nowait(run)
    for queue in list(_history_subscribers):
        queue.put_nowait(run)


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