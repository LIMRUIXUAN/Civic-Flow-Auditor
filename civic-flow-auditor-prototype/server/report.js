import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { guidelineRefsFor, humanReviewNoteFor } from "../shared/audit-utils.js";
import { config } from "./config.js";
import { getRunDir } from "./store.js";

const maxInlineEvidenceImages = 8;
const maxInlineEvidenceBytes = 1_500_000;
const inlineImageExtensions = new Set(["png", "jpg", "jpeg"]);

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function imageDataUrl(filePath) {
  if (!filePath) return "";
  try {
    const resolved = path.resolve(filePath);
    const storageRoot = path.resolve(config.storageDir);
    if (!resolved.startsWith(`${storageRoot}${path.sep}`)) return "";
    const stats = await fs.stat(filePath);
    if (stats.size > maxInlineEvidenceBytes) return "";
    const ext = path.extname(filePath).toLowerCase().replace(".", "") || "png";
    if (!inlineImageExtensions.has(ext)) return "";
    const bytes = await fs.readFile(resolved);
    return `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${bytes.toString("base64")}`;
  } catch {
    return "";
  }
}

function buildTicketMarkdown(auditRun) {
  const lines = [
    "# Civic Flow Auditor Developer Tickets",
    "",
    `Audit: ${auditRun.url}`,
    `Findings: ${auditRun.findings.length}`,
    "",
  ];
  for (const finding of auditRun.findings) {
    lines.push(`## ${finding.id} ${finding.title}`);
    lines.push("");
    lines.push(`Severity: ${finding.severity}`);
    lines.push(`Stage: ${finding.stageLabel}`);
    lines.push(`Guideline: ${finding.guideline}`);
    const refs = finding.guidelineRefs?.length ? finding.guidelineRefs : guidelineRefsFor(finding.guideline);
    if (refs.length) {
      lines.push(`Sources: ${refs.map((ref) => `${ref.label} (${ref.url})`).join("; ")}`);
    }
    lines.push(`Human review: ${finding.humanReviewNote || humanReviewNoteFor(finding.guideline)}`);
    lines.push("");
    lines.push(finding.ticket || `Fix: ${finding.fix}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export async function buildReportHtml(auditRun) {
  const images = new Map();
  let inlineEvidenceCount = 0;
  for (const finding of auditRun.findings) {
    if (finding.screenshotPath && !images.has(finding.screenshotPath)) {
      const dataUrl = inlineEvidenceCount < maxInlineEvidenceImages ? await imageDataUrl(finding.screenshotPath) : "";
      if (dataUrl) inlineEvidenceCount += 1;
      images.set(finding.screenshotPath, dataUrl);
    }
  }

  const stageRows = auditRun.stages
    .map(
      (stage) => `
        <tr>
          <td>${escapeHtml(stage.name)}</td>
          <td>${stage.pages}</td>
          <td>${stage.critical}</td>
          <td>${stage.serious}</td>
          <td>${stage.minor}</td>
        </tr>`,
    )
    .join("");

  const findingRows = auditRun.findings
    .map((finding) => {
      const dataUrl = images.get(finding.screenshotPath) || "";
      const refs = finding.guidelineRefs?.length ? finding.guidelineRefs : guidelineRefsFor(finding.guideline);
      const guidelineLinks = refs
        .map((ref) => `<a href="${escapeHtml(ref.url)}">${escapeHtml(ref.label)}</a>`)
        .join(" | ");
      const evidenceHtml = dataUrl
        ? finding.stage === "document-scan" && finding.issueBoxes?.length
          ? `<figure class="document-evidence"><img src="${dataUrl}" alt="Cropped document evidence for ${escapeHtml(finding.id)}">${finding.issueBoxes
              .map(
                (box) =>
                  `<span class="doc-box" style="left:${box.x}%;top:${box.y}%;width:${box.width}%;height:${box.height}%"><b>${escapeHtml(box.label)}</b></span>`,
              )
              .join("")}<figcaption><strong>${escapeHtml(finding.severity)}</strong> ${escapeHtml(finding.title)}</figcaption></figure>`
          : `<img src="${dataUrl}" alt="Annotated screenshot evidence for ${escapeHtml(finding.id)}">`
        : "";
      const evidenceLink =
        !dataUrl && finding.screenshotUrl
          ? `<p class="meta"><b>Evidence artifact:</b> <a href="${escapeHtml(finding.screenshotUrl)}">${escapeHtml(path.basename(finding.screenshotPath || finding.screenshotUrl))}</a></p>`
          : "";
      return `
        <article class="finding">
          <div class="finding-head">
            <strong>${escapeHtml(finding.id)} ${escapeHtml(finding.title)}</strong>
            <span>${escapeHtml(finding.severity)}</span>
          </div>
          <p><b>Journey:</b> ${escapeHtml(finding.stageLabel)} | <b>Guideline:</b> ${escapeHtml(finding.guideline)}</p>
          ${guidelineLinks ? `<p><b>Rule sources:</b> ${guidelineLinks}</p>` : ""}
          ${finding.matchedStageReason ? `<p class="meta"><b>Stage mapping:</b> ${escapeHtml(finding.matchedStageReason)}</p>` : ""}
          <p><b>Resident impact:</b> ${escapeHtml(finding.impact)}</p>
          <p><b>Recommended fix:</b> ${escapeHtml(finding.fix)}</p>
          <p><b>Human review:</b> ${escapeHtml(finding.humanReviewNote || humanReviewNoteFor(finding.guideline))}</p>
          ${evidenceHtml}
          ${evidenceLink}
          <pre>${escapeHtml(finding.ticket)}</pre>
        </article>`;
    })
    .join("");

  const documentRows = auditRun.documents
    .map(
      (doc) => `
        <tr>
          <td>${escapeHtml(doc.title || doc.url)}</td>
          <td>${doc.textLength}</td>
          <td>${doc.imageOnly ? "Needs accessible replacement" : "Text extracted"}</td>
          <td>${escapeHtml(doc.matchedStage || "pdf")}${doc.matchedStageReason ? `<br><span class="meta">${escapeHtml(doc.matchedStageReason)}</span>` : ""}</td>
          <td>${escapeHtml(doc.summary)}</td>
        </tr>`,
    )
    .join("");

  const skippedRows = (auditRun.skippedActions || [])
    .slice(0, 30)
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.action)}</td>
          <td>${escapeHtml(item.method || "")}</td>
          <td>${escapeHtml(item.reason)}</td>
          <td>${escapeHtml(item.url)}</td>
        </tr>`,
    )
    .join("");

  const aiLabel = auditRun.ai?.status === "enhanced" ? `AI-enhanced via ${auditRun.ai.model}` : auditRun.ai?.status === "failed" ? `AI unavailable (${auditRun.ai.model})` : "Deterministic";
  const lighthouseLabel =
    auditRun.scanner?.lighthouse?.status === "complete"
      ? `${auditRun.scanner.lighthouse.accessibilityScore ?? "Unknown"}`
      : auditRun.scanner?.lighthouse?.status || "not-run";
  const timing = auditRun.scanner?.timing || {};
  const timingLabel =
    typeof timing.durationMs === "number"
      ? `${Math.round(timing.durationMs / 1000)}s (${timing.withinTarget ? "within" : "over"} 3-minute target)`
      : "not-recorded";
  const inputLabel = auditRun.url === "document-scan://local" ? "Document scan" : auditRun.url;
  const inputTitle = auditRun.url === "document-scan://local" ? "Input" : "Website";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Civic Flow Auditor Report</title>
  <style>
    body { font-family: Arial, sans-serif; color: #132238; margin: 0; padding: 32px; background: #f6f8fb; line-height: 1.55; }
    main { max-width: 1120px; margin: 0 auto; background: #fff; border: 1px solid #d8e1ee; padding: 32px; border-radius: 18px; }
    h1, h2 { color: #0d355f; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 20px 0; }
    .summary div { border: 1px solid #dbe5f2; border-radius: 12px; padding: 14px; background: #f8fbff; }
    table { width: 100%; border-collapse: collapse; margin: 14px 0 28px; }
    th, td { border: 1px solid #dbe5f2; text-align: left; padding: 10px; vertical-align: top; }
    th { background: #eef5fb; }
    .finding { border: 2px solid #dbe5f2; border-radius: 16px; padding: 18px; margin: 18px 0; page-break-inside: avoid; }
    .finding-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
    .finding-head span { border-radius: 999px; background: #e9f4ff; padding: 6px 12px; font-weight: 700; }
    img { max-width: 100%; border: 1px solid #b7c5d8; border-radius: 12px; margin: 12px 0; }
    .document-evidence { position: relative; display: inline-block; max-width: 100%; margin: 12px 0; }
    .document-evidence img { display: block; margin: 0; }
    .document-evidence figcaption { border: 2px solid #0f766e; border-left: 8px solid #f59e0b; border-radius: 10px; padding: 10px 12px; margin-top: 8px; background: #f8fbff; }
    .doc-box { position: absolute; border: 5px solid #0f766e; outline: 3px solid #f59e0b; box-sizing: border-box; }
    .doc-box b { position: absolute; left: -5px; top: -34px; background: #0f3557; color: white; border-radius: 999px; padding: 5px 10px; font: 700 16px Arial; }
    a { color: #155ee8; font-weight: 700; overflow-wrap: anywhere; }
    pre { white-space: pre-wrap; background: #0f1f32; color: #f8fbff; padding: 14px; border-radius: 12px; }
    .safety { border-left: 6px solid #d97706; background: #fff8e8; padding: 14px 18px; }
    .meta { color: #475569; }
  </style>
</head>
<body>
  <main>
    <h1>Civic Flow Auditor Report</h1>
    <p><b>${escapeHtml(inputTitle)}:</b> ${escapeHtml(inputLabel)}<br><b>Scan depth:</b> ${escapeHtml(auditRun.depth)}<br><b>Status:</b> ${escapeHtml(auditRun.status)}</p>
    <p class="meta"><b>Report mode:</b> ${escapeHtml(aiLabel)}<br><b>Lighthouse accessibility:</b> ${escapeHtml(lighthouseLabel)}<br><b>OCR:</b> ${escapeHtml(auditRun.scanner?.ocr?.status || "not-run")}<br><b>Timing:</b> ${escapeHtml(timingLabel)}</p>
    <section class="summary" aria-label="Audit summary">
      <div><b>${auditRun.pages.length}</b><br>Pages discovered</div>
      <div><b>${auditRun.documents.length}</b><br>Documents found</div>
      <div><b>${auditRun.stages.length}</b><br>Journey stages</div>
      <div><b>${auditRun.findings.length}</b><br>Findings</div>
    </section>
    <h2>Executive Summary</h2>
    <p>${escapeHtml(auditRun.executiveSummary || "Deterministic report generated. Manual accessibility review is still recommended.")}</p>
    <section class="safety">
      <h2>Safety And Compliance Positioning</h2>
      <ul>${auditRun.safetyNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>
      <p class="meta">Uploaded scan images and generated evidence are stored locally for report export until the audit artifacts are purged.</p>
    </section>
    <h2>User Journey Map</h2>
    <table>
      <thead><tr><th>Stage</th><th>Pages</th><th>Critical</th><th>High</th><th>Medium/Low</th></tr></thead>
      <tbody>${stageRows || "<tr><td colspan=\"5\">No stages discovered.</td></tr>"}</tbody>
    </table>
    <h2>Linked Documents And Scanned Files</h2>
    <table>
      <thead><tr><th>Document</th><th>Extracted text length</th><th>Status</th><th>Mapped stage</th><th>Summary</th></tr></thead>
      <tbody>${documentRows || "<tr><td colspan=\"5\">No linked or scanned documents were found.</td></tr>"}</tbody>
    </table>
    <h2>Skipped Actions And Safety Guardrails</h2>
    <table>
      <thead><tr><th>Action</th><th>Method</th><th>Reason</th><th>URL</th></tr></thead>
      <tbody>${skippedRows || "<tr><td colspan=\"4\">No blocked browser actions were recorded.</td></tr>"}</tbody>
    </table>
    <h2>Accessibility Findings And Fixes</h2>
    ${findingRows || "<p>No automated findings were produced. Manual accessibility review is still recommended.</p>"}
  </main>
</body>
</html>`;
}

export async function generateReport(auditRun) {
  const runDir = getRunDir(auditRun.id);
  await fs.mkdir(runDir, { recursive: true });
  const html = await buildReportHtml(auditRun);
  const htmlReportPath = path.join(runDir, "report.html");
  const pdfReportPath = path.join(runDir, "report.pdf");
  const ticketReportPath = path.join(runDir, "tickets.md");

  await fs.writeFile(htmlReportPath, html, "utf8");
  await fs.writeFile(ticketReportPath, buildTicketMarkdown(auditRun), "utf8");

  let pdfReportUrl;
  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({ path: pdfReportPath, format: "A4", printBackground: true });
    await browser.close();
    pdfReportUrl = `/reports/${auditRun.id}.pdf`;
  } catch (error) {
    await fs.writeFile(path.join(runDir, "pdf-error.txt"), `${error instanceof Error ? error.message : String(error)}\n`, "utf8");
  }

  return {
    htmlReportPath,
    htmlReportUrl: `/reports/${auditRun.id}.html`,
    pdfReportPath: pdfReportUrl ? pdfReportPath : undefined,
    pdfReportUrl,
    ticketReportPath,
    ticketReportUrl: `/artifacts/${auditRun.id}/tickets.md`,
    screenshots: auditRun.artifacts?.screenshots || [],
  };
}
