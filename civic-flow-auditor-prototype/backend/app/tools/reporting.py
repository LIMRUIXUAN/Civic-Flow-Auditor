from __future__ import annotations

import logging
from html import escape
from pathlib import Path

from ..artifacts import get_run_dir, write_text_artifact
from ..schemas import Artifacts, AuditRun, Finding

logger = logging.getLogger(__name__)


def _severity_color(severity: str) -> str:
    return {"Critical": "#dc2626", "High": "#ea580c", "Medium": "#d97706", "Low": "#16a34a"}.get(severity, "#6b7280")


def _screenshot_html(finding: Finding, base_url: str = "", use_local_paths: bool = False) -> str:
    url = finding.screenshotUrl
    if use_local_paths and finding.screenshotPath and Path(finding.screenshotPath).exists():
        # PDF rendering opens the report from file://, so /artifacts URLs would
        # not resolve; point directly at the screenshot files on disk instead.
        url = Path(finding.screenshotPath).resolve().as_uri()
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


def _skipped_and_failed_html(run: AuditRun) -> str:
    """Explicit partial-results section: anything the audit could not complete
    is listed here instead of being silently omitted."""
    rows: list[tuple[str, str, str]] = []
    for p in run.pages:
        if p.error:
            rows.append(("Page scan", p.url, p.error))
    for d in run.documents:
        if d.error:
            rows.append(("Document", d.url, d.error))
        elif d.imageOnly:
            rows.append(("Document", d.url, "Image-only PDF; text could not be extracted automatically."))
    for action in run.skippedActions:
        rows.append(("Skipped action", action.url or run.url, f"{action.action}: {action.reason}"))
    if run.ai.status in {"unavailable", "failed"}:
        rows.append(("AI enhancement", "", run.ai.error or "AI enhancement did not run; deterministic text was kept."))
    if not rows:
        return ""
    body = "".join(
        f"<tr><td>{escape(kind)}</td><td>{escape(where or '—')}</td><td>{escape(detail)}</td></tr>"
        for kind, where, detail in rows
    )
    return (
        "<h2>Skipped and Failed Steps</h2>"
        "<p class=\"meta\">These items could not be completed automatically. The findings above are partial for them and need manual review.</p>"
        "<table><thead><tr><th>Type</th><th>Where</th><th>Detail</th></tr></thead>"
        f"<tbody>{body}</tbody></table>"
    )


def _occurrence_badge(finding: Finding) -> str:
    count = finding.occurrenceCount
    if count <= 1:
        return ""
    return f' <span class="badge" title="This issue was found on {count} pages">×{count} pages</span>'


def build_ai_fix_prompt(finding: Finding, run_url: str = "") -> str:
    """Build a copy-paste prompt a developer can hand to any AI assistant to get a
    concrete, code-level fix for a single accessibility finding."""
    lines = [
        "You are a senior web accessibility engineer. Fix the WCAG accessibility issue below.",
        "",
        f"Issue: {finding.title}",
        f"Severity: {finding.severity}",
        f"Journey stage: {finding.stageLabel}",
        f"WCAG guideline: {finding.guideline}",
    ]
    if finding.url or run_url:
        lines.append(f"Page URL: {finding.url or run_url}")
    if finding.selector:
        lines.append(f"Element selector: {finding.selector}")
    lines.append(f"Resident impact: {finding.impact}")
    lines.append(f"Baseline recommended fix: {finding.fix}")
    if finding.sourceSnippet:
        snippet = " ".join(finding.sourceSnippet.split())[:600]
        lines += ["Offending HTML / source:", snippet]
    lines += [
        "",
        "Respond with:",
        "1. The root cause in one sentence.",
        "2. Corrected, accessible HTML/ARIA/CSS for this specific element.",
        "3. How to verify the fix with a screen reader and keyboard-only navigation.",
        "Do not claim legal or WCAG certification; this assists human review.",
    ]
    return "\n".join(lines)


# Injected once at the end of the report; powers the per-finding "Copy" buttons.
_COPY_SCRIPT = """
<script>
function copyPrompt(id, btn) {
  var el = document.getElementById(id);
  if (!el) return;
  var text = el.textContent;
  var done = function () {
    var original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(function () { btn.textContent = original; }, 1500);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
  } else {
    fallbackCopy(text, done);
  }
}
function fallbackCopy(text, done) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  document.body.removeChild(ta);
  done();
}
</script>
"""


def build_report_html(run: AuditRun, use_local_paths: bool = False) -> str:
    severity_order = {"Critical": 0, "High": 1, "Medium": 2, "Low": 3}
    sorted_findings = sorted(run.findings, key=lambda f: severity_order.get(f.severity, 9))

    finding_sections = []
    for i, f in enumerate(sorted_findings, 1):
        color = _severity_color(f.severity)
        screenshot = _screenshot_html(f, use_local_paths=use_local_paths)
        badge = _occurrence_badge(f)
        prompt_text = build_ai_fix_prompt(f, run.url)
        prompt_block = (
            f'<div class="ai-prompt-block">'
            f'<div class="ai-prompt-head"><span>🤖 AI fix prompt — paste into any AI assistant</span>'
            f'<button type="button" class="copy-btn" onclick="copyPrompt(\'prompt-{i}\', this)">Copy</button></div>'
            f'<pre class="ai-prompt" id="prompt-{i}">{escape(prompt_text)}</pre>'
            f'</div>'
        )
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
    {prompt_block}
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

    stages_covered = list(dict.fromkeys(p.sessionLabel for p in run.pages if p.sessionLabel))
    pages_scanned = sum(1 for p in run.pages if p.scanned)
    skipped_section = _skipped_and_failed_html(run)

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
  .ai-prompt-block {{ margin-top: 12px; border: 1px solid #c7d2fe; border-radius: 8px; overflow: hidden; }}
  .ai-prompt-head {{ display: flex; align-items: center; justify-content: space-between; gap: 8px; background: #eef2ff; padding: 6px 12px; font-size: .82rem; font-weight: 600; color: #3730a3; }}
  .copy-btn {{ background: #4f46e5; color: #fff; border: none; border-radius: 4px; padding: 3px 14px; font-size: .78rem; cursor: pointer; }}
  .copy-btn:hover {{ background: #4338ca; }}
  .ai-prompt {{ margin: 0; padding: 12px; background: #0f172a; color: #e2e8f0; font-size: .8rem; line-height: 1.5; white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, "Cascadia Code", Consolas, monospace; max-height: 340px; overflow: auto; }}
  footer {{ margin-top: 32px; color: #9ca3af; font-size: .82rem; }}
  @media (max-width:600px) {{ body {{ padding: 12px; }} .container {{ padding: 16px; }} }}
  @media print {{
    body {{ background: #fff; padding: 0; }}
    .container {{ box-shadow: none; padding: 0; max-width: none; }}
    .finding, .summary-card, table {{ break-inside: avoid; }}
    .copy-btn {{ display: none; }}
    .ai-prompt {{ max-height: none; overflow: visible; }}
    a {{ color: inherit; text-decoration: none; }}
  }}
</style>
</head>
<body>
<div class="container">
  <h1>Civic Flow Auditor Report</h1>
  <p class="meta">
    <b>URL:</b> <a href="{escape(run.url)}" target="_blank" rel="noopener">{escape(run.url)}</a><br>
    <b>Status:</b> {escape(run.status)} &nbsp;|&nbsp;
    <b>Depth:</b> {escape(run.depth)} &nbsp;|&nbsp;
    <b>Pages scanned:</b> {pages_scanned} of {len(run.pages)} &nbsp;|&nbsp;
    <b>Documents:</b> {len(run.documents)} &nbsp;|&nbsp;
    <b>Journey coverage:</b> {len(stages_covered)} stage(s){f" — {escape(', '.join(stages_covered[:6]))}" if stages_covered else ""}
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

  {skipped_section}

  <h2>Safety Notes</h2>
  <ul>{safety}</ul>

  <footer>
    This is an accessibility assistance report, not legal certification. Human review with disabled users or
    accessibility professionals is required before making compliance claims.
  </footer>
</div>
{_COPY_SCRIPT}
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
            "### AI fix prompt",
            "```text",
            build_ai_fix_prompt(finding, run.url),
            "```",
            "",
        ])
    return "\n".join(lines)


def _render_pdf(run: AuditRun) -> Path | None:
    """Best-effort Playwright print-to-PDF. Returns the PDF path on success,
    None when Playwright/Chromium is unavailable or rendering fails — the HTML
    report is always the primary artifact."""
    try:
        from playwright.sync_api import sync_playwright
    except Exception as exc:
        logger.warning("PDF export skipped for audit %s: Playwright is not installed (%s)", run.id, exc)
        return None
    pdf_path = get_run_dir(run.id) / "report.pdf"
    # Render from a temporary copy whose screenshots use file:// paths, since
    # the /artifacts URLs in report.html only resolve through the API server.
    source_path = get_run_dir(run.id) / "report-pdf-source.html"
    try:
        source_path.write_text(build_report_html(run, use_local_paths=True), encoding="utf-8")
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            try:
                page = browser.new_page()
                page.goto(source_path.resolve().as_uri(), wait_until="load", timeout=30000)
                page.emulate_media(media="print")
                page.pdf(
                    path=str(pdf_path),
                    format="A4",
                    print_background=True,
                    margin={"top": "12mm", "bottom": "12mm", "left": "10mm", "right": "10mm"},
                )
            finally:
                browser.close()
        if pdf_path.exists():
            return pdf_path
        logger.warning("PDF export produced no file for audit %s (Chromium exited without error).", run.id)
        return None
    except Exception:
        # Logged with the full traceback (not swallowed) so a Chromium/system-
        # dependency failure on a deploy target like Render is visible in logs,
        # while the HTML report remains the unaffected primary artifact.
        logger.exception("PDF export failed for audit %s; falling back to HTML-only report.", run.id)
        return None
    finally:
        source_path.unlink(missing_ok=True)


def generate_report(run: AuditRun) -> Artifacts:
    html_path, html_url = write_text_artifact(run.id, "report.html", build_report_html(run))
    ticket_path, ticket_url = write_text_artifact(run.id, "tickets.md", build_ticket_markdown(run))
    pdf_path = _render_pdf(run)
    return Artifacts(
        htmlReportPath=str(html_path),
        htmlReportUrl=f"/reports/{run.id}.html",
        pdfReportPath=str(pdf_path) if pdf_path else None,
        pdfReportUrl=f"/reports/{run.id}.pdf" if pdf_path else None,
        ticketReportPath=str(ticket_path),
        ticketReportUrl=ticket_url,
        screenshots=list(dict.fromkeys(
            f.screenshotPath for f in run.findings if f.screenshotPath
        )),
    )
