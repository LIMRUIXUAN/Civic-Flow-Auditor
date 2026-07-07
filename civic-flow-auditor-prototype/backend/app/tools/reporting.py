from __future__ import annotations

from html import escape
from pathlib import Path

from ..artifacts import write_text_artifact
from ..schemas import Artifacts, AuditRun, Finding


def _severity_color(severity: str) -> str:
    return {"Critical": "#dc2626", "High": "#ea580c", "Medium": "#d97706", "Low": "#16a34a"}.get(severity, "#6b7280")


def _screenshot_html(finding: Finding, base_url: str = "") -> str:
    url = finding.screenshotUrl
    if not url:
        return ""
    full_url = f"{base_url}{url}" if url.startswith("/") else url
    return (
        f'<div class="screenshot-wrap">'
        f'<img src="{escape(full_url)}" alt="Screenshot evidence for: {escape(finding.title)}" '
        f'loading="lazy" style="max-width:100%;border:2px solid #e5e7eb;border-radius:6px;margin-top:8px;" />'
        f'</div>'
    )


def _missing_items_note(run: AuditRun) -> str:
    items = []
    pages_no_screenshot = [p for p in run.pages if not p.screenshotPath]
    if pages_no_screenshot:
        items.append(f"{len(pages_no_screenshot)} page(s) could not be screenshotted (may require authentication or JavaScript rendering)")
    findings_no_evidence = [f for f in run.findings if not f.screenshotUrl]
    if findings_no_evidence:
        items.append(f"{len(findings_no_evidence)} finding(s) lack screenshot evidence (element bounding box not available)")
    if not items:
        return ""
    li = "".join(f"<li>{escape(item)}</li>" for item in items)
    return f'<div class="missing-note"><strong>Items needing manual review:</strong><ul>{li}</ul></div>'


def _occurrence_badge(finding: Finding) -> str:
    count = finding.occurrenceCount
    if count <= 1:
        return ""
    return f' <span class="badge" title="This issue was found on {count} pages">×{count} pages</span>'


def build_report_html(run: AuditRun) -> str:
    severity_order = {"Critical": 0, "High": 1, "Medium": 2, "Low": 3}
    sorted_findings = sorted(run.findings, key=lambda f: severity_order.get(f.severity, 9))

    finding_sections = []
    for i, f in enumerate(sorted_findings, 1):
        color = _severity_color(f.severity)
        screenshot = _screenshot_html(f)
        badge = _occurrence_badge(f)
        finding_sections.append(f"""
<div class="finding" id="finding-{i}">
  <div class="finding-header" style="border-left:5px solid {color}">
    <span class="severity-badge" style="background:{color}">{escape(f.severity)}</span>
    <span class="finding-num">#{i}</span>
    <strong>{escape(f.title)}</strong>{badge}
    <span class="stage-tag">{escape(f.stageLabel)}</span>
  </div>
  <div class="finding-body">
    <p><b>Impact:</b> {escape(f.impact)}</p>
    <p><b>Guideline:</b> {escape(f.guideline)}</p>
    <p><b>Fix:</b> {escape(f.fix)}</p>
    {f'<p><b>URL:</b> <a href="{escape(f.url)}" target="_blank" rel="noopener">{escape(f.url)}</a></p>' if f.url else ''}
    {f'<p><b>Selector:</b> <code>{escape(f.selector)}</code></p>' if f.selector else ''}
    {f'<p><b>Source:</b> <code class="snippet">{escape((f.sourceSnippet or "")[:200])}</code></p>' if f.sourceSnippet else ''}
    {f'<p class="human-note"><em>{escape(f.humanReviewNote)}</em></p>' if f.humanReviewNote else ''}
    {screenshot}
  </div>
</div>""")

    document_rows = "".join(
        f"<tr><td>{escape(d.title)}</td><td>{escape(d.ocrStatus)}</td><td>{escape(d.summary or '—')}</td></tr>"
        for d in run.documents
    )
    safety = "".join(f"<li>{escape(note)}</li>" for note in run.safetyNotes)
    missing_note = _missing_items_note(run)

    page_rows = "".join(
        f"<tr>"
        f"<td>{escape(p.sessionLabel)}</td>"
        f"<td><a href=\"{escape(p.url)}\" target=\"_blank\" rel=\"noopener\">{escape(p.url)}</a></td>"
        f"<td>{escape(p.title or '—')}</td>"
        f"<td>{'Yes' if p.screenshotPath else '<span style=\"color:#dc2626\">No</span>'}</td>"
        f"</tr>"
        for p in run.pages
    )

    critical = sum(1 for f in run.findings if f.severity == "Critical")
    high = sum(1 for f in run.findings if f.severity == "High")
    medium = sum(1 for f in run.findings if f.severity == "Medium")
    low = sum(1 for f in run.findings if f.severity == "Low")

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Civic Flow Audit Report — {escape(run.url)}</title>
<style>
  *, *::before, *::after {{ box-sizing: border-box; }}
  body {{ font-family: Arial, Helvetica, sans-serif; line-height: 1.55; margin: 0; padding: 32px; color: #1f2937; background: #f9fafb; }}
  .container {{ max-width: 960px; margin: 0 auto; background: #fff; padding: 32px; border-radius: 10px; box-shadow: 0 2px 12px rgba(0,0,0,.08); }}
  h1 {{ font-size: 1.7rem; margin-top: 0; color: #0f3557; }}
  h2 {{ font-size: 1.2rem; border-bottom: 2px solid #e5e7eb; padding-bottom: 6px; margin-top: 32px; color: #0f3557; }}
  .meta {{ color: #4b5563; font-size: .9rem; }}
  .summary-strip {{ display: flex; gap: 16px; flex-wrap: wrap; margin: 16px 0; }}
  .summary-card {{ flex: 1; min-width: 100px; border-radius: 8px; padding: 12px 16px; text-align: center; color: #fff; }}
  .summary-card .num {{ font-size: 2rem; font-weight: 700; line-height: 1; }}
  .summary-card .lbl {{ font-size: .8rem; opacity: .9; }}
  table {{ width: 100%; border-collapse: collapse; margin: 12px 0; font-size: .9rem; }}
  th, td {{ border: 1px solid #e5e7eb; padding: 8px 10px; text-align: left; vertical-align: top; }}
  th {{ background: #f3f4f6; font-weight: 600; }}
  tr:hover {{ background: #f9fafb; }}
  .finding {{ margin: 16px 0; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }}
  .finding-header {{ display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 10px 14px; background: #f8fafc; }}
  .severity-badge {{ border-radius: 4px; color: #fff; padding: 2px 8px; font-size: .8rem; font-weight: 700; white-space: nowrap; }}
  .finding-num {{ color: #6b7280; font-size: .85rem; }}
  .stage-tag {{ margin-left: auto; background: #e0f2fe; color: #0369a1; border-radius: 12px; padding: 2px 10px; font-size: .78rem; }}
  .badge {{ background: #7c3aed; color: #fff; border-radius: 10px; padding: 1px 8px; font-size: .75rem; cursor: help; }}
  .finding-body {{ padding: 12px 16px; }}
  .finding-body p {{ margin: 6px 0; }}
  .snippet {{ background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: .82rem; word-break: break-all; }}
  .human-note {{ color: #6b7280; font-size: .85rem; }}
  .screenshot-wrap {{ margin-top: 10px; }}
  .missing-note {{ background: #fef3c7; border: 1px solid #fbbf24; border-radius: 6px; padding: 10px 14px; margin: 12px 0; font-size: .88rem; }}
  .missing-note ul {{ margin: 6px 0 0 0; padding-left: 18px; }}
  footer {{ margin-top: 32px; color: #9ca3af; font-size: .82rem; }}
  @media (max-width:600px) {{ body {{ padding: 12px; }} .container {{ padding: 16px; }} }}
</style>
</head>
<body>
<div class="container">
  <h1>Civic Flow Auditor Report</h1>
  <p class="meta">
    <b>URL:</b> <a href="{escape(run.url)}" target="_blank" rel="noopener">{escape(run.url)}</a><br>
    <b>Status:</b> {escape(run.status)} &nbsp;|&nbsp;
    <b>Depth:</b> {escape(run.depth)} &nbsp;|&nbsp;
    <b>Pages scanned:</b> {len(run.pages)} &nbsp;|&nbsp;
    <b>Documents:</b> {len(run.documents)}
  </p>
  <p>{escape(run.executiveSummary or "Deterministic report generated. Manual accessibility review is still recommended.")}</p>

  <div class="summary-strip">
    <div class="summary-card" style="background:#dc2626"><div class="num">{critical}</div><div class="lbl">Critical</div></div>
    <div class="summary-card" style="background:#ea580c"><div class="num">{high}</div><div class="lbl">High</div></div>
    <div class="summary-card" style="background:#d97706"><div class="num">{medium}</div><div class="lbl">Medium</div></div>
    <div class="summary-card" style="background:#16a34a"><div class="num">{low}</div><div class="lbl">Low</div></div>
  </div>

  {missing_note}

  <h2>Pages Audited</h2>
  <table>
    <thead><tr><th>Journey Stage</th><th>URL</th><th>Title</th><th>Screenshot</th></tr></thead>
    <tbody>{page_rows or '<tr><td colspan="4">No pages recorded.</td></tr>'}</tbody>
  </table>

  <h2>Findings ({len(run.findings)} unique issues)</h2>
  {''.join(finding_sections) or '<p>No findings recorded.</p>'}

  <h2>Documents</h2>
  <table>
    <thead><tr><th>Title</th><th>OCR Status</th><th>Summary</th></tr></thead>
    <tbody>{document_rows or '<tr><td colspan="3">No documents recorded.</td></tr>'}</tbody>
  </table>

  <h2>Safety Notes</h2>
  <ul>{safety}</ul>

  <footer>
    This is an accessibility assistance report, not legal certification. Human review with disabled users or
    accessibility professionals is required before making compliance claims.
  </footer>
</div>
</body>
</html>"""


def build_ticket_markdown(run: AuditRun) -> str:
    lines = [f"# Accessibility tickets for {run.url}", ""]
    for finding in run.findings:
        count_note = f" (×{finding.occurrenceCount} pages)" if finding.occurrenceCount > 1 else ""
        lines.extend([
            f"## {finding.title}{count_note}",
            f"Severity: {finding.severity}",
            f"Stage: {finding.stageLabel}",
            f"URL: {finding.url or run.url}",
            "",
            finding.ticket,
            "",
            f"Fix: {finding.fix}",
            "",
        ])
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
        screenshots=list(dict.fromkeys(
            f.screenshotPath for f in run.findings if f.screenshotPath
        )),
    )
