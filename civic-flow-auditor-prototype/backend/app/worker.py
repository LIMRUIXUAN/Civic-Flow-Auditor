from __future__ import annotations

from .agents.orchestrator import run_audit
from .config import settings
from .tools.accessibility import scan_accessibility
from .tools.crawl import crawl_site
from .tools.documents import parse_document, scan_document_image
from .tools.reporting import generate_report

try:
    from celery import Celery
except Exception:  # pragma: no cover - development fallback when Celery is not installed yet
    Celery = None


class _EagerResult:
    id = "eager"


class _EagerTask:
    def __init__(self, fn):
        self.fn = fn

    def delay(self, *args, **kwargs):
        self.fn(*args, **kwargs)
        return _EagerResult()

    def __call__(self, *args, **kwargs):
        return self.fn(*args, **kwargs)


def _make_celery():
    if Celery is None:
        return None
    app = Celery("civic_flow_auditor", broker=settings.redis_url, backend=settings.redis_url)
    app.conf.task_always_eager = settings.use_celery_eager
    app.conf.task_track_started = True
    app.conf.worker_prefetch_multiplier = 1
    return app


celery_app = _make_celery()


if celery_app:
    @celery_app.task(name="run_audit_task", bind=True)
    def run_audit_task(self, audit_id: str):
        return run_audit(audit_id).model_dump(mode="json")

    @celery_app.task(name="crawl_site_task")
    def crawl_site_task(url: str, max_pages: int | None = None, same_domain_only: bool = True):
        return crawl_site(url, max_pages=max_pages, same_domain_only=same_domain_only)

    @celery_app.task(name="scan_accessibility_task")
    def scan_accessibility_task(page: dict):
        return scan_accessibility(page)

    @celery_app.task(name="parse_document_task")
    def parse_document_task(pdf_url: str, source_page_url: str | None = None):
        return parse_document(pdf_url, source_page_url)

    @celery_app.task(name="scan_document_image_task")
    def scan_document_image_task(image_base64: str):
        return scan_document_image(image_base64)

    @celery_app.task(name="generate_report_task")
    def generate_report_task(audit_run: dict):
        from .schemas import AuditRun

        return generate_report(AuditRun.model_validate(audit_run)).model_dump(mode="json")
else:
    @_EagerTask
    def run_audit_task(audit_id: str):
        return run_audit(audit_id).model_dump(mode="json")

    @_EagerTask
    def crawl_site_task(url: str, max_pages: int | None = None, same_domain_only: bool = True):
        return crawl_site(url, max_pages=max_pages, same_domain_only=same_domain_only)

    @_EagerTask
    def scan_accessibility_task(page: dict):
        return scan_accessibility(page)

    @_EagerTask
    def parse_document_task(pdf_url: str, source_page_url: str | None = None):
        return parse_document(pdf_url, source_page_url)

    @_EagerTask
    def scan_document_image_task(image_base64: str):
        return scan_document_image(image_base64)

    @_EagerTask
    def generate_report_task(audit_run: dict):
        from .schemas import AuditRun

        return generate_report(AuditRun.model_validate(audit_run)).model_dump(mode="json")