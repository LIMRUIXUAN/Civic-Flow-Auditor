from app.schemas import AuditRun, DocumentSnapshot, Finding, PageSnapshot, SkippedAction, now_iso
from app.tools import reporting


def _sample_run() -> AuditRun:
    run = AuditRun(
        id="rep-test-01",
        url="https://example.gov/",
        depth="standard",
        status="report-ready",
        progress=100,
        executiveSummary="Sample summary.",
        createdAt=now_iso(),
        updatedAt=now_iso(),
    )
    run.pages = [
        PageSnapshot(url="https://example.gov/", title="Home", sessionLabel="General info", scanned=True),
        PageSnapshot(url="https://example.gov/login", sessionLabel="Login", scanned=False, error="Could not load or analyze page: timeout"),
    ]
    run.documents = [DocumentSnapshot(url="https://example.gov/form.pdf", title="Form", imageOnly=True)]
    run.skippedActions = [SkippedAction(url="https://example.gov/apply", action="form submit", reason="No-auto-submit guardrail")]
    run.findings = [
        Finding(
            id="F1", stage="login", stageLabel="Login", title="Input missing label",
            impact="Screen reader users cannot identify the field.", guideline="WCAG 1.3.1",
            severity="Critical", fix="Add a <label> element.", ticket="Add label to #email input.",
            url="https://example.gov/login", selector="#email",
            sourceSnippet='<input id="email" type="text">',
        )
    ]
    run.ai.status = "unavailable"
    run.ai.error = "GOOGLE_API_KEY is not configured."
    return run


def test_report_html_includes_partial_results_section():
    html = reporting.build_report_html(_sample_run())
    assert "Skipped and Failed Steps" in html
    assert "Could not load or analyze page: timeout" in html
    assert "Image-only PDF" in html
    assert "No-auto-submit guardrail" in html
    assert "GOOGLE_API_KEY is not configured." in html


def test_report_html_includes_journey_coverage_and_scan_ratio():
    html = reporting.build_report_html(_sample_run())
    assert "Journey coverage:" in html
    assert "1 of 2" in html  # one of two pages actually scanned


def test_ai_fix_prompt_contains_selector_guideline_and_snippet():
    finding = _sample_run().findings[0]
    prompt = reporting.build_ai_fix_prompt(finding, "https://example.gov/")
    assert "#email" in prompt
    assert "WCAG 1.3.1" in prompt
    assert '<input id="email"' in prompt
    assert "certification" in prompt.lower()  # disclaimer present


def test_generate_report_writes_html_and_tickets(temp_database, monkeypatch):
    # Skip the Playwright PDF pass so the test stays fast and offline.
    monkeypatch.setattr(reporting, "_render_pdf", lambda run: None)
    run = _sample_run()
    artifacts = reporting.generate_report(run)
    assert artifacts.htmlReportUrl == f"/reports/{run.id}.html"
    assert artifacts.htmlReportPath and artifacts.ticketReportPath
    from pathlib import Path

    assert Path(artifacts.htmlReportPath).exists()
    assert Path(artifacts.ticketReportPath).exists()
    assert "AI fix prompt" in Path(artifacts.ticketReportPath).read_text(encoding="utf-8")
