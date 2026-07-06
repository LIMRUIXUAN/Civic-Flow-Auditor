from __future__ import annotations

from ..repository import load_audit_run, save_audit_run
from ..schemas import AgentStep, AuditRun, DocumentSnapshot, PageSnapshot, build_deterministic_summary, now_iso
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


def run_audit(audit_id: str) -> AuditRun:
    run = load_audit_run(audit_id)
    if run.status == "cancelled":
        return run
    run.status = "validating"
    run.progress = 8
    run.agentSteps = _steps()
    save_audit_run(run)

    run.status = "scanning"
    _set_step(run, "Discovery", "running", "Crawling public pages and linked PDFs.")
    save_audit_run(run)
    crawl = crawl_site(run.url)
    run.pages = [PageSnapshot.model_validate(page) for page in crawl.get("pages", [])]
    run.documents = [DocumentSnapshot.model_validate(parse_document(doc.get("url", ""), doc.get("sourcePageUrl"))) for doc in crawl.get("documents", [])]
    run.skippedActions = crawl.get("skippedActions", [])
    run.progress = 32
    _set_step(run, "Discovery", "complete", f"{len(run.pages)} pages and {len(run.documents)} documents found.")
    save_audit_run(run)

    _set_step(run, "Accessibility Scan", "running", "Running deterministic accessibility checks.")
    findings = []
    for page in run.pages:
        if run.status == "cancelled":
            return save_audit_run(run)
        scan = scan_accessibility(page)
        findings.extend(scan.get("findings", []))
        page.scanned = True
        run.progress = min(67, run.progress + 8)
        save_audit_run(run)
    from ..schemas import Finding

    run.findings = [Finding.model_validate(finding) for finding in findings]
    _set_step(run, "Accessibility Scan", "complete", f"{len(run.findings)} findings generated.")
    _set_step(run, "Document Review", "complete", f"{len(run.documents)} documents recorded for review.")
    run.progress = 76
    save_audit_run(run)

    _set_step(run, "Remediation", "complete", "Findings mapped to resident impact, WCAG guidance, and tickets.")
    run.executiveSummary = build_deterministic_summary(run)
    run.progress = 88
    save_audit_run(run)

    _set_step(run, "Report Export", "running", "Generating HTML report artifacts.")
    run.artifacts = generate_report(run)
    run.status = "report-ready"
    run.progress = 100
    run.updatedAt = now_iso()
    _set_step(run, "Report Export", "complete", "Standalone HTML report and tickets generated.")
    return save_audit_run(run)