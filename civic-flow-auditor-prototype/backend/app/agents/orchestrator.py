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

    crawl = crawl_site(
        run.url,
        audit_id=run.id,
        login_email=login_email,
        login_password=login_password,
    )
    run.pages = [PageSnapshot.model_validate(page) for page in crawl.get("pages", [])]
    run.documents = [
        DocumentSnapshot.model_validate(parse_document(doc.get("url", ""), doc.get("sourcePageUrl")))
        for doc in crawl.get("documents", [])
    ]
    run.skippedActions = crawl.get("skippedActions", [])
    run.progress = 32
    _set_step(run, "Discovery", "complete", f"{len(run.pages)} pages and {len(run.documents)} documents found.")
    save_audit_run(run)

    # --- Accessibility Scan ---
    _set_step(run, "Accessibility Scan", "running", "Running accessibility checks on each page.")
    save_audit_run(run)

    raw_findings: list[Finding] = []
    for page in run.pages:
        if run.status == "cancelled":
            return save_audit_run(run)
        scan = scan_accessibility(page, audit_id=run.id)
        raw_findings.extend(Finding.model_validate(f) for f in scan.get("findings", []))
        # Preserve screenshot paths from the accessibility scan back into the page
        if scan.get("screenshotPath") and not page.screenshotPath:
            page.screenshotPath = scan["screenshotPath"]
            page.screenshotUrl = scan.get("screenshotUrl")
        page.scanned = True
        run.progress = min(67, run.progress + 8)
        save_audit_run(run)

    # Deduplicate before saving
    run.findings = _deduplicate_findings(raw_findings)
    _set_step(run, "Accessibility Scan", "complete", f"{len(run.findings)} unique findings generated (from {len(raw_findings)} raw).")
    _set_step(run, "Document Review", "complete", f"{len(run.documents)} documents recorded for review.")
    run.progress = 76
    save_audit_run(run)

    # --- Remediation ---
    _set_step(run, "Remediation", "complete", "Findings mapped to resident impact, WCAG guidance, and tickets.")
    run.executiveSummary = build_deterministic_summary(run)
    run.progress = 88
    save_audit_run(run)

    # --- Report Export ---
    _set_step(run, "Report Export", "running", "Generating HTML report artifacts.")
    run.artifacts = generate_report(run)
    run.status = "report-ready"
    run.progress = 100
    run.updatedAt = now_iso()
    _set_step(run, "Report Export", "complete", "Standalone HTML report and tickets generated.")
    return save_audit_run(run)
