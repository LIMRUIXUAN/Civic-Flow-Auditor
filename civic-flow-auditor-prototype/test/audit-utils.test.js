import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStagesFromPagesAndFindings,
  classifyJourney,
  createTimingMetadata,
  dedupeAndSortFindings,
  documentRegionFindingDefaults,
  guidelineRefsFor,
  isImageOnlyPdfText,
  matchDocumentToStage,
  mapAxeImpactToSeverity,
  validatePublicUrl,
} from "../shared/audit-utils.js";

test("validatePublicUrl accepts public https URLs", () => {
  const result = validatePublicUrl("https://example.com/services/register");
  assert.equal(result.ok, true);
  assert.equal(result.url, "https://example.com/services/register");
});

test("validatePublicUrl rejects localhost and private URLs", () => {
  assert.equal(validatePublicUrl("http://localhost:5173").ok, false);
  assert.equal(validatePublicUrl("http://192.168.1.2/apply").ok, false);
});

test("classifyJourney detects civic registration and submit stages", () => {
  assert.deepEqual(classifyJourney({ url: "https://city.gov/register", heading: "Create account" }), {
    id: "register",
    label: "Register",
  });
  assert.deepEqual(classifyJourney({ url: "https://city.gov/application/review", heading: "Review and submit" }), {
    id: "review",
    label: "Review and submit",
  });
});

test("mapAxeImpactToSeverity maps axe impacts to product severity", () => {
  assert.equal(mapAxeImpactToSeverity("critical"), "Critical");
  assert.equal(mapAxeImpactToSeverity("serious"), "High");
  assert.equal(mapAxeImpactToSeverity("moderate"), "Medium");
  assert.equal(mapAxeImpactToSeverity("minor"), "Low");
});

test("isImageOnlyPdfText flags PDFs with too little extracted text", () => {
  assert.equal(isImageOnlyPdfText(""), true);
  assert.equal(isImageOnlyPdfText("Form instructions deadline eligibility required documents renewal address phone email"), false);
});

test("dedupeAndSortFindings deduplicates by URL selector and rule, then sorts by severity", () => {
  const findings = dedupeAndSortFindings([
    {
      id: "LOW-1",
      stage: "general",
      stageLabel: "General",
      title: "Vague link",
      impact: "Impact",
      guideline: "WCAG",
      severity: "Low",
      status: "To do",
      fix: "Fix",
      ticket: "Ticket",
      url: "https://example.com",
      selector: "a",
      rule: "link-name",
    },
    {
      id: "CRIT-1",
      stage: "register",
      stageLabel: "Register",
      title: "Missing label",
      impact: "Impact",
      guideline: "WCAG",
      severity: "Critical",
      status: "To do",
      fix: "Fix",
      ticket: "Ticket",
      url: "https://example.com/form",
      selector: "#email",
      rule: "label",
      screenshotUrl: "/artifacts/a.png",
    },
    {
      id: "CRIT-DUP",
      stage: "register",
      stageLabel: "Register",
      title: "Missing label again",
      impact: "Impact",
      guideline: "WCAG",
      severity: "Critical",
      status: "To do",
      fix: "Fix",
      ticket: "Ticket",
      url: "https://example.com/form",
      selector: "#email",
      rule: "label",
    },
  ]);

  assert.equal(findings.length, 2);
  assert.equal(findings[0].id, "CRIT-1");
  assert.equal(findings[0].severity, "Critical");
  assert.equal(findings[0].evidenceScore > findings[1].evidenceScore, true);
});

test("buildStagesFromPagesAndFindings counts scanned documents in the Document Scan stage", () => {
  const stages = buildStagesFromPagesAndFindings(
    [],
    [{ url: "/artifacts/doc-scan/crop.png", title: "Notice", matchedStage: "document-scan" }],
    [
      {
        id: "DOC-1",
        stage: "document-scan",
        stageLabel: "Document Scan",
        title: "Body text critique",
        impact: "Impact",
        guideline: "WCAG 2.1 1.1.1",
        severity: "High",
        status: "To do",
        fix: "Fix",
        ticket: "Ticket",
      },
    ],
  );

  assert.deepEqual(stages.map((stage) => stage.id), ["document-scan"]);
  assert.equal(stages[0].pages, 1);
  assert.equal(stages[0].serious, 1);
});

test("guidelineRefsFor returns source links without requiring model output", () => {
  const refs = guidelineRefsFor("WCAG 2.2 1.3.1");
  assert.equal(refs.some((ref) => ref.url.includes("WCAG22/#1.3.1")), true);
  assert.equal(refs.some((ref) => ref.url.includes("ada.gov")), true);
});

test("matchDocumentToStage maps upload instructions to document upload", () => {
  const mapped = matchDocumentToStage(
    {
      url: "https://example.gov/forms/proof.pdf",
      title: "Required upload proof",
      extractedText: "Attach a photo ID and upload supporting documents before review.",
      matchedStage: "pdf",
    },
    [],
  );
  assert.equal(mapped.matchedStage, "upload");
  assert.match(mapped.matchedStageReason, /Matched/);
});

test("documentRegionFindingDefaults maps form inputs to label guidance", () => {
  const defaults = documentRegionFindingDefaults({ type: "Form Input", text: "Applicant name" });
  assert.equal(defaults.severity, "Critical");
  assert.match(defaults.guideline, /1\.3\.1/);
});

test("createTimingMetadata records 3-minute target status", () => {
  const timing = createTimingMetadata("2026-01-01T00:00:00.000Z", "2026-01-01T00:02:00.000Z");
  assert.equal(timing.durationMs, 120000);
  assert.equal(timing.withinTarget, true);
});
