from __future__ import annotations

from collections import defaultdict

from ..repository import load_audit_run, save_audit_run
from ..schemas import (
    AgentStep,
    AuditRun,
    DocumentSnapshot,
    Finding,
    PageSnapshot,
    build_deterministic_summary,
    now_iso,
)
from ..tools.accessibility import scan_accessibility
from ..tools.crawl import crawl_site
from ..tools.documents import parse_document
from ..tools.reporting import generate_report
from .adk_agent import enhance_audit_run


def _steps() -> list[AgentStep]:
    return [
        AgentStep(name="Intake and Safety", detail="Input validated and public URL guardrails applied.", status="complete"),
        AgentStep(name="Discovery", detail="Crawl queued.", status="queued"),
        AgentStep(name="Accessibility Scan", detail="Page checks queued.", status="queued"),
        AgentStep(name="Document Review", detail="Linked documents queued.", status="queued"),
        AgentStep(name="Remediation", detail="Findings normalized.", status="queued"),
        AgentStep(name="Report Export", detail="Report generation queued.", status="queued"),
    ]


def _set_step(run: AuditRun, name: str, status: str, detail: str) -> None:
    for step in run.agentSteps:
        if step.name == name:
            step.status = status
            step.detail = detail
            return


_SEVERITY_ORDER = {"Critical": 0, "High": 1, "Medium": 2, "Low": 3}


def _cancel_requested(run: AuditRun) -> bool:
    """Re-read the stored status. Cancellation is written by the API process,
    so the in-memory copy held by this worker never sees it on its own."""
    if run.status == "cancelled":
        return True
    try:
        stored = load_audit_run(run.id)
    except KeyError:
        return False
    if stored.status == "cancelled":
        run.status = "cancelled"
        run.error = stored.error or "Audit cancelled by the user."
        return True
    return False


def _fail_run(run: AuditRun, step: str, detail: str, error: str) -> AuditRun:
    run.status = "failed"
    run.error = error[:300]
    _set_step(run, step, "failed", detail)
    return save_audit_run(run)


def _deduplicate_findings(findings: list[Finding]) -> list[Finding]:
    """
    Group findings by (rule, stage). Within each group keep one representative
    finding with occurrenceCount = group size and a list of all affected URLs.
    This prevents the same accessibility rule from appearing N times when it
    fires on every page.
    """
    groups: defaultdict[str, list[Finding]] = defaultdict(list)
    for f in findings:
        key = f"{f.rule or f.title}|{f.stage}"
        groups[key].append(f)

    result: list[Finding] = []
    for group in groups.values():
        if len(group) == 1:
            result.append(group[0])
            continue
        # Pick the copy with the most evidence (screenshot > no screenshot, then severity)
        group.sort(key=lambda f: (
            0 if f.screenshotPath else 1,
            _SEVERITY_ORDER.get(f.severity, 9),
        ))
        rep = group[0].model_copy(deep=True)
        rep.occurrenceCount = len(group)
        # Append affected-URL list to fix text so readers know scope
        affected_urls = list(dict.fromkeys(f.url for f in group if f.url))[:5]
        if len(affected_urls) > 1:
            url_list = ", ".join(affected_urls[:3]) + ("…" if len(affected_urls) > 3 else "")
            rep.fix = f"{rep.fix}\n\nFound on {len(group)} pages: {url_list}"
        result.append(rep)

    result.sort(key=lambda f: _SEVERITY_ORDER.get(f.severity, 9))
    return result


def run_audit(
    audit_id: str,
    login_email: str | None = None,
    login_password: str | None = None,
) -> AuditRun:
    run = load_audit_run(audit_id)
    if run.status == "cancelled":
        return run
    run.status = "validating"
    run.progress = 8
    run.agentSteps = _steps()
    save_audit_run(run)

    # --- Discovery ---
    run.status = "scanning"
    _set_step(run, "Discovery", "running", "Crawling public pages and linked PDFs.")
    save_audit_run(run)

    try:
        crawl = crawl_site(
            run.url,
            audit_id=run.id,
            login_email=login_email,
            login_password=login_password,
        )
    except Exception as exc:
        return _fail_run(run, "Discovery", "Crawl could not complete.", f"Crawl failed: {exc}")
    if _cancel_requested(run):
        return save_audit_run(run)

    run.pages = [PageSnapshot.model_validate(page) for page in crawl.get("pages", [])]
    run.documents = []
    failed_documents = 0
    for doc in crawl.get("documents", []):
        try:
            run.documents.append(
                DocumentSnapshot.model_validate(parse_document(doc.get("url", ""), doc.get("sourcePageUrl")))
            )
        except Exception as exc:
            failed_documents += 1
            run.documents.append(
                DocumentSnapshot(url=doc.get("url", ""), title=doc.get("url", "Document"), error=str(exc)[:200])
            )
    run.skippedActions = crawl.get("skippedActions", [])
    for note in crawl.get("loginNotes", []):
        if note:
            run.safetyNotes = list(dict.fromkeys([*run.safetyNotes, f"Authenticated crawl: {note}"]))
    run.progress = 32
    _set_step(run, "Discovery", "complete", f"{len(run.pages)} pages and {len(run.documents)} documents found.")
    save_audit_run(run)

    # --- Accessibility Scan ---
    _set_step(run, "Accessibility Scan", "running", "Running accessibility checks on each page.")
    save_audit_run(run)

    raw_findings: list[Finding] = []
    failed_pages = 0
    for page in run.pages:
        if _cancel_requested(run):
            return save_audit_run(run)
        scan = None
        scan_error: str | None = None
        for attempt in (1, 2):  # one retry per page before recording a partial result
            try:
                scan = scan_accessibility(page, audit_id=run.id)
            except Exception as exc:  # infra-level failure (e.g. Playwright crash)
                scan_error = f"Accessibility scan failed: {exc}"[:200]
                continue
            # scan_accessibility does not raise on navigation failure; it reports
            # the error in the result so partial evidence (a screenshot) survives.
            scan_error = f"Accessibility scan failed: {scan['error']}"[:200] if scan.get("error") else None
            if scan_error is None:
                break
        if scan is not None:
            raw_findings.extend(Finding.model_validate(f) for f in scan.get("findings", []))
            # Preserve screenshot paths from the accessibility scan back into the page
            if scan.get("screenshotPath") and not page.screenshotPath:
                page.screenshotPath = scan["screenshotPath"]
                page.screenshotUrl = scan.get("screenshotUrl")
            page.scanned = scan_error is None
        if scan_error:
            failed_pages += 1
            page.error = scan_error
        run.progress = min(67, run.progress + 8)
        save_audit_run(run)

    # Record partial results explicitly instead of failing silently.
    partial_notes = []
    if failed_pages:
        partial_notes.append(f"{failed_pages} page(s) could not be scanned after retry; this report is partial.")
    if failed_documents:
        partial_notes.append(f"{failed_documents} linked document(s) could not be parsed; this report is partial.")
    if partial_notes:
        run.safetyNotes = list(dict.fromkeys([*run.safetyNotes, *partial_notes]))

    # Deduplicate before saving
    run.findings = _deduplicate_findings(raw_findings)
    _set_step(run, "Accessibility Scan", "complete", f"{len(run.findings)} unique findings generated (from {len(raw_findings)} raw).")
    _set_step(run, "Document Review", "complete", f"{len(run.documents)} documents recorded for review.")
    run.progress = 76
    save_audit_run(run)

    # --- Remediation ---
    _set_step(run, "Remediation", "complete", "Findings mapped to resident impact, WCAG guidance, and tickets.")
    run.executiveSummary = build_deterministic_summary(run)
    run.progress = 84
    save_audit_run(run)

    if _cancel_requested(run):
        return save_audit_run(run)

    # --- AI Enhancement (Google ADK / Gemini) ---
    # Best-effort: rewrites the narrative with Gemini when GOOGLE_API_KEY is set;
    # otherwise leaves the deterministic text untouched and records why.
    try:
        run = enhance_audit_run(run)
    except Exception as exc:  # never let AI failure abort the audit
        run.ai.status = "failed"
        run.ai.error = str(exc)[:300]
    run.progress = 88
    save_audit_run(run)

    if _cancel_requested(run):
        return save_audit_run(run)

    # --- Report Export ---
    _set_step(run, "Report Export", "running", "Generating HTML report artifacts.")
    try:
        run.artifacts = generate_report(run)
    except Exception as exc:
        return _fail_run(run, "Report Export", "Report generation failed.", f"Report generation failed: {exc}")
    run.status = "report-ready"
    run.progress = 100
    run.updatedAt = now_iso()
    _set_step(run, "Report Export", "complete", "Standalone HTML report and tickets generated.")
    return save_audit_run(run)
