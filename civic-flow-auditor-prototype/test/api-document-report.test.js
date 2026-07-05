import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { createApiApp, scanDocumentTitle } from "../server/api.js";
import { artifactUrl, ensureRunDir, getArtifactPath } from "../server/store.js";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function withServer(fn) {
  const app = createApiApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("scanDocumentTitle preserves uploaded document names separately from artifact filenames", () => {
  assert.equal(scanDocumentTitle("C:\\fakepath\\benefits-appeal-notice.png"), "benefits-appeal-notice.png");
  assert.equal(scanDocumentTitle("../private/form.png"), "form.png");
  assert.equal(scanDocumentTitle(""), "Scanned document");
  assert.notEqual(scanDocumentTitle("benefits-appeal-notice.png"), "crop-123.png");
});

test("document-report generates html pdf and tickets, then purge removes local artifact references", async () => {
  const sourceRunId = "api-doc-src";
  await ensureRunDir(sourceRunId);
  const evidencePath = getArtifactPath(sourceRunId, "crop.png");
  await fs.writeFile(evidencePath, tinyPng);

  await withServer(async (baseUrl) => {
    const reportResponse = await fetch(`${baseUrl}/api/audits/document-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auditRun: {
          id: "empty-audit",
          depth: "standard",
          documents: [
            {
              url: artifactUrl(sourceRunId, "crop.png"),
              title: "Notice",
              matchedStage: "document-scan",
              imageOnly: true,
              textLength: 4,
              summary: "Scanned notice",
            },
          ],
          findings: [
            {
              id: "DOC-1",
              stage: "document-scan",
              stageLabel: "Document Scan",
              title: "Body text critique",
              impact: "Low-vision residents may miss the text.",
              guideline: "WCAG 2.2 1.1.1",
              severity: "High",
              status: "To do",
              fix: "Provide tagged digital text.",
              ticket: "Ticket",
              url: artifactUrl(sourceRunId, "crop.png"),
              screenshotPath: evidencePath,
              screenshotUrl: artifactUrl(sourceRunId, "crop.png"),
              issueBoxes: [{ x: 5, y: 5, width: 90, height: 90, label: "1" }],
            },
          ],
        },
      }),
    });
    const report = await reportResponse.json();

    assert.equal(reportResponse.ok, true);
    assert.equal(report.status, "report-ready");
    assert.equal(Boolean(report.artifacts.htmlReportUrl), true);
    assert.equal(Boolean(report.artifacts.pdfReportUrl), true);
    assert.equal(Boolean(report.artifacts.ticketReportUrl), true);

    const purgeResponse = await fetch(`${baseUrl}/api/audits/${report.id}/purge-artifacts`, { method: "POST" });
    const purge = await purgeResponse.json();

    assert.equal(purgeResponse.ok, true);
    assert.equal(purge.auditRun.artifacts.screenshots.length, 0);
    assert.equal(purge.auditRun.findings[0].screenshotPath, undefined);
    assert.equal(purge.auditRun.documents[0].url, "purged-local-scan-artifact");
  });
});
