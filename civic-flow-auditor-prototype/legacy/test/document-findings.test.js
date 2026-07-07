import assert from "node:assert/strict";
import test from "node:test";
import { buildDocumentScanFindings, buildRefinedDocumentFindingPatch } from "../server/document-findings.js";
import { config } from "../server/config.js";

test("buildDocumentScanFindings uses deterministic fallback without leaking API keys", async () => {
  const original = {
    aiProvider: config.aiProvider,
    googleApiKey: config.googleApiKey,
  };
  try {
    config.aiProvider = "none";
    config.googleApiKey = "test-secret-key";

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

    assert.equal(result.aiReasoning.status, "unavailable");
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].severity, "Critical");
    assert.equal(result.findings[0].guidelineRefs.some((ref) => ref.url.includes("WCAG22")), true);
    assert.equal(JSON.stringify(result).includes("test-secret-key"), false);
  } finally {
    config.aiProvider = original.aiProvider;
    config.googleApiKey = original.googleApiKey;
  }
});

test("buildRefinedDocumentFindingPatch returns complete deterministic metadata", async () => {
  const original = {
    aiProvider: config.aiProvider,
    googleApiKey: config.googleApiKey,
  };
  try {
    config.aiProvider = "none";
    config.googleApiKey = "test-secret-key";

    const result = await buildRefinedDocumentFindingPatch({
      findingId: "DOC-case-001",
      filename: "benefits-notice.png",
      croppedImageUrl: "/artifacts/doc-scan/crop.png",
      region: {
        label: "2",
        type: "Form Input",
        text: "Applicant phone",
        x: 8,
        y: 12,
        width: 60,
        height: 8,
        accessibility_notes: "The printed line has no programmatic label.",
      },
      refinedResult: {
        type: "Form Input",
        extracted_text: "Applicant phone number",
        detailed_accessibility_evaluation: "Residents using assistive technology need a clear field label.",
        remediation_fix: "Create a tagged digital input with visible label, instructions, and autocomplete where appropriate.",
      },
    });

    assert.equal(result.findingId, "DOC-case-001");
    assert.equal(result.findingPatch.severity, "Critical");
    assert.match(result.findingPatch.guideline, /1\.3\.1/);
    assert.notEqual(result.findingPatch.guideline, "WCAG 2.1 1.1.1");
    assert.equal(result.findingPatch.guidelineRefs.some((ref) => ref.url.includes("WCAG22")), true);
    assert.match(result.findingPatch.ticket, /Priority: High/);
    assert.match(result.findingPatch.humanReviewNote, /human accessibility review/i);
    assert.equal(JSON.stringify(result).includes("test-secret-key"), false);
  } finally {
    config.aiProvider = original.aiProvider;
    config.googleApiKey = original.googleApiKey;
  }
});

test("buildRefinedDocumentFindingPatch uses mocked Gemini refinement when available", async () => {
  const original = {
    aiProvider: config.aiProvider,
    googleApiKey: config.googleApiKey,
    textModel: config.textModel,
  };
  try {
    config.aiProvider = "google";
    config.googleApiKey = "test-secret-key";
    config.textModel = "gemini-2.0-flash";

    const result = await buildRefinedDocumentFindingPatch({
      findingId: "DOC-case-002",
      filename: "appeal-form.png",
      croppedImageUrl: "/artifacts/doc-scan/crop.png",
      region: {
        label: "1",
        type: "Body Text",
        text: "Deadline is Friday",
        accessibility_notes: "Small text may be missed.",
      },
      refinedResult: {
        extracted_text: "Deadline is Friday",
        detailed_accessibility_evaluation: "Small text may be missed.",
      },
      fetchImpl: async () => ({
        ok: true,
        async json() {
          return {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        regions: [
                          {
                            label: "1",
                            title: "Deadline notice needs semantic emphasis",
                            severity: "High",
                            guideline: "WCAG 2.2 1.4.3",
                            impact: "Low-vision residents may miss the filing deadline.",
                            fix: "Publish selectable text with sufficient contrast and semantic emphasis.",
                            humanReviewNote: "Verify the deadline language with a human reviewer before publication.",
                          },
                        ],
                      }),
                    },
                  ],
                },
              },
            ],
          };
        },
      }),
    });

    assert.equal(result.aiReasoning.status, "enhanced");
    assert.equal(result.aiReasoning.model, "gemini-2.0-flash");
    assert.equal(result.findingPatch.title, "Deadline notice needs semantic emphasis");
    assert.equal(result.findingPatch.severity, "High");
    assert.match(result.findingPatch.ticket, /WCAG: WCAG 2.2 1.4.3/);
    assert.equal(JSON.stringify(result).includes("test-secret-key"), false);
  } finally {
    config.aiProvider = original.aiProvider;
    config.googleApiKey = original.googleApiKey;
    config.textModel = original.textModel;
  }
});
