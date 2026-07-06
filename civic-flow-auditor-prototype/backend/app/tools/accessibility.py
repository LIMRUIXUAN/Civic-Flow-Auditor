from __future__ import annotations

from uuid import uuid4

from ..schemas import Finding, PageSnapshot


def scan_accessibility(page: PageSnapshot | dict) -> dict:
    page_data = page if isinstance(page, dict) else page.model_dump()
    findings: list[Finding] = []
    title = page_data.get("title") or page_data.get("heading") or page_data.get("url", "Page")
    if not page_data.get("heading"):
        findings.append(
            Finding(
                id=f"axe-{uuid4().hex[:8]}",
                stage=page_data.get("session", "general"),
                stageLabel=page_data.get("sessionLabel", "General info"),
                title="Page may be missing a clear primary heading",
                impact="Residents using screen readers may not understand the purpose of the page quickly.",
                guideline="WCAG 2.4.6 Headings and Labels",
                severity="Medium",
                fix="Add one descriptive H1 that explains the page purpose.",
                ticket=f"Add a descriptive H1 to {title} and verify heading order.",
                url=page_data.get("url"),
                rule="heading-order-manual-check",
                humanReviewNote="Automated checks cannot prove the full heading structure is correct.",
                evidenceScore=55,
            )
        )
    if page_data.get("forms"):
        findings.append(
            Finding(
                id=f"form-{uuid4().hex[:8]}",
                stage=page_data.get("session", "general"),
                stageLabel=page_data.get("sessionLabel", "General info"),
                title="Form requires manual label and submission review",
                impact="A resident may be blocked if form fields do not expose accessible labels or errors.",
                guideline="WCAG 3.3.2 Labels or Instructions",
                severity="High",
                fix="Verify every input has a programmatic label, clear instructions, and accessible error messaging. Do not auto-submit during audit.",
                ticket=f"Review form accessibility on {page_data.get('url')} and add labels/instructions where missing.",
                url=page_data.get("url"),
                rule="form-label-manual-check",
                humanReviewNote="The agent records form structure but never submits public forms.",
                evidenceScore=65,
            )
        )
    return {"findings": [finding.model_dump(mode="json") for finding in findings], "screenshotPath": None, "screenshotUrl": None, "skippedActions": []}