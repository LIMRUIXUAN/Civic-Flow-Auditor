import assert from "node:assert/strict";
import test from "node:test";
import {
  buildIssueFlow,
  buildStagesFromPagesAndFindings,
  canonicalPageUrl,
  classifyJourney,
  createTimingMetadata,
  dedupeAndSortFindings,
  dedupePageSnapshots,
  documentRegionFindingDefaults,
  getTopBlockerSummary,
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

test("classifyJourney does not treat ordinary page text mentioning documents as linked PDFs", () => {
  assert.deepEqual(
    classifyJourney({
      url: "https://city.gov/services",
      heading: "Public services",
      textSample: "Read this document before visiting city hall.",
    }),
    {
      id: "general",
      label: "General info",
    },
  );
  assert.deepEqual(classifyJourney({ url: "https://city.gov/forms/permit.pdf", heading: "Permit guide" }), {
    id: "pdf",
    label: "Linked Documents",
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

test("dedupeAndSortFindings groups repeated axe findings across page hash variants", () => {
  const findings = dedupeAndSortFindings([
    {
      id: "AXE-001",
      stage: "pdf",
      stageLabel: "Linked Documents",
      title: "Elements must meet minimum color contrast ratio thresholds",
      impact: "Contrast issue",
      guideline: "WCAG 2.a.a",
      severity: "High",
      status: "To do",
      fix: "Fix contrast",
      ticket: "Ticket",
      url: "https://example.gov/apply#maincontent",
      selector: ".sign-in > span",
      rule: "AXE:WCAG 2.a.a:Elements must meet minimum color contrast ratio thresholds",
      screenshotUrl: "/artifacts/a.png",
      issueBoxes: [{ x: 1, y: 1, width: 10, height: 10, label: "1" }],
    },
    {
      id: "AXE-001",
      stage: "pdf",
      stageLabel: "Linked Documents",
      title: "Elements must meet minimum color contrast ratio thresholds",
      impact: "Contrast issue",
      guideline: "WCAG 2.a.a",
      severity: "High",
      status: "To do",
      fix: "Fix contrast",
      ticket: "Ticket",
      url: "https://example.gov/apply#choose-design",
      selector: ".hero--header > p",
      rule: "AXE:WCAG 2.a.a:Elements must meet minimum color contrast ratio thresholds",
      screenshotUrl: "/artifacts/a.png",
      issueBoxes: [{ x: 20, y: 20, width: 10, height: 10, label: "1" }],
    },
    {
      id: "AXE-001",
      stage: "pdf",
      stageLabel: "Linked Documents",
      title: "Page should contain a level-one heading",
      impact: "Heading issue",
      guideline: "WCAG review",
      severity: "Medium",
      status: "To do",
      fix: "Add heading",
      ticket: "Ticket",
      url: "https://example.gov/apply#choose-design",
      selector: "html",
      rule: "AXE:WCAG review:Page should contain a level-one heading",
    },
  ]);

  assert.equal(findings.length, 2);
  assert.equal(findings[0].title, "Elements must meet minimum color contrast ratio thresholds");
  assert.equal(findings[0].stage, "general");
  assert.equal(findings[0].stageLabel, "General info");
  assert.equal(findings[0].occurrenceCount, 2);
  assert.deepEqual(findings[0].relatedSelectors, [".sign-in > span", ".hero--header > p"]);
  assert.match(findings[0].ticket, /2 affected selectors/);
  assert.equal(new Set(findings.map((finding) => finding.id)).size, findings.length);
});

test("stored pdf stages are normalized when the evidence URL is an HTML page", () => {
  const stages = buildStagesFromPagesAndFindings(
    [{ url: "https://example.gov/about#maincontent", session: "pdf", sessionLabel: "Linked Documents", scanned: true }],
    [{ url: "https://example.gov/forms/guide.pdf", title: "Guide", matchedStage: "pdf" }],
    [],
  );

  assert.equal(stages.find((item) => item.id === "general").pages, 1);
  assert.equal(stages.find((item) => item.id === "pdf").documents, 1);
});

test("buildIssueFlow exposes linked previous and next issue ids", () => {
  const issues = [
    { id: "A", stage: "register" },
    { id: "B", stage: "register" },
    { id: "C", stage: "review" },
  ];
  const flow = buildIssueFlow(issues, "B", "register");

  assert.deepEqual(flow.issues.map((issue) => issue.id), ["A", "B"]);
  assert.equal(flow.currentIssue.id, "B");
  assert.equal(flow.previousIssue.id, "A");
  assert.equal(flow.nextIssue, null);
  assert.equal(flow.byId.get("A").nextId, "B");
  assert.equal(flow.byId.get("B").previousId, "A");
});

test("getTopBlockerSummary chooses the highest severity blocker and next action", () => {
  const summary = getTopBlockerSummary(
    [
      {
        id: "LOW-1",
        stage: "review",
        stageLabel: "Review and submit",
        title: "Minor copy issue",
        severity: "Low",
      },
      {
        id: "CRIT-1",
        stage: "upload",
        stageLabel: "Document upload",
        title: "Upload field has no accessible name",
        severity: "Critical",
      },
      {
        id: "HIGH-1",
        stage: "register",
        stageLabel: "Register",
        title: "Password error is not announced",
        severity: "High",
      },
    ],
    [{ id: "upload", name: "Document upload" }],
  );

  assert.equal(summary.hasBlockers, true);
  assert.equal(summary.topFinding.id, "CRIT-1");
  assert.equal(summary.criticalCount, 1);
  assert.equal(summary.highCount, 1);
  assert.equal(summary.blockerCount, 2);
  assert.equal(summary.affectedStageLabel, "Document upload");
  assert.match(summary.recommendedNextAction, /Resolve or assign/);
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
  assert.equal(stages[0].pages, 0);
  assert.equal(stages[0].documents, 1);
  assert.equal(stages[0].serious, 1);
});

test("stage page counts dedupe same-page hash anchors and keep document counts separate", () => {
  const pages = dedupePageSnapshots([
    { url: "https://example.gov/apply", session: "register", sessionLabel: "Register", scanned: true },
    { url: "https://example.gov/apply#maincontent", session: "register", sessionLabel: "Register", scanned: true },
    { url: "https://example.gov/apply#review", session: "register", sessionLabel: "Register", scanned: false },
  ]);
  const stages = buildStagesFromPagesAndFindings(
    pages,
    [{ url: "https://example.gov/forms/proof.pdf", title: "Proof", matchedStage: "register" }],
    [],
  );

  assert.equal(canonicalPageUrl("https://example.gov/apply#review"), "https://example.gov/apply");
  assert.equal(pages.length, 1);
  assert.equal(stages[0].pages, 1);
  assert.equal(stages[0].documents, 1);
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
