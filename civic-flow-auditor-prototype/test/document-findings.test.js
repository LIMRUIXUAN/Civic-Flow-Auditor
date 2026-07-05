import assert from "node:assert/strict";
import test from "node:test";
import { buildDocumentScanFindings } from "../server/document-findings.js";
import { config } from "../server/config.js";

test("buildDocumentScanFindings uses deterministic fallback without leaking API keys", async () => {
  const original = {
    aiProvider: config.aiProvider,
    openRouterApiKey: config.openRouterApiKey,
  };
  config.aiProvider = "none";
  config.openRouterApiKey = "sk-test-secret";

  const result = await buildDocumentScanFindings({
    croppedImageUrl: "/artifacts/doc-scan/crop.png",
    croppedImagePath: "D:/tmp/crop.png",
    filename: "notice.png",
    regions: [
      {
        label: "1",
        type: "Form Input",
        text: "Applicant name",
        x: 10,
        y: 20,
        width: 30,
        height: 8,
        accessibility_notes: "Visual line needs a digital label.",
      },
    ],
  });

  config.aiProvider = original.aiProvider;
  config.openRouterApiKey = original.openRouterApiKey;

  assert.equal(result.aiReasoning.status, "unavailable");
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].severity, "Critical");
  assert.equal(result.findings[0].guidelineRefs.some((ref) => ref.url.includes("WCAG22")), true);
  assert.equal(JSON.stringify(result).includes("sk-test-secret"), false);
});
