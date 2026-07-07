"""Partial-result and failure handling in the audit orchestrator.

These cover the resilience contract: a page-scan failure must be recorded as a
partial result (not a silent "0 issues"), a crawl failure must fail the run
cleanly, and a clean scan must not be flagged as failed.
"""
import app.agents.orchestrator as orchestrator
from app.repository import create_stored_audit_run, load_audit_run
from app.schemas import Artifacts


def _patch_common(monkeypatch):
    # Avoid network / Gemini / Playwright PDF during orchestration tests.
    monkeypatch.setattr(orchestrator, "enhance_audit_run", lambda run: run)
    monkeypatch.setattr(orchestrator, "generate_report", lambda run: Artifacts(htmlReportUrl=f"/reports/{run.id}.html"))
    monkeypatch.setattr(orchestrator, "parse_document", lambda url, src=None: {"url": url, "title": "doc"})


def test_scan_error_is_recorded_as_partial_result(temp_database, monkeypatch):
    _patch_common(monkeypatch)
    monkeypatch.setattr(orchestrator, "crawl_site", lambda url, **_: {
        "pages": [{"url": "https://example.gov/a"}, {"url": "https://example.gov/b"}],
        "documents": [],
        "skippedActions": [],
        "loginNotes": [],
    })
    # scan_accessibility never raises; it reports navigation failure via "error".
    monkeypatch.setattr(orchestrator, "scan_accessibility", lambda page, audit_id="": {
        "findings": [],
        "screenshotPath": None,
        "screenshotUrl": None,
        "skippedActions": [],
        "error": "Could not load or analyze page: timeout",
    })

    create_stored_audit_run("part01", "https://example.gov/", "standard")
    run = orchestrator.run_audit("part01")

    assert run.status == "report-ready"  # partial, not a hard failure
    assert all(p.error for p in run.pages)
    assert all(p.scanned is False for p in run.pages)
    assert any("could not be scanned" in note for note in run.safetyNotes)


def test_clean_scan_is_not_flagged_failed(temp_database, monkeypatch):
    _patch_common(monkeypatch)
    monkeypatch.setattr(orchestrator, "crawl_site", lambda url, **_: {
        "pages": [{"url": "https://example.gov/a"}],
        "documents": [],
        "skippedActions": [],
        "loginNotes": [],
    })
    monkeypatch.setattr(orchestrator, "scan_accessibility", lambda page, audit_id="": {
        "findings": [],
        "screenshotPath": None,
        "screenshotUrl": None,
        "skippedActions": [],
    })

    create_stored_audit_run("part02", "https://example.gov/", "standard")
    run = orchestrator.run_audit("part02")

    assert run.status == "report-ready"
    assert run.pages[0].scanned is True
    assert run.pages[0].error is None
    assert not any("could not be scanned" in note for note in run.safetyNotes)


def test_crawl_failure_fails_the_run(temp_database, monkeypatch):
    _patch_common(monkeypatch)

    def _boom(url, **_):
        raise RuntimeError("network unreachable")

    monkeypatch.setattr(orchestrator, "crawl_site", _boom)

    create_stored_audit_run("part03", "https://example.gov/", "standard")
    run = orchestrator.run_audit("part03")

    assert run.status == "failed"
    assert "Crawl failed" in (run.error or "")
    # The failure is durably persisted, not just on the in-memory object.
    assert load_audit_run("part03").status == "failed"
