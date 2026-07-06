from __future__ import annotations

from html import escape

from ..artifacts import write_text_artifact
from ..schemas import Artifacts, AuditRun


def build_report_html(run: AuditRun) -> str:
    finding_rows = "".join(
        f"<tr><td>{escape(f.severity)}</td><td>{escape(f.stageLabel)}</td><td>{escape(f.title)}</td><td>{escape(f.fix)}</td></tr>"
        for f in run.findings
    )
    document_rows = "".join(
        f"<tr><td>{escape(d.title)}</td><td>{escape(d.ocrStatus)}</td><td>{escape(d.summary)}</td></tr>"
        for d in run.documents
    )
    safety = "".join(f"<li>{escape(note)}</li>" for note in run.safetyNotes)
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Civic Flow Auditor Report</title>
<style>
body {{ font-family: Arial, sans-serif; line-height: 1.5; margin: 32px; color: #1f2937; }}
table {{ width: 100%; border-collapse: collapse; margin: 16px 0; }}
th, td {{ border: 1px solid #d1d5db; padding: 8px; text-align: left; vertical-align: top; }}
th {{ background: #f3f4f6; }}
.meta {{ color: #4b5563; }}
</style>
</head>
<body>
<h1>Civic Flow Auditor Report</h1>
<p><b>Audit:</b> {escape(run.url)}<br><b>Status:</b> {escape(run.status)}<br><b>Depth:</b> {escape(run.depth)}</p>
<p>{escape(run.executiveSummary or "Deterministic report generated. Manual accessibility review is still recommended.")}</p>
<h2>Safety Notes</h2>
<ul>{safety}</ul>
<h2>Findings</h2>
<table><thead><tr><th>Severity</th><th>Stage</th><th>Issue</th><th>Fix</th></tr></thead><tbody>{finding_rows or '<tr><td colspan="4">No findings recorded.</td></tr>'}</tbody></table>
<h2>Documents</h2>
<table><thead><tr><th>Title</th><th>OCR</th><th>Summary</th></tr></thead><tbody>{document_rows or '<tr><td colspan="3">No documents recorded.</td></tr>'}</tbody></table>
<p class="meta">This is an accessibility assistance report, not legal certification.</p>
</body>
</html>"""


def build_ticket_markdown(run: AuditRun) -> str:
    lines = [f"# Accessibility tickets for {run.url}", ""]
    for finding in run.findings:
        lines.extend(
            [
                f"## {finding.title}",
                f"Severity: {finding.severity}",
                f"Stage: {finding.stageLabel}",
                f"URL: {finding.url or run.url}",
                "",
                finding.ticket,
                "",
                f"Fix: {finding.fix}",
                "",
            ]
        )
    return "\n".join(lines)


def generate_report(run: AuditRun) -> Artifacts:
    html_path, html_url = write_text_artifact(run.id, "report.html", build_report_html(run))
    ticket_path, ticket_url = write_text_artifact(run.id, "tickets.md", build_ticket_markdown(run))
    return Artifacts(
        htmlReportPath=str(html_path),
        htmlReportUrl=f"/reports/{run.id}.html",
        pdfReportPath=None,
        pdfReportUrl=None,
        ticketReportPath=str(ticket_path),
        ticketReportUrl=ticket_url,
        screenshots=run.artifacts.screenshots,
    )