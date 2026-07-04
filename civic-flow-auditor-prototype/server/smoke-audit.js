import fs from "node:fs/promises";
import { nanoid } from "nanoid";
import { runCivicFlowAudit } from "./audit-engine.js";
import { validateScanTarget } from "./security.js";
import { saveAuditRun } from "./store.js";

const targetUrl = process.argv[2] || "https://example.com/";

let safeUrl;
try {
  safeUrl = await validateScanTarget(targetUrl);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const run = await runCivicFlowAudit({
  id: `smoke-${nanoid(6)}`,
  url: safeUrl,
  depth: "quick",
  onUpdate: saveAuditRun,
});

if (run.status !== "report-ready") {
  console.error(`Smoke audit failed: ${run.error || run.status}`);
  process.exit(1);
}

if (!run.artifacts.htmlReportPath) {
  console.error("Smoke audit failed: missing HTML report path.");
  process.exit(1);
}

await fs.access(run.artifacts.htmlReportPath);

console.log(
  JSON.stringify(
    {
      id: run.id,
      url: run.url,
      pages: run.pages.length,
      documents: run.documents.length,
      findings: run.findings.length,
      htmlReportPath: run.artifacts.htmlReportPath,
      pdfReportPath: run.artifacts.pdfReportPath || null,
    },
    null,
    2,
  ),
);
