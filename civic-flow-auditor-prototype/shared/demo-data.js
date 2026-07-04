import { createAuditRunBase, nowIso } from "./audit-contract.js";

export const toolDefinitions = [
  {
    name: "crawl_site",
    agent: "Discovery Agent",
    icon: "Globe2",
    output: "pages, PDFs, forms",
  },
  {
    name: "map_journey",
    agent: "Journey Mapper",
    icon: "Route",
    output: "sessions and tasks",
  },
  {
    name: "scan_accessibility",
    agent: "Audit Agent",
    icon: "CheckCircle2",
    output: "axe violations",
  },
  {
    name: "parse_document",
    agent: "Document Agent",
    icon: "FileSearch",
    output: "document summary",
  },
  {
    name: "annotate_screenshot",
    agent: "Evidence Agent",
    icon: "Camera",
    output: "annotated evidence",
  },
  {
    name: "generate_report",
    agent: "Report Agent",
    icon: "FileText",
    output: "report.html",
  },
];

export const defaultAgentSteps = [
  { name: "Intake and Safety", detail: "URL validated, scope set, no auto-submit guard active", status: "complete" },
  { name: "Discovery", detail: "10 pages and 3 PDFs found", status: "complete" },
  { name: "Journey Mapper", detail: "4 public-service sessions mapped", status: "complete" },
  { name: "Guideline", detail: "WCAG 2.1 AA and ADA notes loaded", status: "complete" },
  { name: "Accessibility Audit", detail: "axe-core checks running", status: "running" },
  { name: "Document Review", detail: "PDF text extraction queued", status: "queued" },
  { name: "Evidence Annotation", detail: "Issue frames and callouts prepared", status: "queued" },
  { name: "Remediation", detail: "Plain-language fixes and tickets drafted", status: "queued" },
  { name: "Safety Review", detail: "Legal-certification limits attached", status: "queued" },
  { name: "Report Export", detail: "Standalone HTML report ready next", status: "queued" },
];

export const defaultStages = [
  { id: "general", name: "General info", pages: 1, critical: 0, serious: 1, minor: 0 },
  { id: "register", name: "Register", pages: 1, critical: 2, serious: 1, minor: 0 },
  { id: "personal", name: "Personal info", pages: 2, critical: 1, serious: 2, minor: 0 },
  { id: "verify", name: "Verification", pages: 1, critical: 1, serious: 1, minor: 0 },
  { id: "notify", name: "Notifications", pages: 1, critical: 0, serious: 1, minor: 0 },
  { id: "review", name: "Review and submit", pages: 1, critical: 1, serious: 0, minor: 0 },
  { id: "confirm", name: "Confirmation", pages: 1, critical: 1, serious: 0, minor: 0 },
  { id: "pdf", name: "Linked Documents", pages: 3, critical: 1, serious: 1, minor: 0 },
];

export const defaultIssues = [
  {
    id: "AXE-001",
    stage: "register",
    stageLabel: "Register",
    title: "Missing label on Email address field",
    impact: "Screen reader users may not know what information to enter, which can block account creation.",
    guideline: "WCAG 2.1 1.3.1",
    severity: "Critical",
    status: "To do",
    fix: "Add a visible label associated with the email input using a for/id pair or aria-labelledby.",
    ticket:
      "Title: Add label for email field on Register page\nDescription: The email address input is missing a programmatically associated label.\nAcceptance criteria: Screen reader announces Email address when the field receives focus.\nWCAG: 2.1 1.3.1\nPriority: High\nComponent: Register form",
  },
  {
    id: "AXE-014",
    stage: "register",
    stageLabel: "Register",
    title: "Low contrast instructions",
    impact: "Low-vision residents may miss password and deadline instructions before submitting the form.",
    guideline: "WCAG 2.1 1.4.3",
    severity: "High",
    status: "To do",
    fix: "Raise instruction text contrast to at least 4.5:1 and keep the text visible near the relevant field.",
    ticket:
      "Title: Increase contrast for Register instructions\nDescription: Instruction text does not meet 4.5:1 contrast for normal text.\nAcceptance criteria: All helper text passes contrast at normal and large text sizes.\nWCAG: 2.1 1.4.3\nPriority: High\nComponent: Register form",
  },
  {
    id: "PDF-002",
    stage: "pdf",
    stageLabel: "Linked Documents",
    title: "Image-only PDF application guide",
    impact: "Screen reader users cannot read document requirements, deadlines, or eligibility text.",
    guideline: "WCAG 2.1 1.1.1",
    severity: "Critical",
    status: "To do",
    fix: "Replace the scanned PDF with tagged text, headings, form fields, and readable document structure.",
    ticket:
      "Title: Replace image-only application guide PDF\nDescription: The PDF appears to be scanned and has no extractable text.\nAcceptance criteria: PDF text is selectable and announced by screen readers.\nWCAG: 2.1 1.1.1\nPriority: High\nComponent: Documents",
  },
  {
    id: "KEY-008",
    stage: "register",
    stageLabel: "Register",
    title: "Keyboard focus lost after Next",
    impact: "Keyboard-only users may lose their place when moving from registration to verification.",
    guideline: "WCAG 2.1 2.4.3",
    severity: "Critical",
    status: "In progress",
    fix: "Move focus to the next step heading after navigation and preserve a visible focus indicator.",
    ticket:
      "Title: Preserve focus after Register Next action\nDescription: Keyboard focus is not moved to a meaningful element after navigation.\nAcceptance criteria: Focus lands on the next step heading and remains visible.\nWCAG: 2.1 2.4.3\nPriority: High\nComponent: Registration flow",
  },
];

export function createDemoAuditRun(overrides = {}) {
  const base = createAuditRunBase({
    id: overrides.id || "demo-audit",
    url: overrides.url || "https://city.example.gov/services/register",
    depth: overrides.depth || "standard",
  });
  const timestamp = nowIso();

  return {
    ...base,
    status: overrides.status || "idle",
    progress: overrides.progress ?? 0,
    pages: overrides.pages || [
      { url: base.url, title: "Business License Registration", heading: "Create your account", session: "register", sessionLabel: "Register", scanned: true },
      { url: "https://city.example.gov/services/register/personal", title: "Personal information", heading: "Tell us about your business", session: "personal", sessionLabel: "Personal info", scanned: true },
      { url: "https://city.example.gov/services/register/review", title: "Review and submit", heading: "Review your application", session: "review", sessionLabel: "Review and submit", scanned: true },
    ],
    documents: overrides.documents || [
      { url: "https://city.example.gov/forms/license-guide.pdf", title: "Business license guide", textLength: 0, imageOnly: true, summary: "Image-only guide needs replacement.", matchedStage: "pdf" },
    ],
    stages: overrides.stages || defaultStages,
    findings: overrides.findings || defaultIssues,
    agentSteps: overrides.agentSteps || defaultAgentSteps,
    updatedAt: timestamp,
  };
}
